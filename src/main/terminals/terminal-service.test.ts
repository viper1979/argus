import type { Task } from '@shared/domain/task';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { Logger } from '../logging/logger';
import { createEmptyAppState } from '../persistence/app-state';
import { createAppStateHolder } from '../persistence/app-state-holder';
import { FakeStateStore } from '../persistence/testing/fake-state-store';
import {
  createTerminalService,
  EXIT_TIMEOUT_MS,
  type TerminalEventSink,
  type TerminalLaunch,
  type TerminalService,
} from './terminal-service';
import { FakePtySpawner } from './testing/fake-pty';
import { createFakeLogger } from '../logging/testing/fake-logger';

/** Fixed ids so that opened terminals can be compared with literals; handed out in this order. */
const TERMINAL_ID = '7d1e2f3a-4b5c-4d6e-8f7a-9b0c1d2e3f4a';
const SECOND_TERMINAL_ID = '8e2f3a4b-5c6d-4e7f-9a8b-0c1d2e3f4a5b';

/** The task all tests open terminals in. */
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

/** Environment Argus itself runs with in the tests. */
const PROCESS_ENV = { PATH: 'C:\\Windows' };

/** Size xterm.js measured before the terminal was opened. */
const INITIAL_SIZE = { cols: 120, rows: 30 };

