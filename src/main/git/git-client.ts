import { win32 } from 'node:path';
import { GitCommandFailedError } from './git-command-failed-error';

/** Outcome of one git call. */
export interface GitResult {
  readonly exitCode: number;
  readonly stdout: string;
  /** Error output; explains a failure, in the language git is configured for. */
  readonly stderr: string;
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

  /**
   * Updates `origin/<branch>` from the remote `origin`.
   * @param repoPath Root of the repository.
   * @param branch Branch name on the remote, e.g. `main`.
   * @returns Whether the branch was fetched, the repository has no `origin`, the branch does not
   *   exist on origin, or origin was unreachable (with git's message for the log).
   */
  fetchBranch(repoPath: string, branch: string): Promise<FetchBranchResult>;

  /**
   * Lists all local branches, packed or not, with their stored case.
   * @param repoPath Root of the repository.
   * @returns Short branch names, e.g. `main` or `agent/login`.
   * @throws {GitCommandFailedError} If git cannot list them, e.g. because the repository is gone.
   */
  listBranches(repoPath: string): Promise<string[]>;

  /**
   * Finds the commit a branch points to.
   * @param repoPath Root of the repository.
   * @param branch Branch name, e.g. `main`.
   * @param location `local` for the branch itself, `origin` for its fetched copy `origin/<branch>`.
   * @returns The full commit hash, or `null` if there is no such branch.
   */
  resolveBranchCommit(
    repoPath: string,
    branch: string,
    location: BranchLocation,
  ): Promise<string | null>;

  /**
   * Creates a worktree on a new branch that has no upstream (`--no-track`).
   * @param repoPath Root of the main repository.
   * @param worktree Folder, new branch and the commit-ish to start from.
   * @returns Success, or git's explanation why it refused, e.g. because the branch or the folder
   *   already exists. Git may leave the new branch behind on failure.
   */
  addWorktree(repoPath: string, worktree: NewWorktree): Promise<WorktreeChangeResult>;

  /**
   * Removes a worktree and its registration; refuses if it has uncommitted changes.
   * @param repoPath Root of the main repository.
   * @param worktreePath Folder of the worktree.
   * @returns Success, or git's explanation why it refused; a refused removal may still have
   *   deleted part of the folder (e.g. a file locked by another process stops git midway).
   */
  removeWorktree(repoPath: string, worktreePath: string): Promise<WorktreeChangeResult>;

  /**
   * Deletes a branch only if it still points to the given commit, as one atomic step. Used to
   * undo a branch Argus has just created: a branch still at its start commit carries no work, so
   * nothing can be lost (unlike `git branch -D`, see CLAUDE.md).
   * @param repoPath Root of the repository.
   * @param branch The branch, e.g. `agent/login`.
   * @param expectedCommit Full hash the branch was created at.
   * @returns `true` if the branch was deleted; `false` if it moved meanwhile or does not exist.
   */
  deleteBranchIfUnchanged(
    repoPath: string,
    branch: string,
    expectedCommit: string,
  ): Promise<boolean>;
}

/** Outcome of {@link GitClient.addWorktree} and {@link GitClient.removeWorktree}. */
export type WorktreeChangeResult =
  { readonly ok: true } | { readonly ok: false; readonly gitMessage: string };

/** What {@link GitClient.addWorktree} creates. */
export interface NewWorktree {
  /** Folder of the worktree, e.g. `D:\Worktrees\Webshop\login`; missing parents are created. */
  readonly path: string;
  /** New branch, e.g. `agent/login`. */
  readonly branch: string;
  /** Commit-ish the branch starts at, e.g. `origin/main` or `main`. */
  readonly startPoint: string;
}

/** Whether a branch is meant as local branch or as its copy fetched from origin. */
export type BranchLocation = 'local' | 'origin';

/** Outcome of {@link GitClient.fetchBranch}; an unreachable origin comes with git's explanation. */
export type FetchBranchResult =
  | { readonly outcome: 'fetched' | 'no-origin' | 'not-on-remote' }
  | { readonly outcome: 'unreachable'; readonly gitMessage: string };

/** Exit code of a successful git call. */
export const GIT_SUCCESS = 0;

/** Exit code of `git ls-remote --exit-code` when the remote answered but has no such ref. */
const LS_REMOTE_NO_MATCHING_REF = 2;

/** Local branches tried in this order when the remote has no default branch. */
const MAIN_BRANCH_CANDIDATES = ['main', 'master'] as const;

/** Suggested main branch when no candidate exists. */
const DEFAULT_MAIN_BRANCH = 'main';

/** Namespace of local branches; `for-each-ref` reads loose and packed refs below it. */
const LOCAL_BRANCHES_NAMESPACE = 'refs/heads/';

/** The remote Argus fetches base branches from (concept 5.2, step 2). */
const ORIGIN = 'origin';

