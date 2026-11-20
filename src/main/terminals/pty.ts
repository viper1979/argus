import type { TerminalSize } from '@shared/domain/terminal';
import type { TerminalEnvironment } from './build-terminal-environment';

/** A running pseudo terminal; the part of node-pty's `IPty` Argus needs. */
export interface PtyProcess {
  /**
   * Registers a listener for output of the process.
   * @param listener Receives each chunk of output as text.
   */
  onData(listener: (data: string) => void): void;

  /**
   * Registers a listener for the end of the process.
   * @param listener Receives the exit code.
   */
  onExit(listener: (exitCode: number) => void): void;

  /**
   * Sends input to the process, e.g. keystrokes.
   * @param data Text as typed in the terminal.
   */
  write(data: string): void;

  /**
   * Changes the size of the pseudo terminal.
   * @param size New size in character cells.
   */
  resize(size: TerminalSize): void;

  /** Ends the process; its end is reported through {@link onExit}. */
  kill(): void;
}

/** Where and how a pseudo terminal is started. */
export interface PtySpawnOptions extends TerminalSize {
  /** Working directory of the process. */
  readonly cwd: string;
  readonly env: TerminalEnvironment;
}

/**
 * Starts a process in a new pseudo terminal.
 * @param executable Program to start, e.g. `pwsh.exe`.
 * @param args Command-line arguments.
 * @param options Working directory, environment and size.
 * @returns The running process.
 * @throws ShellExecutableNotFoundError if the program does not exist.
 */
export type SpawnPty = (
  executable: string,
  args: readonly string[],
  options: PtySpawnOptions,
) => PtyProcess;
