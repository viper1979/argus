import type {
  AgentSession,
  StartAgentSessionRequest,
  StartAgentSessionResult,
} from '@shared/domain/agent-session';
import type { AgentType } from '@shared/domain/project';
import type { AgentHooks, AvailableAgentHooks } from '../hooks/start-agent-hooks';
import type { Logger } from '../logging/logger';
import type { AppStateHolder } from '../persistence/app-state-holder';
import type { TerminalService } from '../terminals/terminal-service';
import {
  AGENT_SESSION_ID_VARIABLE,
  AGENT_SESSION_TOKEN_VARIABLE,
} from './agent-session-environment';
import type { AgentTypeAdapter } from './agent-type-adapter';

/** Starts agent sessions (glossary: Agent-Session) and keeps track of the running ones. */
export interface AgentSessionService {
  /**
   * Starts an agent session in a new terminal of the task (concept 5.3).
   * @param request Task and the size xterm.js measured.
   * @returns Ids of agent session and terminal, or why it could not be started.
   */
  start(request: StartAgentSessionRequest): Promise<StartAgentSessionResult>;

  /**
   * Notes that a terminal ended. If it was the one of an agent session, the task can start a
   * new agent session again; other terminals are ignored.
   * @param terminalId The terminal whose process ended.
   */
  handleTerminalExit(terminalId: string): void;

  /**
   * Tells whether a terminal runs a live agent session. Its tab cannot be closed (concept 5.3,
   * step 5); the agent session ends via `/exit` or `exit` in its PowerShell.
   * @param terminalId The terminal.
   * @returns `true` while the agent session's PTY lives.
   */
  isAgentSessionTerminal(terminalId: string): boolean;
}

/** Collaborators of the agent session service; `generateId` makes ids deterministic in tests. */
export interface AgentSessionServiceOptions {
  readonly stateHolder: AppStateHolder;
  readonly terminalService: TerminalService;
  /** The adapter of every agent type; all agent-specific knowledge comes from here. */
  readonly adapters: Readonly<Record<AgentType, AgentTypeAdapter>>;
  /** Outcome of the hook setup at app start. */
  readonly hooks: AgentHooks;
  readonly generateId: () => string;
  readonly logger: Logger;
}

/** Stands in for the terminal id while the agent session of a task is being started. */
const START_PENDING = Symbol('start-pending');

/**
 * Creates the agent session service.
 * @param options State, terminals, adapters, hooks, id generator and logger.
 * @returns The service.
 */
export function createAgentSessionService(
  options: AgentSessionServiceOptions,
): AgentSessionService {
  const { hooks, logger } = options;
  /**
   * Terminal of the running agent session per task id, or {@link START_PENDING} while a start is
   * under way. "Running" means its PTY lives; a task without entry can start one.
   */
  const agentSessionTerminalByTask = new Map<string, string | typeof START_PENDING>();

  return {
    start: async (request) => {
      if (!hooks.isAvailable) {
        return { ok: false, reason: 'hooks-unavailable' };
      }
      // Checked and taken before the first await: a second call (e.g. a double click) must not
      // pass the check while the first one still waits for state or terminal.
      if (agentSessionTerminalByTask.has(request.taskId)) {
        return { ok: false, reason: 'already-running' };
      }
      agentSessionTerminalByTask.set(request.taskId, START_PENDING);
      let result: StartAgentSessionResult;
      try {
        result = await launchAgentSession(options, hooks, request);
      } catch (error: unknown) {
        // Unexpected (e.g. state.json not writable); the IPC layer rejects the call. Logged here
        // because only this place knows the task. Nothing runs, so the task is free again.
        agentSessionTerminalByTask.delete(request.taskId);
        logger.error('Could not start agent session', { taskId: request.taskId, error });
        throw error;
      }
      if (result.ok) {
        agentSessionTerminalByTask.set(request.taskId, result.terminalId);
      } else {
        agentSessionTerminalByTask.delete(request.taskId);
      }
      return result;
    },
    handleTerminalExit: (terminalId) => {
      for (const [taskId, agentSessionTerminal] of agentSessionTerminalByTask) {
        if (agentSessionTerminal === terminalId) {
          agentSessionTerminalByTask.delete(taskId);
        }
      }
    },
    isAgentSessionTerminal: (terminalId) =>
      [...agentSessionTerminalByTask.values()].includes(terminalId),
  };
}

/**
 * Saves a new agent session and starts it in a new terminal of the task.
 * @param options State, terminals, adapters and id generator.
 * @param hooks Token and hook settings files of this app start.
 * @param request Task and terminal size.
 * @returns Ids of agent session and terminal, or why it could not be started.
 */
async function launchAgentSession(
  options: AgentSessionServiceOptions,
  hooks: AvailableAgentHooks,
  { taskId, cols, rows }: StartAgentSessionRequest,
): Promise<StartAgentSessionResult> {
  const { stateHolder, terminalService, adapters, generateId } = options;
  const state = await stateHolder.read();
  const task = state.tasks.find((candidate) => candidate.id === taskId);
  if (!task) {
    return { ok: false, reason: 'task-not-found' };
  }
  const adapter = adapters[task.agentType];
  // The start prompt belongs to the first agent session of the task only (task schema).
  const isFirstAgentSession = !state.agentSessions.some((saved) => saved.taskId === taskId);
  const agentSessionId = generateId();
  const agentSession: AgentSession = {
    id: agentSessionId,
    taskId,
    agentType: task.agentType,
    conversationId: null,
  };
  // Saved before the start (concept 5.3, step 2), so every hook event can find its session.
  await stateHolder.update((current) => ({
    ...current,
    agentSessions: [...current.agentSessions, agentSession],
  }));
  const opened = await terminalService.open(
    { taskId, cols, rows },
    {
      startCommand: adapter.buildStartCommand({
        hookSettingsPath: hooks.hookSettingsPath(task.agentType),
        startPrompt: isFirstAgentSession ? task.startPrompt : null,
      }),
      addVariables: {
        [AGENT_SESSION_TOKEN_VARIABLE]: hooks.token,
        [AGENT_SESSION_ID_VARIABLE]: agentSessionId,
      },
      // Which inherited variables to drop is agent knowledge; the adapter decides directly.
      removeVariable: adapter.shouldRemoveInheritedVariable.bind(adapter),
    },
  );
  if (!opened.ok) {
    // Nothing ran, so there is no conversation to resume later; keep state.json free of it.
    await stateHolder.update((current) => ({
      ...current,
      agentSessions: current.agentSessions.filter((saved) => saved.id !== agentSessionId),
    }));
    return opened;
  }
  return { ok: true, agentSessionId, terminalId: opened.terminalId };
}