/** Remote whose default branch is preferred as main branch. */
const DEFAULT_REMOTE_PREFIX = `${ORIGIN}/`;

/** Namespace of the branches fetched from origin, i.e. `origin/<branch>`. */
const REMOTE_BRANCHES_NAMESPACE = `refs/remotes/${ORIGIN}/`;

/**
 * Creates a git client on top of a runner.
 * @param runGit Executes git; a real process in production, a fake in tests.
 * @returns The client.
 */
export function createGitClient(runGit: GitRunner): GitClient {
  return {
    detectMainBranch: async (repoPath) => {
      const remoteHead = await runGit(
        ['symbolic-ref', '--short', `${REMOTE_BRANCHES_NAMESPACE}HEAD`],
        repoPath,
      );
      if (remoteHead.exitCode === GIT_SUCCESS) {
        return remoteHead.stdout.trim().slice(DEFAULT_REMOTE_PREFIX.length);
      }

      for (const candidate of MAIN_BRANCH_CANDIDATES) {
        const localBranch = await runGit(
          ['show-ref', '--verify', '--quiet', `${LOCAL_BRANCHES_NAMESPACE}${candidate}`],
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

    fetchBranch: async (repoPath, branch) => {
      const originUrl = await runGit(['remote', 'get-url', ORIGIN], repoPath);
      if (originUrl.exitCode !== GIT_SUCCESS) {
        return { outcome: 'no-origin' };
      }
      // On the remote the branch is a local branch, hence refs/heads/.
      const remoteRef = `${LOCAL_BRANCHES_NAMESPACE}${branch}`;
      // Asking first separates "no such branch" from "no connection" by exit code, independent
      // of the language git prints its messages in.
      const lookup = await runGit(['ls-remote', '--exit-code', ORIGIN, remoteRef], repoPath);
      if (lookup.exitCode === LS_REMOTE_NO_MATCHING_REF) {
        return { outcome: 'not-on-remote' };
      }
      if (lookup.exitCode !== GIT_SUCCESS) {
        return { outcome: 'unreachable', gitMessage: lookup.stderr.trim() };
      }
      // Explicit refspec: also updates origin/<branch> in clones made with --single-branch.
      const refspec = `${remoteRef}:${REMOTE_BRANCHES_NAMESPACE}${branch}`;
      const fetch = await runGit(['fetch', '--quiet', '--no-tags', ORIGIN, refspec], repoPath);
      return fetch.exitCode === GIT_SUCCESS
        ? { outcome: 'fetched' }
        : { outcome: 'unreachable', gitMessage: fetch.stderr.trim() };
    },

    addWorktree: async (repoPath, worktree) => {
      const add = await runGit(
        [
          'worktree',
          'add',
          '--quiet',
          // Without it, a branch started at origin/main would track main and push there.
          '--no-track',
          '-b',
          worktree.branch,
          worktree.path,
          worktree.startPoint,
        ],
        repoPath,
      );
      return add.exitCode === GIT_SUCCESS
        ? { ok: true }
        : { ok: false, gitMessage: add.stderr.trim() };
    },

    removeWorktree: async (repoPath, worktreePath) => {
      const remove = await runGit(['worktree', 'remove', worktreePath], repoPath);
      return remove.exitCode === GIT_SUCCESS
        ? { ok: true }
        : { ok: false, gitMessage: remove.stderr.trim() };
    },

    deleteBranchIfUnchanged: async (repoPath, branch, expectedCommit) => {
      // With an old value, update-ref deletes only if the ref still has it (compare and delete).
      const deletion = await runGit(
        ['update-ref', '-d', `${LOCAL_BRANCHES_NAMESPACE}${branch}`, expectedCommit],
        repoPath,
      );
      return deletion.exitCode === GIT_SUCCESS;
    },

    listBranches: async (repoPath) => {
      const command = ['for-each-ref', '--format=%(refname:strip=2)', LOCAL_BRANCHES_NAMESPACE];
      const refs = await runGit(command, repoPath);
      // An empty list would look like "no conflicts" and skip the prefix and name checks.
      if (refs.exitCode !== GIT_SUCCESS) {
        throw new GitCommandFailedError(command, refs.exitCode, refs.stderr.trim());
      }
      return refs.stdout.split('\n').filter((line) => line !== '');
    },

    resolveBranchCommit: async (repoPath, branch, location) => {
      const ref =
        location === 'origin'
          ? `${REMOTE_BRANCHES_NAMESPACE}${branch}`
          : `${LOCAL_BRANCHES_NAMESPACE}${branch}`;
      // `^{commit}` makes rev-parse fail for anything that is not a commit.
      const revParse = await runGit(
        ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`],
        repoPath,
      );
      return revParse.exitCode === GIT_SUCCESS ? revParse.stdout.trim() : null;
    },
  };
}
