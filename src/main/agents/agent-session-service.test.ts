import type { OpenTerminalRequest, OpenTerminalResult } from '@shared/domain/terminal';
import type { Task } from '@shared/domain/task';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { AgentHooks } from '../hooks/start-agent-hooks';
import type { Logger } from '../logging/logger';
import { createEmptyAppState } from '../persistence/app-state';
import { createAppStateHolder } from '../persistence/app-state-holder';
import { FakeStateStore } from '../persistence/testing/fake-state-store';
import type { TerminalLaunch, TerminalService } from '../terminals/terminal-service';
import { createAgentSessionService, type AgentSessionService } from './agent-session-service';
import { createFakeAgentTypeAdapter } from './testing/fake-agent-type-adapter';
import { createFakeLogger } from '../logging/testing/fake-logger';

const AGENT_SESSION_ID = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const TERMINAL_ID = '7d1e2f3a-4b5c-4d6e-8f7a-9b0c1d2e3f4a';
/** An ordinary terminal tab of the same task. */
const OTHER_TERMINAL_ID = '8e2f3a4b-5c6d-4e7f-9a8b-0c1d2e3f4a5b';

/** The task all tests start agent sessions in. */
const LOGIN_TASK: Task = {
  id: '3c9e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a',
  projectId: '6f1c2b8e-1d2a-4c3b-9e4f-5a6b7c8d9e0f',
  name: 'login',
  branch: 'agent/login',
  baseBranch: 'main',
  worktreePath: 'D:\\Worktrees\\Webshop\\login',
  startPrompt: 'Baue den Login um',
  agentType: 'claude-code',
};

/** Hooks as set up at app start. */
const AVAILABLE_HOOKS: AgentHooks = {
  isAvailable: true,
  token: 'hook-token',
  hookSettingsPath: (agentType) => `C:\\Argus\\hooks\\${agentType}.json`,
};

/** Size xterm.js measured before the agent session tab was shown. */
const INITIAL_SIZE = { cols: 120, rows: 30 };

