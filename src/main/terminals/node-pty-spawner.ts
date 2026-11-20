import { spawn } from 'node-pty';
import type { SpawnPty } from './pty';
import { ShellExecutableNotFoundError } from './shell-executable-not-found-error';

/** Terminal type announced to the shell; xterm.js understands xterm-256color sequences. */
const TERMINAL_NAME = 'xterm-256color';

/**
 * Start of the message node-pty throws on Windows when the executable does not exist.
 * HACK: node-pty throws a plain Error without code, so the message is the only signal
 * (verified with node-pty 1.1.0: "File not found: "). Re-check when upgrading node-pty.
 */
const FILE_NOT_FOUND_MESSAGE_PREFIX = 'File not found';

/**
 * Creates the production {@link SpawnPty} on top of node-pty with ConPTY (ADR 0002).
 * @returns A spawn function that reports a missing executable as ShellExecutableNotFoundError.
 */
export function createNodePtySpawner(): SpawnPty {
  return (executable, args, { cwd, env, cols, rows }) => {
    try {
      const pty = spawn(executable, [...args], { name: TERMINAL_NAME, cwd, env, cols, rows });
      return {
        onData: (listener) => {
          pty.onData(listener);
        },
        onExit: (listener) => {
          pty.onExit(({ exitCode }) => {
            listener(exitCode);
          });
        },
        write: (data) => {
          pty.write(data);
        },
        resize: ({ cols: newCols, rows: newRows }) => {
          pty.resize(newCols, newRows);
        },
        kill: () => {
          pty.kill();
        },
      };
    } catch (error: unknown) {
      if (error instanceof Error && error.message.startsWith(FILE_NOT_FOUND_MESSAGE_PREFIX)) {
        throw new ShellExecutableNotFoundError(executable, error);
      }
      throw error;
    }
  };
}
