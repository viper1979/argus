import { join } from 'node:path';
import type { AgentType } from '@shared/domain/project';
import type { AgentTypeAdapter } from '../agents/agent-type-adapter';
import type { Logger } from '../logging/logger';
import type { HookEvent, HookServer, HookServerOptions } from './hook-server';

/**
 * Writes one hook settings file, creating its folder if needed.
 * @param path Absolute file path.
 * @param content File content.
 */
export type WriteHookSettingsFile = (path: string, content: string) => Promise<void>;

/** Collaborators of {@link startAgentHooks}; injected so the startup is testable without I/O. */
export interface StartAgentHooksOptions {
  /** One adapter per supported agent type; each gets its own route and settings file. */
  readonly adapters: readonly AgentTypeAdapter[];
  /** Folder of the hook settings files, `%APPDATA%\Argus\hooks` (concept 5.3). */
  readonly hooksDirectory: string;
  readonly startHookServer: (options: HookServerOptions) => Promise<HookServer>;
  readonly writeFile: WriteHookSettingsFile;
  /** Creates the secret of this app start. */
  readonly generateToken: () => string;
  /** Receives every accepted hook event. */
  readonly onHookEvent: (event: HookEvent) => void;
  readonly logger: Logger;
}

/** Hooks are ready: agent sessions can be started with status reporting. */
export interface AvailableAgentHooks {
  readonly isAvailable: true;
  /** Secret the agent session passes back in `X-Argus-Token` (env `ARGUS_TOKEN`). */
  readonly token: string;
  /**
   * Locates the hook settings file of an agent type.
   * @param agentType The agent type.
   * @returns Absolute path of its file.
   */
  hookSettingsPath(agentType: AgentType): string;
}

/** Hooks could not be set up; no agent session can be started (concept 5.3). */
export interface UnavailableAgentHooks {
  readonly isAvailable: false;
}

/** Outcome of setting up the hooks at app start. */
export type AgentHooks = AvailableAgentHooks | UnavailableAgentHooks;

/** Indentation of the written JSON; the file is meant to be readable when debugging. */
const JSON_INDENT = 2;

/** Logged whenever hooks cannot be set up; agent sessions then report `hooks-unavailable`. */
const UNAVAILABLE_MESSAGE = 'Agent hooks unavailable';

/**
 * Starts the hook server and then writes the hook settings file of every agent type with the
 * port the server got. Runs once per app start, since the port changes every time (ADR 0003).
 * @param options Adapters, folder and collaborators.
 * @returns Token and file paths, or that hooks are unavailable.
 */
export async function startAgentHooks(options: StartAgentHooksOptions): Promise<AgentHooks> {
  const { adapters, hooksDirectory, startHookServer, writeFile, generateToken } = options;
  const token = generateToken();
  let server: HookServer;
  try {
    server = await startHookServer({
      token,
      agentTypes: adapters.map((adapter) => adapter.agentType),
      onHookEvent: options.onHookEvent,
      logger: options.logger,
    });
  } catch (error: unknown) {
    // Whatever failed, the result is the same: no status reporting, so no agent session.
    options.logger.error(UNAVAILABLE_MESSAGE, { error });
    return { isAvailable: false };
  }

  /**
   * Locates the hook settings file of an agent type; one file per agent type, shared by all its
   * agent sessions (concept 5.3).
   * @param agentType The agent type.
   * @returns Absolute path of its file.
   */
  const hookSettingsPath = (agentType: AgentType): string =>
    join(hooksDirectory, `${agentType}.json`);

  try {
    for (const adapter of adapters) {
      // Throws if the adapter's schema rejects the settings; then no file is better than one
      // the agent CLI silently ignores. Validated here, so no adapter can skip it.
      const settings = adapter.hookSettingsSchema.parse(adapter.buildHookSettings(server.port));
      await writeFile(
        hookSettingsPath(adapter.agentType),
        JSON.stringify(settings, null, JSON_INDENT),
      );
    }
  } catch (error: unknown) {
    options.logger.error(UNAVAILABLE_MESSAGE, { error });
    // Nothing will post to a server whose port is in no file.
    await server.close();
    return { isAvailable: false };
  }
  return { isAvailable: true, token, hookSettingsPath };
}
