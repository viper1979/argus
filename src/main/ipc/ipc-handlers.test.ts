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

describe('createIpcHandlers', () => {
  let closeTerminal: Mock<TerminalService['close']>;
  let handlers: ReturnType<typeof createIpcHandlers>;

  beforeEach(() => {
    closeTerminal = vi.fn(() => Promise.resolve());
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
    };
    handlers = createIpcHandlers({
      // Not used by the terminal handlers under test.
      projectService: {} as ProjectService,
      taskService: {} as TaskService,
      settingsService: {} as SettingsService,
      terminalService,
      agentSessionService,
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
});
