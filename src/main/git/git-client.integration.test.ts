import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGitClient, type GitClient } from './git-client';
import { GitCommandFailedError } from './git-command-failed-error';
import { createProcessGitRunner } from './process-git-runner';

/**
 * Runs git synchronously to prepare a test repository; fails the test on any git error.
 * Identity is passed per call so the tests do not depend on the user's git config.
 * @param cwd Working directory.
 * @param args Arguments after `git`.
 */
function git(cwd: string, ...args: string[]): void {
  execFileSync(
    'git',
    ['-c', 'user.name=Argus Test', '-c', 'user.email=test@argus.invalid', ...args],
    {
      cwd,
      stdio: 'ignore',
    },
  );
}

/**
 * Runs git synchronously to inspect a test repository.
 * @param cwd Working directory.
 * @param args Arguments after `git`.
 * @returns Trimmed standard output, or `null` if git exited with an error.
 */
function gitOutput(cwd: string, ...args: string[]): string | null {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
  } catch {
    return null;
  }
}

/**
 * Creates a repository with one commit on the given branch.
 * @param path Folder of the new repository.
 * @param branch Name of the initial branch.
 */
async function createRepositoryWithCommit(path: string, branch: string): Promise<void> {
  await mkdir(path, { recursive: true });
  git(path, 'init', '--quiet', '--initial-branch', branch);
  git(path, 'commit', '--quiet', '--allow-empty', '--message', 'initial');
}

