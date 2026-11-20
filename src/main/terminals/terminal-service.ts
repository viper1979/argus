import type {
  OpenTerminalRequest,
  OpenTerminalResult,
  TerminalSize,
} from '@shared/domain/terminal';
import type { Logger } from '../logging/logger';
import type { AppStateHolder } from '../persistence/app-state-holder';
import { buildTerminalEnvironment } from './build-terminal-environment';
import type { PtyProcess, PtySpawnOptions, SpawnPty } from './pty';
import { ShellExecutableNotFoundError } from './shell-executable-not-found-error';

/** Owns the terminals (glossary: Terminal) of all tasks: starts, feeds and ends their PTYs. */
export interface TerminalService {
  /**
   * Opens a new terminal in the worktree of a task.
   * @param request Task and the size xterm.js measured.
   * @returns The id of the new terminal, or why it could not be opened.
   */
  open(request: OpenTerminalRequest): Promise<OpenTerminalResult>;

  /**
   * Sends input to a terminal. Input for a terminal that has already ended is dropped: keystrokes
   * can still be on their way while the shell exits.
   * @param terminalId The terminal.
   * @param data Text as typed in xterm.js.
   */
  write(terminalId: string, data: string): void;

  /**
   * Changes the size of a terminal; ignored for a terminal that has already ended.
   * @param terminalId The terminal.
   * @param size New size in character cells.
   */
  resize(terminalId: string, size: TerminalSize): void;

  /**
   * Ends the process of a terminal and waits until it has ended, so Windows releases files in
   * the worktree (concept 5.5, step 2). Does nothing for a terminal that has already ended.
   * @param terminalId The terminal.
   */
  close(terminalId: string): Promise<void>;

  /**
   * Ends all terminals and waits for each of them; called when Argus quits, so no `pwsh`
   * outlives the app (ADR 0004, concept 5.6). From then on {@link open} starts no new terminal.
   */
  closeAll(): Promise<void>;
}

/** A terminal whose process is running. */
interface RunningTerminal {
  readonly pty: PtyProcess;
  /** Resolves once the process has ended, for whatever reason. */
  readonly exited: Promise<void>;
}

/** Receives what happens in the terminals; in production it forwards to the renderer. */
export interface TerminalEventSink {
  /**
   * A terminal produced output.
   * @param terminalId The terminal.
   * @param data The output chunk, unchanged.
   */
  output(terminalId: string, data: string): void;

  /**
   * The process of a terminal ended, by itself or because it was closed.
   * @param terminalId The terminal.
   * @param exitCode Exit code of the shell.
   */
  exit(terminalId: string, exitCode: number): void;
}

/** Collaborators of the terminal service; `generateId` makes ids deterministic in tests. */
export interface TerminalServiceOptions {
  readonly spawnPty: SpawnPty;
  readonly stateHolder: AppStateHolder;
  /** Environment Argus runs with; every terminal inherits it (ADR 0006 adds git config). */
  readonly processEnv: NodeJS.ProcessEnv;
  readonly generateId: () => string;
  readonly events: TerminalEventSink;
  readonly logger: Logger;
}

/**
 * Every terminal is a PowerShell (ADR 0002): `pwsh` if installed, otherwise the Windows
 * PowerShell that ships with every Windows.
 */
const SHELL_CANDIDATES = ['pwsh.exe', 'powershell.exe'] as const;

/** Arguments of an interactive terminal; the user's profile is loaded on purpose. */
const SHELL_ARGS = ['-NoLogo'] as const;

/**
 * How long closing a terminal waits for its process to end after kill(). ConPTY usually reports
 * the end within milliseconds; the bound only protects against a process that never does.
 */
export const EXIT_TIMEOUT_MS = 5000;

/**
 * Waits for a process to end, but no longer than the timeout.
 * @param exited Resolves when the process has ended.
 * @param timeoutMs Upper bound for the wait.
 * @returns `true` if the process ended in time, `false` on timeout.
 */
