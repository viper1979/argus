import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Task } from '@shared/domain/task';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyAppState } from '../persistence/app-state';
import { createAppStateHolder } from '../persistence/app-state-holder';
import { FakeStateStore } from '../persistence/testing/fake-state-store';
import { createNodePtySpawner } from './node-pty-spawner';
import { ShellExecutableNotFoundError } from './shell-executable-not-found-error';
import { createTerminalService, type TerminalService } from './terminal-service';
import { createFakeLogger } from '../logging/testing/fake-logger';

/** Wide enough that the probe line never wraps, which would split the expected text. */
const WIDE_TERMINAL = { cols: 250, rows: 30 };

/** How long a real PowerShell may take to start, load the user's profile and answer. */
const SHELL_RESPONSE_TIMEOUT_MS = 20_000;

/** Matches ANSI CSI/OSC escape sequences, so output can be searched as plain text. */
// eslint-disable-next-line no-control-regex -- escape sequences are control characters by definition
const ANSI_ESCAPE_PATTERN = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b[@-_]/g;

/** Fixed ids; they only need to be valid UUIDs. */
const TASK_ID = '3c9e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a';
const TERMINAL_ID = '7d1e2f3a-4b5c-4d6e-8f7a-9b0c1d2e3f4a';

/**
 * Builds a task whose worktree is the given folder.
 * @param worktreePath Folder the terminal is started in.
 * @returns The task.
 */
function taskIn(worktreePath: string): Task {
  return {
    id: TASK_ID,
    projectId: '6f1c2b8e-1d2a-4c3b-9e4f-5a6b7c8d9e0f',
    name: 'pruefung',
    branch: 'agent/pruefung',
    baseBranch: 'main',
    worktreePath,
    startPrompt: null,
    agentType: 'claude-code',
  };
}

describe('createNodePtySpawner with real PowerShell', () => {
  let directory: string;

  beforeEach(async () => {
    // The umlaut checks that a non-ASCII working directory reaches the shell unchanged.
    directory = await mkdtemp(join(tmpdir(), 'argus-terminal-Prüfung-'));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('spawn_OfMissingExecutable_ThrowsShellExecutableNotFoundError', () => {
    // Arrange
    const spawnPty = createNodePtySpawner();

    // Act
    const spawnMissing = (): unknown =>
      spawnPty('argus-missing-shell.exe', [], { cwd: directory, env: {}, ...WIDE_TERMINAL });

    // Assert
    expect(spawnMissing).toThrow(ShellExecutableNotFoundError);
  });

  describe('through TerminalService', () => {
    let terminalService: TerminalService;
    let output: string;
    let exitCodes: number[];

    beforeEach(() => {
      output = '';
      exitCodes = [];
      const stateStore = new FakeStateStore({
        ...createEmptyAppState(),
        tasks: [taskIn(directory)],
      });
      terminalService = createTerminalService({
        spawnPty: createNodePtySpawner(),
        stateHolder: createAppStateHolder(stateStore),
        processEnv: process.env,
        generateId: () => TERMINAL_ID,
        events: {
          output: (_terminalId, data) => {
            output += data;
          },
          exit: (_terminalId, exitCode) => {
            exitCodes.push(exitCode);
          },
        },
        logger: createFakeLogger(),
      });
    });

    afterEach(async () => {
      // Never leave a pwsh behind, even if an assertion failed.
      await terminalService.closeAll();
    });

    it(
      'open_InWorktreeWithUmlaut_ShellRunsThereWithGitConfigAndEchoesUmlautInput',
      async () => {
        // Arrange
        await terminalService.open({ taskId: TASK_ID, ...WIDE_TERMINAL });

        // Act: the expanded probe only appears in the command's output, never in the echo
        // of the typed line, which still contains `$PWD`.
        terminalService.write(TERMINAL_ID, 'Write-Output "[$PWD|$env:GIT_CONFIG_KEY_0|Grüße]"\r');

        // Assert
        await vi.waitFor(
          () => {
            const plainOutput = output.replace(ANSI_ESCAPE_PATTERN, '');
            expect(plainOutput).toContain(`[${directory}|push.autoSetupRemote|Grüße]`);
          },
          { timeout: SHELL_RESPONSE_TIMEOUT_MS, interval: 100 },
        );
      },
      SHELL_RESPONSE_TIMEOUT_MS + 5_000,
    );

    it(
      'closeAll_WithRunningShell_EndsItAndReportsExit',
      async () => {
        // Arrange
        await terminalService.open({ taskId: TASK_ID, ...WIDE_TERMINAL });

        // Act
        await terminalService.closeAll();

        // Assert
        expect(exitCodes).toHaveLength(1);
      },
      SHELL_RESPONSE_TIMEOUT_MS,
    );
  });
});
