import { execFile, type ExecFileException } from 'node:child_process';
import { GIT_SUCCESS, type GitResult, type GitRunner } from './git-client';
import { GitUnavailableError } from './git-unavailable-error';

/**
 * Creates a runner that executes the `git` found on the PATH.
 * A non-zero exit code is a normal result (e.g. a missing ref); only a failure to start git,
 * such as git not being installed, rejects with {@link GitUnavailableError}.
 * @returns The runner.
 */
export function createProcessGitRunner(): GitRunner {
  return (args, cwd) =>
    new Promise<GitResult>((resolve, reject) => {
      execFile('git', args, { cwd, windowsHide: true }, (error, stdout, stderr) => {
        if (error === null) {
          resolve({ exitCode: GIT_SUCCESS, stdout, stderr });
          return;
        }
        const exitCode = readExitCode(error);
        if (exitCode === null) {
          reject(new GitUnavailableError(error));
          return;
        }
        resolve({ exitCode, stdout, stderr });
      });
    });
}

/**
 * Extracts the exit code of a git process that ran but failed.
 * @param error The error passed by `execFile`.
 * @returns The exit code, or `null` if git did not run at all (then `code` is e.g. `ENOENT`).
 */
function readExitCode(error: ExecFileException): number | null {
  return typeof error.code === 'number' ? error.code : null;
}