describe('AgentSessionService', () => {
  let stateStore: FakeStateStore;
  let openTerminal: Mock<
    (request: OpenTerminalRequest, launch?: TerminalLaunch) => Promise<OpenTerminalResult>
  >;
  let agentSessionService: AgentSessionService;
  let logError: Mock<Logger['error']>;

  /**
   * Creates the service under test with the shared fakes.
   * @param hooks Outcome of the hook setup at app start.
   * @returns The service.
   */
  function createService(hooks: AgentHooks): AgentSessionService {
    const terminalService: TerminalService = {
      open: openTerminal,
      write: vi.fn(),
      resize: vi.fn(),
      close: vi.fn(() => Promise.resolve()),
      closeAll: vi.fn(() => Promise.resolve()),
    };
    const logger: Logger = createFakeLogger({ error: logError });
    return createAgentSessionService({
      stateHolder: createAppStateHolder(stateStore),
      terminalService,
      adapters: { 'claude-code': createFakeAgentTypeAdapter() },
      hooks,
      generateId: () => AGENT_SESSION_ID,
      logger,
    });
  }

  beforeEach(() => {
    stateStore = new FakeStateStore({ ...createEmptyAppState(), tasks: [LOGIN_TASK] });
    logError = vi.fn();
    openTerminal = vi.fn(() => Promise.resolve({ ok: true as const, terminalId: TERMINAL_ID }));
    agentSessionService = createService(AVAILABLE_HOOKS);
  });

  it('start_WithKnownTask_OpensTerminalWithLaunchOfItsAgentType', async () => {
    // Act
    const result = await agentSessionService.start({ taskId: LOGIN_TASK.id, ...INITIAL_SIZE });

    // Assert
    expect(result).toEqual({ ok: true, agentSessionId: AGENT_SESSION_ID, terminalId: TERMINAL_ID });
    expect(openTerminal).toHaveBeenCalledOnce();
    const [request, launch] = openTerminal.mock.calls[0] ?? [];
    expect(request).toEqual({ taskId: LOGIN_TASK.id, cols: 120, rows: 30 });
    expect(launch?.startCommand).toBe(
      'fake-agent C:\\Argus\\hooks\\claude-code.json Baue den Login um',
    );
    // Token and session id travel to the hook server as headers (ADR 0003).
    expect(launch?.addVariables).toEqual({
      ARGUS_TOKEN: 'hook-token',
      ARGUS_SESSION_ID: AGENT_SESSION_ID,
    });
  });

  it('start_WhenHooksUnavailable_ReturnsHooksUnavailableWithoutTerminal', async () => {
    // Arrange: without hooks Argus would never see a status (concept 5.3)
    agentSessionService = createService({ isAvailable: false });

    // Act
    const result = await agentSessionService.start({ taskId: LOGIN_TASK.id, ...INITIAL_SIZE });

    // Assert
    expect(result).toEqual({ ok: false, reason: 'hooks-unavailable' });
    expect(openTerminal).not.toHaveBeenCalled();
  });

  it('start_WithKnownTask_SavesAgentSessionWithoutConversationId', async () => {
    // Act
    await agentSessionService.start({ taskId: LOGIN_TASK.id, ...INITIAL_SIZE });

    // Assert: the conversation id only arrives with SessionStart (#8)
    expect(stateStore.savedState?.agentSessions).toEqual([
      {
        id: AGENT_SESSION_ID,
        taskId: LOGIN_TASK.id,
        agentType: 'claude-code',
        conversationId: null,
      },
    ]);
  });

  it('start_WhileAgentSessionOfTaskRuns_ReturnsAlreadyRunning', async () => {
    // Arrange: at most one agent session per task runs at a time (glossary)
    await agentSessionService.start({ taskId: LOGIN_TASK.id, ...INITIAL_SIZE });

    // Act
    const result = await agentSessionService.start({ taskId: LOGIN_TASK.id, ...INITIAL_SIZE });

    // Assert
    expect(result).toEqual({ ok: false, reason: 'already-running' });
    expect(openTerminal).toHaveBeenCalledOnce();
    expect(stateStore.savedState?.agentSessions).toHaveLength(1);
  });

  it('start_TwiceConcurrentlyForSameTask_StartsOnlyOne', async () => {
    // Act: the second call arrives while the first one still waits for state and terminal
    const results = await Promise.all([
      agentSessionService.start({ taskId: LOGIN_TASK.id, ...INITIAL_SIZE }),
      agentSessionService.start({ taskId: LOGIN_TASK.id, ...INITIAL_SIZE }),
    ]);

    // Assert
    expect(results).toEqual([
      { ok: true, agentSessionId: AGENT_SESSION_ID, terminalId: TERMINAL_ID },
      { ok: false, reason: 'already-running' },
    ]);
    expect(openTerminal).toHaveBeenCalledOnce();
  });

  it('start_AfterTerminalOfAgentSessionExited_StartsAgain', async () => {
    // Arrange: e.g. `exit` typed in the PowerShell after /exit
    await agentSessionService.start({ taskId: LOGIN_TASK.id, ...INITIAL_SIZE });
    agentSessionService.handleTerminalExit(TERMINAL_ID);

    // Act
    const result = await agentSessionService.start({ taskId: LOGIN_TASK.id, ...INITIAL_SIZE });

    // Assert
    expect(result.ok).toBe(true);
    expect(openTerminal).toHaveBeenCalledTimes(2);
  });

  it('handleTerminalExit_OfOtherTerminal_KeepsAgentSessionRunning', async () => {
    // Arrange: an ordinary terminal tab of the same task was closed
    await agentSessionService.start({ taskId: LOGIN_TASK.id, ...INITIAL_SIZE });
    agentSessionService.handleTerminalExit(OTHER_TERMINAL_ID);

    // Act
    const result = await agentSessionService.start({ taskId: LOGIN_TASK.id, ...INITIAL_SIZE });

    // Assert
    expect(result).toEqual({ ok: false, reason: 'already-running' });
  });

  it('start_WhenTerminalCannotOpen_ReturnsReasonAndRemovesSavedAgentSession', async () => {
    // Arrange: no PowerShell found; nothing ever ran, so there is no conversation to resume
    openTerminal.mockResolvedValueOnce({ ok: false, reason: 'shell-unavailable' });

    // Act
    const result = await agentSessionService.start({ taskId: LOGIN_TASK.id, ...INITIAL_SIZE });

    // Assert
    expect(result).toEqual({ ok: false, reason: 'shell-unavailable' });
    expect(stateStore.savedState?.agentSessions).toEqual([]);
  });

  it('start_AfterTerminalCouldNotOpen_StartsAgain', async () => {
    // Arrange: the failed start must not leave the task marked as running
    openTerminal.mockResolvedValueOnce({ ok: false, reason: 'shell-unavailable' });
    await agentSessionService.start({ taskId: LOGIN_TASK.id, ...INITIAL_SIZE });

    // Act
    const result = await agentSessionService.start({ taskId: LOGIN_TASK.id, ...INITIAL_SIZE });

    // Assert
    expect(result.ok).toBe(true);
  });

  it('start_WhenSavingFails_LogsErrorWithTaskAndRethrows', async () => {
    // Arrange: e.g. state.json locked by a virus scanner
    const saveError = new Error('EBUSY: resource busy or locked');
    stateStore.nextSaveError = saveError;

    // Act
    const start = agentSessionService.start({ taskId: LOGIN_TASK.id, ...INITIAL_SIZE });

    // Assert
    await expect(start).rejects.toBe(saveError);
    expect(logError).toHaveBeenCalledWith('Could not start agent session', {
      taskId: LOGIN_TASK.id,
      error: saveError,
    });
    expect(openTerminal).not.toHaveBeenCalled();
  });

  it('start_AfterSavingFailed_StartsAgain', async () => {
    // Arrange: the exception must not leave the task marked as running
    stateStore.nextSaveError = new Error('EBUSY: resource busy or locked');
    await agentSessionService
      .start({ taskId: LOGIN_TASK.id, ...INITIAL_SIZE })
      .catch(() => undefined);

    // Act
    const result = await agentSessionService.start({ taskId: LOGIN_TASK.id, ...INITIAL_SIZE });

    // Assert
    expect(result.ok).toBe(true);
  });

  it('isAgentSessionTerminal_OfRunningAgentSession_ReturnsTrue', async () => {
    // Arrange
    await agentSessionService.start({ taskId: LOGIN_TASK.id, ...INITIAL_SIZE });

    // Act
    const isAgentSessionTerminal = agentSessionService.isAgentSessionTerminal(TERMINAL_ID);

    // Assert: its tab must not be closable, not even by a renderer that ignores the UI
    expect(isAgentSessionTerminal).toBe(true);
  });

  it('isAgentSessionTerminal_OfOtherTerminal_ReturnsFalse', async () => {
    // Arrange
    await agentSessionService.start({ taskId: LOGIN_TASK.id, ...INITIAL_SIZE });

    // Act
    const isAgentSessionTerminal = agentSessionService.isAgentSessionTerminal(OTHER_TERMINAL_ID);

    // Assert
    expect(isAgentSessionTerminal).toBe(false);
  });

  it('isAgentSessionTerminal_AfterItsExit_ReturnsFalse', async () => {
    // Arrange
    await agentSessionService.start({ taskId: LOGIN_TASK.id, ...INITIAL_SIZE });
    agentSessionService.handleTerminalExit(TERMINAL_ID);

    // Act
    const isAgentSessionTerminal = agentSessionService.isAgentSessionTerminal(TERMINAL_ID);

    // Assert
    expect(isAgentSessionTerminal).toBe(false);
  });

  it('start_WhenTaskHadAgentSessionBefore_StartsWithoutStartPrompt', async () => {
    // Arrange: the start prompt belongs to the first agent session of the task only
    await agentSessionService.start({ taskId: LOGIN_TASK.id, ...INITIAL_SIZE });
    agentSessionService.handleTerminalExit(TERMINAL_ID);

    // Act
    await agentSessionService.start({ taskId: LOGIN_TASK.id, ...INITIAL_SIZE });

    // Assert
    const [, secondLaunch] = openTerminal.mock.calls[1] ?? [];
    expect(secondLaunch?.startCommand).toBe('fake-agent C:\\Argus\\hooks\\claude-code.json <none>');
  });

  it('start_WithUnknownTask_ReturnsTaskNotFoundWithoutSavingOrTerminal', async () => {
    // Act
    const result = await agentSessionService.start({
      taskId: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
      ...INITIAL_SIZE,
    });

    // Assert
    expect(result).toEqual({ ok: false, reason: 'task-not-found' });
    expect(openTerminal).not.toHaveBeenCalled();
    expect(stateStore.savedState).toBeNull();
  });
});
