import type { AgentType } from '@shared/domain/project';
import type { z } from 'zod';

/**
 * Everything Argus needs to know about one agent CLI (concept 4). The core only talks to this
 * interface; all agent-specific knowledge lives in its implementations.
 */
export interface AgentTypeAdapter {
  /** The agent type this adapter implements, e.g. `claude-code`. */
  readonly agentType: AgentType;

  /**
   * Strict schema of the hook settings file. The core validates every file against it before
   * writing, since an agent CLI may silently ignore an invalid file as a whole (concept 5.3).
   */
  readonly hookSettingsSchema: z.ZodType;

  /**
   * Builds the content of the hook settings file for the current hook server port.
   * @param port Port the hook server listens on.
   * @returns JSON-serialisable file content, validated by the core against {@link hookSettingsSchema}.
   */
  buildHookSettings(port: number): unknown;

  /**
   * Builds the PowerShell command that starts a new agent session in the terminal.
   * @param context Hook settings file and optional start prompt.
   * @returns The command line, run inside the PowerShell of the agent session (ADR 0002).
   */
  buildStartCommand(context: AgentLaunchContext): string;

  /**
   * Decides whether an inherited environment variable must not reach the agent session, e.g.
   * markers of a surrounding session of the same agent.
   * @param name Name of the inherited variable, in the spelling it is stored with.
   * @param inheritedEnvironment The whole inherited environment, for rules that depend on it.
   * @returns `true` to remove the variable before the start.
   */
  shouldRemoveInheritedVariable(
    name: string,
    inheritedEnvironment: Readonly<Record<string, string>>,
  ): boolean;
}

/** What an adapter needs to know to start an agent session. */
export interface AgentLaunchContext {
  /** Absolute path of the hook settings file Argus wrote at startup. */
  readonly hookSettingsPath: string;
  /** Prompt the agent starts with; `null` starts it without one. */
  readonly startPrompt: string | null;
}
