import type { AgentSessionStatusSnapshot } from '@shared/domain/agent-session';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { AgentSessionService } from '../agents/agent-session-service';
import type { ProjectService } from '../projects/project-service';
import type { SettingsService } from '../settings/settings-service';
import type { TaskService } from '../tasks/task-service';
import type { TerminalService } from '../terminals/terminal-service';
import { AgentSessionTerminalCloseError } from './agent-session-terminal-close-error';
import { createIpcHandlers } from './ipc-handlers';

// The handlers only read name and version from it; the real module needs a running Electron.
vi.mock('electron', () => ({ app: { getName: () => 'Argus', getVersion: () => '0.0.0' } }));

const AGENT_SESSION_TERMINAL_ID = '7d1e2f3a-4b5c-4d6e-8f7a-9b0c1d2e3f4a';
const OTHER_TERMINAL_ID = '8e2f3a4b-5c6d-4e7f-9a8b-0c1d2e3f4a5b';
const LOGIN_TASK_ID = '3c9e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a';
const STARTED_AGENT_SESSION_ID = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
/** An agent session the service does not know, e.g. reported by a foreign hook. */
const UNKNOWN_AGENT_SESSION_ID = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

describe('createIpcHandlers', () => {
  let closeTerminal: Mock<TerminalService['close']>;
  let handlers: ReturnType<typeof createIpcHandlers>;
  let trackedStatuses: AgentSessionStatusSnapshot[];

  beforeEach(() => {
    closeTerminal = vi.fn(() => Promise.resolve());
    trackedStatuses = [];
    const terminalService: TerminalService = {
      open: vi.fn(),
      write: vi.fn(),
      resize: vi.fn(),
      close: closeTerminal,
      closeAll: vi.fn(() => Promise.resolve()),
    };
    const agentSessionService: AgentSessionService = {
      start: vi.fn(),
      handleTerminalExit: vi.fn(),
      isAgentSessionTerminal: (terminalId) => terminalId === AGENT_SESSION_TERMINAL_ID,
      recordConversationId: vi.fn(),
      findTaskId: (agentSessionId) =>
        agentSessionId === STARTED_AGENT_SESSION_ID ? LOGIN_TASK_ID : null,
    };
    handlers = createIpcHandlers({
      // Not used by the handlers under test.
      projectService: {} as ProjectService,
      taskService: {} as TaskService,
      settingsService: {} as SettingsService,
      terminalService,
      agentSessionService,
      statusTracker: { getStatuses: () => trackedStatuses },
      pickFolder: vi.fn(),
    });
  });

  it('terminalClose_OfAgentSessionTerminal_RejectsWithoutClosing', async () => {
    // Act
    const close = handlers.terminal.close({ terminalId: AGENT_SESSION_TERMINAL_ID });

    // Assert: the tab has no close button; a request anyway comes from a faulty renderer
    await expect(close).rejects.toBeInstanceOf(AgentSessionTerminalCloseError);
    expect(closeTerminal).not.toHaveBeenCalled();
  });

  it('terminalClose_OfOtherTerminal_ClosesIt', async () => {
    // Act
    await handlers.terminal.close({ terminalId: OTHER_TERMINAL_ID });

    // Assert
    expect(closeTerminal).toHaveBeenCalledWith(OTHER_TERMINAL_ID);
  });

  it('agentSessionListStatuses_OfStartedAgentSession_ReturnsStatusWithItsTask', async () => {
    // Arrange
    trackedStatuses = [
      { agentSessionId: STARTED_AGENT_SESSION_ID, status: 'waiting', subagentCount: 2 },
    ];

    // Act
    const response = await handlers.agentSession.listStatuses({});

    // Assert: the sidebar lists tasks, so every status carries its task
    expect(response).toEqual({
      statuses: [
        {
          agentSessionId: STARTED_AGENT_SESSION_ID,
          taskId: LOGIN_TASK_ID,
          status: 'waiting',
          subagentCount: 2,
        },
      ],
    });
  });

  it('agentSessionListStatuses_OfUnknownAgentSession_LeavesItOut', async () => {
    // Arrange: without a task the renderer could not show it anywhere
    trackedStatuses = [
      { agentSessionId: UNKNOWN_AGENT_SESSION_ID, status: 'working', subagentCount: 0 },
      { agentSessionId: STARTED_AGENT_SESSION_ID, status: 'ready', subagentCount: 0 },
    ];

    // Act
    const response = await handlers.agentSession.listStatuses({});

    // Assert
    expect(response.statuses.map((status) => status.agentSessionId)).toEqual([
      STARTED_AGENT_SESSION_ID,
    ]);
  });
});
