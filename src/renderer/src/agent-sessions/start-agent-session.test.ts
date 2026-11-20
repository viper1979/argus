import type {
  StartAgentSessionRequest,
  StartAgentSessionResult,
} from '@shared/domain/agent-session';
import type { Task } from '@shared/domain/task';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { taskViewStore } from '@renderer/stores/task-view-store';
import { createTerminalView } from '@renderer/terminals/terminal-views';
import { startAgentSession } from './start-agent-session';

// xterm.js needs a DOM; the tests only need to decide whether the terminal still runs.
vi.mock('@renderer/terminals/terminal-views', () => ({ createTerminalView: vi.fn() }));

const AGENT_SESSION_ID = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const TERMINAL_ID = '7d1e2f3a-4b5c-4d6e-8f7a-9b0c1d2e3f4a';

/** A freshly created task as `task.create` returns it. */
const LOGIN_TASK: Task = {
  id: '3c9e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a',
  projectId: '6f1c2b8e-1d2a-4c3b-9e4f-5a6b7c8d9e0f',
  name: 'login',
  branch: 'agent/login',
  baseBranch: 'main',
  worktreePath: 'D:\\Worktrees\\Webshop\\login',
  startPrompt: null,
  agentType: 'claude-code',
};

describe('startAgentSession', () => {
  let start: Mock<(request: StartAgentSessionRequest) => Promise<StartAgentSessionResult>>;

  beforeEach(() => {
    // The function works on the app-wide store; every test starts with an empty one.
    taskViewStore.setState(taskViewStore.getInitialState(), true);
    start = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        agentSessionId: AGENT_SESSION_ID,
        terminalId: TERMINAL_ID,
      }),
    );
    vi.stubGlobal('window', { argus: { agentSession: { start } } });
    vi.mocked(createTerminalView).mockReturnValue(true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('startAgentSession_WhenStarted_AddsTabNamedAfterAgentTypeAsFirstTab', async () => {
    // Act
    await startAgentSession(LOGIN_TASK);

    // Assert
    expect(start).toHaveBeenCalledWith({ taskId: LOGIN_TASK.id, cols: 120, rows: 30 });
    expect(taskViewStore.getState().terminalsByTask[LOGIN_TASK.id]).toEqual([
      { terminalId: TERMINAL_ID, title: 'Claude Code', kind: 'agent-session' },
    ]);
  });

  it('startAgentSession_WhenMainReportsReason_KeepsReasonForTask', async () => {
    // Arrange
    start.mockResolvedValue({ ok: false, reason: 'hooks-unavailable' });

    // Act
    await startAgentSession(LOGIN_TASK);

    // Assert
    expect(taskViewStore.getState().agentSessionFailureByTask[LOGIN_TASK.id]).toBe(
      'hooks-unavailable',
    );
    expect(taskViewStore.getState().terminalsByTask[LOGIN_TASK.id]).toBeUndefined();
  });

  it('startAgentSession_WhenCallFails_ReportsUnexpectedWithoutRejecting', async () => {
    // Arrange: the caller does not wait for the start, so a rejection would go unhandled
    start.mockRejectedValue(new Error('IPC channel closed'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    // Act
    const started = startAgentSession(LOGIN_TASK);

    // Assert
    await expect(started).resolves.toBeUndefined();
    expect(taskViewStore.getState().agentSessionFailureByTask[LOGIN_TASK.id]).toBe('unexpected');
  });

  it('startAgentSession_WhenTerminalExitedBeforeReply_AddsNoTab', async () => {
    // Arrange: the shell ended before the reply arrived; a tab would show a dead terminal
    vi.mocked(createTerminalView).mockReturnValue(false);

    // Act
    await startAgentSession(LOGIN_TASK);

    // Assert
    expect(taskViewStore.getState().terminalsByTask[LOGIN_TASK.id]).toBeUndefined();
  });
});
