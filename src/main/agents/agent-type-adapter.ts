import type { AgentSessionStatus } from '@shared/domain/agent-session';
import type { AgentType } from '@shared/domain/project';
import type { z } from 'zod';
import type { AgentStatusEvent } from '../status/agent-status-event';
import type { TerminalSignal } from '../terminals/terminal-signal';

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

  /**
   * Translates one hook payload into what happened in the agent session (concept 3). Rules that
   * depend on the agent's payload format, e.g. ignoring events of subagents, apply here.
   * @param payload The parsed JSON body of a hook request, not yet validated.
   * @returns The event, `null` for a valid but irrelevant payload, or why it is invalid.
   */
  interpretHookEvent(payload: unknown): HookEventInterpretation;

  /**
   * Creates the interpreter of the terminal signals of one agent session, e.g. for the interrupt
   * detection of ADR 0005. One per agent session, since it remembers earlier signals.
   * @param now Clock in milliseconds; signals arrive synchronously, so it dates them.
   * @returns The interpreter.
   */
  createTerminalSignalInterpreter(now: () => number): TerminalSignalInterpreter;
}

/** Translates the terminal signals of one agent session into status events (ADR 0005). */
export interface TerminalSignalInterpreter {
  /**
   * Interprets one terminal signal.
   * @param signal Key press or title change, in the order they happened.
   * @param currentStatus Status of the agent session now; `null` before its first status.
   * @returns The event, or `null` if the signal alone means nothing (yet).
   */
  interpret(
    signal: TerminalSignal,
    currentStatus: AgentSessionStatus | null,
  ): AgentStatusEvent | null;
}

/** Outcome of interpreting a hook payload; an invalid one is logged and ignored. */
export type HookEventInterpretation =
  | { readonly ok: true; readonly event: AgentStatusEvent | null }
  | {
      readonly ok: false;
      /** Name of the hook event if the payload names one; safe to log. */
      readonly eventName: string | null;
      /** Paths of the invalid fields, e.g. `session_id`; never their values (prompts, output). */
      readonly invalidPaths: readonly string[];
    };

/** What an adapter needs to know to start an agent session. */
export interface AgentLaunchContext {
  /** Absolute path of the hook settings file Argus wrote at startup. */
  readonly hookSettingsPath: string;
  /** Prompt the agent starts with; `null` starts it without one. */
  readonly startPrompt: string | null;
}
