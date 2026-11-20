import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGitClient, type GitClient } from './git-client';
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
