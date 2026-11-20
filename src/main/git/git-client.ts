import { win32 } from 'node:path';

/** Outcome of one git call. */
export interface GitResult {
  readonly exitCode: number;
  readonly stdout: string;
}

/**
 * Runs `git` with the given arguments; the seam that keeps git out of unit tests.
 * @param args Arguments after `git`, e.g. `['rev-parse', '--show-toplevel']`.
 * @param cwd Working directory of the call.
 */
export type GitRunner = (args: readonly string[], cwd: string) => Promise<GitResult>;

/** The git queries Argus needs for projects. */
export interface GitClient {
  /**
   * Determines the branch new tasks are based on by default.
   * @param repoPath Root of the repository.
   * @returns The remote default branch (`origin/HEAD`), otherwise `main` or `master`.
   */
  detectMainBranch(repoPath: string): Promise<string>;

  /**
   * Finds the root of the repository a folder belongs to.
   * @param folderPath Any folder, e.g. one picked in a dialog.
   * @returns The repository root as Windows path, or `null` if the folder is no Git repository.
   */
  resolveRepositoryRoot(folderPath: string): Promise<string | null>;
}

/** Exit code of a successful git call. */
export const GIT_SUCCESS = 0;

/** Local branches tried in this order when the remote has no default branch. */
const MAIN_BRANCH_CANDIDATES = ['main', 'master'] as const;

/** Suggested main branch when no candidate exists. */
const DEFAULT_MAIN_BRANCH = 'main';

/** Remote whose default branch is preferred as main branch. */
const DEFAULT_REMOTE_PREFIX = 'origin/';

/**
 * Creates a git client on top of a runner.
 * @param runGit Executes git; a real process in production, a fake in tests.
 * @returns The client.
 */
export function createGitClient(runGit: GitRunner): GitClient {
  return {
    detectMainBranch: async (repoPath) => {
      const remoteHead = await runGit(
        ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'],
        repoPath,
      );
      if (remoteHead.exitCode === GIT_SUCCESS) {
        return remoteHead.stdout.trim().slice(DEFAULT_REMOTE_PREFIX.length);
      }

      for (const candidate of MAIN_BRANCH_CANDIDATES) {
        const localBranch = await runGit(
          ['show-ref', '--verify', '--quiet', `refs/heads/${candidate}`],
          repoPath,
        );
        if (localBranch.exitCode === GIT_SUCCESS) {
          return candidate;
        }
      }
      // Neither exists, e.g. a repository without commits: suggest the modern default,
      // the user can still change it in the project settings.
      return DEFAULT_MAIN_BRANCH;
    },

    resolveRepositoryRoot: async (folderPath) => {
      const topLevel = await runGit(['rev-parse', '--show-toplevel'], folderPath);
      if (topLevel.exitCode !== GIT_SUCCESS) {
        return null;
      }
      // git prints forward slashes even on Windows (ADR 0002); normalize to D:\...
      return win32.normalize(topLevel.stdout.trim());
    },
  };
}