async function waitUntilExited(exited: Promise<void>, timeoutMs: number): Promise<boolean> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<false>((resolveTimedOut) => {
    timeoutHandle = setTimeout(() => {
      resolveTimedOut(false);
    }, timeoutMs);
  });
  try {
    return await Promise.race([exited.then(() => true as const), timedOut]);
  } finally {
    clearTimeout(timeoutHandle);
  }
}

/**
 * Starts the first PowerShell that exists.
 * @param spawnPty The PTY factory.
 * @param spawnOptions Working directory, environment and size.
 * @returns The running shell, or `null` if no candidate exists.
 */
function startShell(spawnPty: SpawnPty, spawnOptions: PtySpawnOptions): PtyProcess | null {
  for (const shell of SHELL_CANDIDATES) {
    try {
      return spawnPty(shell, SHELL_ARGS, spawnOptions);
    } catch (error: unknown) {
      // Only a missing executable leads to the next candidate; any other start failure is a
      // real problem and must surface.
      if (!(error instanceof ShellExecutableNotFoundError)) {
        throw error;
      }
    }
  }
  return null;
}

/**
 * Creates the terminal service.
 * @param options PTY factory, state, environment, id generator, event sink and logger.
 * @returns The service.
 */
export function createTerminalService(options: TerminalServiceOptions): TerminalService {
  const { spawnPty, stateHolder, processEnv, generateId, events, logger } = options;
  /** Running terminals by id; a terminal leaves the map when its process has ended. */
  const runningTerminals = new Map<string, RunningTerminal>();
  /** Set once Argus quits; from then on no new terminal may start. */
  let isClosingAll = false;

  /**
   * Kills a terminal and waits for its end, but at most {@link EXIT_TIMEOUT_MS}.
   * @param terminalId The terminal; unknown or already ended terminals are ignored.
   */
  const closeTerminal = async (terminalId: string): Promise<void> => {
    const terminal = runningTerminals.get(terminalId);
    if (!terminal) {
      return;
    }
    terminal.pty.kill();
    const hasExited = await waitUntilExited(terminal.exited, EXIT_TIMEOUT_MS);
    if (!hasExited) {
      // Forget the terminal anyway: a PTY that ignores kill() must not block closing a tab
      // or quitting Argus forever.
      runningTerminals.delete(terminalId);
      logger.warn('Terminal process did not end after kill; giving up waiting', {
        terminalId,
        timeoutMs: EXIT_TIMEOUT_MS,
      });
    }
  };

  return {
    open: async ({ taskId, cols, rows }) => {
      const state = await stateHolder.read();
      // Checked after the await: closeAll may have taken its snapshot of running terminals in
      // the meantime, and a shell started now would never be closed and outlive Argus.
      if (isClosingAll) {
        return { ok: false, reason: 'app-closing' };
      }
      const task = state.tasks.find((candidate) => candidate.id === taskId);
      if (!task) {
        return { ok: false, reason: 'task-not-found' };
      }

      const shell = startShell(spawnPty, {
        cwd: task.worktreePath,
        env: buildTerminalEnvironment(processEnv),
        cols,
        rows,
      });
      if (!shell) {
        logger.error('No PowerShell found to open a terminal', {
          taskId,
          triedShells: SHELL_CANDIDATES,
        });
        return { ok: false, reason: 'shell-unavailable' };
      }

      const terminalId = generateId();
      const exited = new Promise<void>((resolveExited) => {
        shell.onExit((exitCode) => {
          runningTerminals.delete(terminalId);
          events.exit(terminalId, exitCode);
          resolveExited();
        });
      });
      runningTerminals.set(terminalId, { pty: shell, exited });
      shell.onData((data) => {
        events.output(terminalId, data);
      });
      return { ok: true, terminalId };
    },
    write: (terminalId, data) => {
      runningTerminals.get(terminalId)?.pty.write(data);
    },
    resize: (terminalId, size) => {
      runningTerminals.get(terminalId)?.pty.resize(size);
    },
    close: closeTerminal,
    closeAll: async () => {
      isClosingAll = true;
      // Copy the ids first: every terminal removes itself from the map when it exits.
      const terminalIds = [...runningTerminals.keys()];
      await Promise.all(terminalIds.map((terminalId) => closeTerminal(terminalId)));
    },
  };
}