describe('createGitClient with real git', () => {
  let directory: string;
  let gitClient: GitClient;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'argus-git-client-'));
    gitClient = createGitClient(createProcessGitRunner());
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('resolveRepositoryRoot_InSubfolderOfRealRepository_ReturnsRoot', async () => {
    // Arrange
    const repoPath = join(directory, 'webshop');
    await createRepositoryWithCommit(repoPath, 'main');
    const subfolder = join(repoPath, 'src');
    await mkdir(subfolder);

    // Act
    const root = await gitClient.resolveRepositoryRoot(subfolder);

    // Assert
    // Windows paths are case-insensitive; git may report the drive letter in another case.
    expect(root?.toLowerCase()).toBe(repoPath.toLowerCase());
  });

  it('resolveRepositoryRoot_InFolderWithoutRepository_ReturnsNull', async () => {
    // Arrange
    const plainFolder = join(directory, 'plain');
    await mkdir(plainFolder);

    // Act
    const root = await gitClient.resolveRepositoryRoot(plainFolder);

    // Assert
    expect(root).toBeNull();
  });

  it('detectMainBranch_InCloneOfRepository_ReturnsDefaultBranchOfOrigin', async () => {
    // Arrange
    const originPath = join(directory, 'origin');
    await createRepositoryWithCommit(originPath, 'trunk');
    const clonePath = join(directory, 'clone');
    git(directory, 'clone', '--quiet', originPath, clonePath);

    // Act
    const mainBranch = await gitClient.detectMainBranch(clonePath);

    // Assert
    expect(mainBranch).toBe('trunk');
  });

  it('fetchBranch_WithBranchCreatedOnOriginAfterClone_FetchesItAsRemoteBranch', async () => {
    // Arrange
    const originPath = join(directory, 'origin');
    await createRepositoryWithCommit(originPath, 'main');
    const clonePath = join(directory, 'clone');
    git(directory, 'clone', '--quiet', originPath, clonePath);
    git(originPath, 'branch', 'release');

    // Act
    const result = await gitClient.fetchBranch(clonePath, 'release');

    // Assert
    expect(result).toEqual({ outcome: 'fetched' });
    expect(await gitClient.resolveBranchCommit(clonePath, 'release', 'origin')).toBe(
      gitOutput(originPath, 'rev-parse', 'release'),
    );
  });

  it('resolveBranchCommit_ForLocalAndUnknownBranch_ReturnsCommitOrNull', async () => {
    // Arrange
    const repoPath = join(directory, 'webshop');
    await createRepositoryWithCommit(repoPath, 'main');

    // Act
    const mainCommit = await gitClient.resolveBranchCommit(repoPath, 'main', 'local');
    const unknownCommit = await gitClient.resolveBranchCommit(repoPath, 'gibt-es-nicht', 'local');

    // Assert
    expect(mainCommit).toBe(gitOutput(repoPath, 'rev-parse', 'main'));
    expect(unknownCommit).toBeNull();
  });

  it('fetchBranch_WithBranchMissingOnOrigin_ReturnsNotOnRemote', async () => {
    // Arrange
    const originPath = join(directory, 'origin');
    await createRepositoryWithCommit(originPath, 'main');
    const clonePath = join(directory, 'clone');
    git(directory, 'clone', '--quiet', originPath, clonePath);

    // Act
    const result = await gitClient.fetchBranch(clonePath, 'does-not-exist');

    // Assert
    expect(result).toEqual({ outcome: 'not-on-remote' });
  });

  it('fetchBranch_WhenOriginIsGone_ReturnsUnreachable', async () => {
    // Arrange
    // Stands in for a network failure: the remote cannot be contacted at all.
    const originPath = join(directory, 'origin');
    await createRepositoryWithCommit(originPath, 'main');
    const clonePath = join(directory, 'clone');
    git(directory, 'clone', '--quiet', originPath, clonePath);
    await rm(originPath, { recursive: true, force: true });

    // Act
    const result = await gitClient.fetchBranch(clonePath, 'main');

    // Assert
    // The git message ends up in the log, so a failed fetch can be explained later.
    expect(result).toEqual({
      outcome: 'unreachable',
      gitMessage: expect.stringMatching(/\S/) as string,
    });
  });

  it('fetchBranch_InRepositoryWithoutOrigin_ReturnsNoOrigin', async () => {
    // Arrange
    const repoPath = join(directory, 'local-only');
    await createRepositoryWithCommit(repoPath, 'main');

    // Act
    const result = await gitClient.fetchBranch(repoPath, 'main');

    // Assert
    expect(result).toEqual({ outcome: 'no-origin' });
  });

  it('addWorktree_FromRemoteBranchIntoMissingFolder_CreatesBranchWithoutUpstream', async () => {
    // Arrange
    const originPath = join(directory, 'origin');
    await createRepositoryWithCommit(originPath, 'main');
    const clonePath = join(directory, 'clone');
    git(directory, 'clone', '--quiet', originPath, clonePath);
    // The project folder below the worktree root does not exist yet, as for a first task.
    const worktreePath = join(directory, 'worktrees', 'Webshop', 'login');

    // Act
    const result = await gitClient.addWorktree(clonePath, {
      path: worktreePath,
      branch: 'agent/login',
      startPoint: 'origin/main',
    });

    // Assert
    expect(result).toEqual({ ok: true });
    expect(gitOutput(worktreePath, 'branch', '--show-current')).toBe('agent/login');
    // Without --no-track the branch would track origin/main and `git push` would target main.
    expect(gitOutput(worktreePath, 'rev-parse', '--abbrev-ref', '@{upstream}')).toBeNull();
  });

  it.each([
    ['branch already exists', 'agent/login'],
    ['a branch named like the prefix exists', 'agent'],
  ])(
    'addWorktree_WhenBranchCannotBeCreated_ReturnsGitMessageAndLeavesNoFolder (%s)',
    async (_reason, existingBranch) => {
      // Arrange
      const repoPath = join(directory, 'webshop');
      await createRepositoryWithCommit(repoPath, 'main');
      git(repoPath, 'branch', existingBranch);
      const worktreePath = join(directory, 'worktrees', 'Webshop', 'login');

      // Act
      const result = await gitClient.addWorktree(repoPath, {
        path: worktreePath,
        branch: 'agent/login',
        startPoint: 'main',
      });

      // Assert
      // The wording depends on git's language, so only check that git explained itself.
      expect(result).toEqual({ ok: false, gitMessage: expect.stringMatching(/\S/) as string });
      await expect(stat(worktreePath)).rejects.toMatchObject({ code: 'ENOENT' });
    },
  );

  it('addWorktree_AtPathOfDeletedButRegisteredWorktree_FailsAndLeavesNewBranchBehind', async () => {
    // Arrange
    // Documents the git behaviour Argus has to clean up after: the branch is created first.
    const repoPath = join(directory, 'webshop');
    await createRepositoryWithCommit(repoPath, 'main');
    const worktreePath = join(directory, 'worktrees', 'Webshop', 'login');
    git(repoPath, 'worktree', 'add', '--quiet', '-b', 'agent/old', worktreePath, 'main');
    await rm(worktreePath, { recursive: true, force: true });

    // Act
    const result = await gitClient.addWorktree(repoPath, {
      path: worktreePath,
      branch: 'agent/login',
      startPoint: 'main',
    });

    // Assert
    expect(result.ok).toBe(false);
    expect(await gitClient.listBranches(repoPath)).toContain('agent/login');
  });

  it('deleteBranchIfUnchanged_WhenBranchStillAtStartCommit_DeletesIt', async () => {
    // Arrange
    const repoPath = join(directory, 'webshop');
    await createRepositoryWithCommit(repoPath, 'main');
    git(repoPath, 'branch', 'agent/login', 'main');
    const startCommit = gitOutput(repoPath, 'rev-parse', 'main') ?? '';

    // Act
    const isDeleted = await gitClient.deleteBranchIfUnchanged(repoPath, 'agent/login', startCommit);

    // Assert
    expect(isDeleted).toBe(true);
    expect(await gitClient.listBranches(repoPath)).toEqual(['main']);
  });

  it('deleteBranchIfUnchanged_WhenBranchGotCommits_KeepsIt', async () => {
    // Arrange
    // Stands in for work done on the branch meanwhile; it must never be lost.
    const repoPath = join(directory, 'webshop');
    await createRepositoryWithCommit(repoPath, 'main');
    const startCommit = gitOutput(repoPath, 'rev-parse', 'main') ?? '';
    git(repoPath, 'switch', '--quiet', '-c', 'agent/login');
    git(repoPath, 'commit', '--quiet', '--allow-empty', '--message', 'work');
    git(repoPath, 'switch', '--quiet', 'main');

    // Act
    const isDeleted = await gitClient.deleteBranchIfUnchanged(repoPath, 'agent/login', startCommit);

    // Assert
    expect(isDeleted).toBe(false);
    expect(await gitClient.listBranches(repoPath)).toContain('agent/login');
  });

  it('removeWorktree_ForFreshWorktree_RemovesFolderAndRegistration', async () => {
    // Arrange
    const repoPath = join(directory, 'webshop');
    await createRepositoryWithCommit(repoPath, 'main');
    const worktreePath = join(directory, 'worktrees', 'Webshop', 'login');
    git(repoPath, 'worktree', 'add', '--quiet', '-b', 'agent/login', worktreePath, 'main');

    // Act
    const result = await gitClient.removeWorktree(repoPath, worktreePath);

    // Assert
    expect(result).toEqual({ ok: true });
    await expect(stat(worktreePath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(gitOutput(repoPath, 'worktree', 'list', '--porcelain')).not.toContain('login');
  });

  it('removeWorktree_WithUntrackedFile_RefusesWithGitMessageAndKeepsWorktree', async () => {
    // Arrange
    // E.g. a post-checkout hook created a file; git refuses to delete it without --force.
    const repoPath = join(directory, 'webshop');
    await createRepositoryWithCommit(repoPath, 'main');
    const worktreePath = join(directory, 'worktrees', 'Webshop', 'login');
    git(repoPath, 'worktree', 'add', '--quiet', '-b', 'agent/login', worktreePath, 'main');
    await writeFile(join(worktreePath, 'generated.txt'), 'from a hook');

    // Act
    const result = await gitClient.removeWorktree(repoPath, worktreePath);

    // Assert
    expect(result).toEqual({ ok: false, gitMessage: expect.stringMatching(/\S/) as string });
    expect(gitOutput(worktreePath, 'branch', '--show-current')).toBe('agent/login');
  });

  it('listBranches_WithPackedAndLooseBranches_ReturnsAllWithTheirCase', async () => {
    // Arrange
    const repoPath = join(directory, 'webshop');
    await createRepositoryWithCommit(repoPath, 'main');
    git(repoPath, 'branch', 'Agent');
    // Packed refs are not files below refs/heads; `show-ref` would miss `agent` vs. `Agent`.
    git(repoPath, 'pack-refs', '--all');
    git(repoPath, 'branch', 'feature/login/draft');

    // Act
    const branches = await gitClient.listBranches(repoPath);

    // Assert
    expect([...branches].sort()).toEqual(['Agent', 'feature/login/draft', 'main']);
  });

  it('listBranches_WhenGitFails_RejectsWithGitMessageInsteadOfReturningNoBranches', async () => {
    // Arrange
    // An empty list would silently skip the prefix check and the name uniqueness.
    const plainFolder = join(directory, 'plain');
    await mkdir(plainFolder);

    // Act
    const listing = gitClient.listBranches(plainFolder);

    // Assert
    await expect(listing).rejects.toBeInstanceOf(GitCommandFailedError);
    await expect(listing).rejects.toMatchObject({
      gitMessage: expect.stringMatching(/\S/) as string,
    });
  });

  it('detectMainBranch_InRepositoryWithOnlyMaster_ReturnsMaster', async () => {
    // Arrange
    const repoPath = join(directory, 'legacy');
    await createRepositoryWithCommit(repoPath, 'master');

    // Act
    const mainBranch = await gitClient.detectMainBranch(repoPath);

    // Assert
    expect(mainBranch).toBe('master');
  });
});