describe('TerminalService', () => {
  let spawner: FakePtySpawner;
  let outputEvent: Mock<TerminalEventSink['output']>;
  let exitEvent: Mock<TerminalEventSink['exit']>;
  let logError: Mock<Logger['error']>;
  let logWarn: Mock<Logger['warn']>;
  let terminalService: TerminalService;

  /**
   * Creates the service under test with the shared fakes.
   * @param processEnv Environment Argus runs with, inherited by every terminal.
   * @returns The service.
   */
  function createService(processEnv: NodeJS.ProcessEnv): TerminalService {
    const terminalIds = [TERMINAL_ID, SECOND_TERMINAL_ID];
    const stateStore = new FakeStateStore({ ...createEmptyAppState(), tasks: [LOGIN_TASK] });
    return createTerminalService({
      spawnPty: spawner.spawn,
      stateHolder: createAppStateHolder(stateStore),
      processEnv,
      generateId: () => {
        const nextId = terminalIds.shift();
        if (!nextId) {
          throw new Error('Test opened more terminals than it has ids');
        }
        return nextId;
      },
      events: { output: outputEvent, exit: exitEvent },
      logger: createFakeLogger({ warn: logWarn, error: logError }),
    });
  }

  beforeEach(() => {
    spawner = new FakePtySpawner();
    outputEvent = vi.fn();
    exitEvent = vi.fn();
    logError = vi.fn();
    logWarn = vi.fn();
    terminalService = createService(PROCESS_ENV);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('open', () => {
    it('open_WithKnownTask_StartsPwshInWorktreeWithTerminalEnvironment', async () => {
      // Act
      const result = await terminalService.open({ taskId: LOGIN_TASK.id, ...INITIAL_SIZE });

      // Assert
      expect(result).toEqual({ ok: true, terminalId: TERMINAL_ID });
      const started = spawner.processAt(0);
      expect(started.executable).toBe('pwsh.exe');
      expect(started.args).toEqual(['-NoLogo']);
      expect(started.options).toEqual({
        cwd: 'D:\\Worktrees\\Webshop\\login',
        cols: 120,
        rows: 30,
        env: {
          PATH: 'C:\\Windows',
          GIT_CONFIG_COUNT: '1',
          GIT_CONFIG_KEY_0: 'push.autoSetupRemote',
          GIT_CONFIG_VALUE_0: 'true',
        },
      });
    });

    it('open_WithLaunch_KeepsShellOpenAndPassesStartCommandEncoded', async () => {
      // Arrange: -NoExit keeps the PowerShell usable after the agent ended (ADR 0002)
      const launch: TerminalLaunch = {
        startCommand: 'claude',
        addVariables: {},
        removeVariable: () => false,
      };

      // Act
      await terminalService.open({ taskId: LOGIN_TASK.id, ...INITIAL_SIZE }, launch);

      // Assert: Base64 of "claude" in UTF-16LE, produced by PowerShell
      expect(spawner.processAt(0).args).toEqual([
        '-NoLogo',
        '-NoExit',
        '-EncodedCommand',
        'YwBsAGEAdQBkAGUA',
      ]);
    });

    it('open_WithLaunch_RemovesRejectedVariablesAndAddsOwnOnes', async () => {
      // Arrange: Argus started from a Claude session; the predicate sees the whole inheritance
      terminalService = createService({
        PATH: 'C:\\Windows',
        CLAUDECODE: '1',
        CLAUDE_CODE_CHILD_SESSION: '1',
      });
      const launch: TerminalLaunch = {
        startCommand: 'claude',
        addVariables: { ARGUS_TOKEN: 'token-1', ARGUS_SESSION_ID: 'session-1' },
        removeVariable: (name, inheritedEnvironment) =>
          'CLAUDECODE' in inheritedEnvironment && name.startsWith('CLAUDE'),
      };

      // Act
      await terminalService.open({ taskId: LOGIN_TASK.id, ...INITIAL_SIZE }, launch);

      // Assert
      expect(spawner.processAt(0).options.env).toEqual({
        PATH: 'C:\\Windows',
        ARGUS_TOKEN: 'token-1',
        ARGUS_SESSION_ID: 'session-1',
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'push.autoSetupRemote',
        GIT_CONFIG_VALUE_0: 'true',
      });
    });

    it('open_WithLaunchVariableInheritedInOtherCase_ReplacesItInsteadOfDuplicating', async () => {
      // Arrange: Windows names are case-insensitive; two spellings in one block are undefined
      terminalService = createService({ PATH: 'C:\\Windows', argus_token: 'stale' });
      const launch: TerminalLaunch = {
        startCommand: 'claude',
        addVariables: { ARGUS_TOKEN: 'token-1' },
        removeVariable: () => false,
      };

      // Act
      await terminalService.open({ taskId: LOGIN_TASK.id, ...INITIAL_SIZE }, launch);

      // Assert
      const environment = spawner.processAt(0).options.env;
      expect(environment['ARGUS_TOKEN']).toBe('token-1');
      expect(environment).not.toHaveProperty('argus_token');
    });

    it('open_WithUnknownTask_ReturnsTaskNotFoundWithoutStartingShell', async () => {
      // Arrange
      const unknownTaskId = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

      // Act
      const result = await terminalService.open({ taskId: unknownTaskId, ...INITIAL_SIZE });

      // Assert
      expect(result).toEqual({ ok: false, reason: 'task-not-found' });
      expect(spawner.processes).toHaveLength(0);
    });

    it('open_WithoutPwsh_FallsBackToWindowsPowerShell', async () => {
      // Arrange
      spawner.missingExecutables.add('pwsh.exe');

      // Act
      const result = await terminalService.open({ taskId: LOGIN_TASK.id, ...INITIAL_SIZE });

      // Assert
      expect(result).toEqual({ ok: true, terminalId: TERMINAL_ID });
      expect(spawner.processAt(0).executable).toBe('powershell.exe');
      expect(spawner.processAt(0).options.cwd).toBe('D:\\Worktrees\\Webshop\\login');
    });

    it('open_WithoutAnyPowerShell_ReturnsShellUnavailableAndLogsError', async () => {
      // Arrange
      spawner.missingExecutables.add('pwsh.exe');
      spawner.missingExecutables.add('powershell.exe');

      // Act
      const result = await terminalService.open({ taskId: LOGIN_TASK.id, ...INITIAL_SIZE });

      // Assert
      expect(result).toEqual({ ok: false, reason: 'shell-unavailable' });
      expect(logError).toHaveBeenCalledWith(
        expect.stringContaining('PowerShell') as string,
        expect.objectContaining({ taskId: LOGIN_TASK.id }),
      );
    });
  });

  describe('events', () => {
    it('open_WhenShellPrintsOutput_ForwardsItUnchangedWithTerminalId', async () => {
      // Arrange
      await terminalService.open({ taskId: LOGIN_TASK.id, ...INITIAL_SIZE });

      // Act
      spawner.processAt(0).emitData('\x1b[32mGrüße\x1b[0m\r\n');

      // Assert
      expect(outputEvent).toHaveBeenCalledWith(TERMINAL_ID, '\x1b[32mGrüße\x1b[0m\r\n');
    });

    it('open_WhenShellExitsByItself_ReportsExitAndDropsLaterInput', async () => {
      // Arrange
      await terminalService.open({ taskId: LOGIN_TASK.id, ...INITIAL_SIZE });
      const shell = spawner.processAt(0);

      // Act
      shell.emitExit(0);
      terminalService.write(TERMINAL_ID, 'dir\r');

      // Assert
      expect(exitEvent).toHaveBeenCalledWith(TERMINAL_ID, 0);
      expect(shell.writes).toEqual([]);
    });
  });

  describe('close', () => {
    it('close_OfRunningTerminal_KillsPtyAndResolvesOnlyAfterItsExit', async () => {
      // Arrange
      await terminalService.open({ taskId: LOGIN_TASK.id, ...INITIAL_SIZE });
      const shell = spawner.processAt(0);
      shell.shouldExitOnKill = false;
      let isClosed = false;

      // Act
      const closing = terminalService.close(TERMINAL_ID).then(() => {
        isClosed = true;
      });
      await Promise.resolve();
      const isClosedBeforeExit = isClosed;
      shell.emitExit(1);
      await closing;

      // Assert
      expect(shell.killCount).toBe(1);
      expect(isClosedBeforeExit).toBe(false);
      expect(isClosed).toBe(true);
      expect(exitEvent).toHaveBeenCalledWith(TERMINAL_ID, 1);
    });

    it('close_WhenPtyNeverReportsExit_GivesUpAfterTimeoutAndLogsWarning', async () => {
      // Arrange
      vi.useFakeTimers();
      await terminalService.open({ taskId: LOGIN_TASK.id, ...INITIAL_SIZE });
      const shell = spawner.processAt(0);
      shell.shouldExitOnKill = false;

      // Act
      const closing = terminalService.close(TERMINAL_ID);
      await vi.advanceTimersByTimeAsync(EXIT_TIMEOUT_MS);
      await closing;
      terminalService.write(TERMINAL_ID, 'dir\r');

      // Assert
      expect(logWarn).toHaveBeenCalledWith(
        expect.stringContaining('did not end') as string,
        expect.objectContaining({ terminalId: TERMINAL_ID }),
      );
      expect(shell.writes).toEqual([]);
    });
  });

  describe('closeAll', () => {
    it('closeAll_WhileOpenIsStillPending_OpenStartsNoShellAndReportsAppClosing', async () => {
      // Arrange: the user clicks "+" in the moment Argus starts quitting; `open` is still
      // waiting for the state when `closeAll` takes its snapshot of running terminals
      const opening = terminalService.open({ taskId: LOGIN_TASK.id, ...INITIAL_SIZE });

      // Act
      await terminalService.closeAll();
      const result = await opening;

      // Assert: a shell started now would never be closed and outlive Argus
      expect(result).toEqual({ ok: false, reason: 'app-closing' });
      expect(spawner.processes).toHaveLength(0);
    });

    it('closeAll_WithTwoRunningTerminals_KillsBothAndResolvesAfterBothExited', async () => {
      // Arrange
      await terminalService.open({ taskId: LOGIN_TASK.id, ...INITIAL_SIZE });
      await terminalService.open({ taskId: LOGIN_TASK.id, ...INITIAL_SIZE });
      const [firstShell, secondShell] = [spawner.processAt(0), spawner.processAt(1)];
      firstShell.shouldExitOnKill = false;
      secondShell.shouldExitOnKill = false;
      let isClosed = false;

      // Act
      const closing = terminalService.closeAll().then(() => {
        isClosed = true;
      });
      firstShell.emitExit(1);
      await Promise.resolve();
      const isClosedAfterFirstExit = isClosed;
      secondShell.emitExit(1);
      await closing;

      // Assert
      expect(firstShell.killCount).toBe(1);
      expect(secondShell.killCount).toBe(1);
      expect(isClosedAfterFirstExit).toBe(false);
      expect(isClosed).toBe(true);
    });
  });

  describe('write and resize', () => {
    it('write_ToSecondTerminal_ReachesOnlyItsPty', async () => {
      // Arrange
      await terminalService.open({ taskId: LOGIN_TASK.id, ...INITIAL_SIZE });
      await terminalService.open({ taskId: LOGIN_TASK.id, ...INITIAL_SIZE });

      // Act
      terminalService.write(SECOND_TERMINAL_ID, 'git status\r');

      // Assert
      expect(spawner.processAt(0).writes).toEqual([]);
      expect(spawner.processAt(1).writes).toEqual(['git status\r']);
    });

    it('resize_OfSecondTerminal_ResizesOnlyItsPty', async () => {
      // Arrange
      await terminalService.open({ taskId: LOGIN_TASK.id, ...INITIAL_SIZE });
      await terminalService.open({ taskId: LOGIN_TASK.id, ...INITIAL_SIZE });

      // Act
      terminalService.resize(SECOND_TERMINAL_ID, { cols: 80, rows: 24 });

      // Assert
      expect(spawner.processAt(0).resizes).toEqual([]);
      expect(spawner.processAt(1).resizes).toEqual([{ cols: 80, rows: 24 }]);
    });
  });
});
