import { beforeEach, describe, expect, it } from 'vitest';
import { createGitClient, type GitClient, type GitResult, type GitRunner } from './git-client';

/** Path the fake repository lives at; only used as working directory in the fake. */
const REPO_PATH = 'D:\\Repos\\webshop';

/** Result of a git call that failed, e.g. because a ref does not exist. */
const FAILED: GitResult = { exitCode: 1, stdout: '' };

/**
 * Builds a fake git runner that answers known commands and fails all others.
 * @param answers Map from the space-joined git arguments to the result of that call.
 * @returns A runner usable by {@link createGitClient}.
 */
function createFakeGitRunner(answers: Record<string, GitResult>): GitRunner {
  return (args) => Promise.resolve(answers[args.join(' ')] ?? FAILED);
}

describe('createGitClient', () => {
  let answers: Record<string, GitResult>;
  let gitClient: GitClient;

  beforeEach(() => {
    answers = {};
    gitClient = createGitClient(createFakeGitRunner(answers));
  });

  describe('detectMainBranch', () => {
    it('detectMainBranch_WithOriginHead_ReturnsRemoteDefaultBranch', async () => {
      // Arrange
      answers['symbolic-ref --short refs/remotes/origin/HEAD'] = {
        exitCode: 0,
        stdout: 'origin/develop\n',
      };
      answers['show-ref --verify --quiet refs/heads/main'] = { exitCode: 0, stdout: '' };

      // Act
      const mainBranch = await gitClient.detectMainBranch(REPO_PATH);

      // Assert
      expect(mainBranch).toBe('develop');
    });

    it('detectMainBranch_WithoutOriginHeadButWithMaster_ReturnsMaster', async () => {
      // Arrange
      answers['show-ref --verify --quiet refs/heads/master'] = { exitCode: 0, stdout: '' };

      // Act
      const mainBranch = await gitClient.detectMainBranch(REPO_PATH);

      // Assert
      expect(mainBranch).toBe('master');
    });

    it('detectMainBranch_WithoutOriginHeadButWithMainAndMaster_ReturnsMain', async () => {
      // Arrange
      answers['show-ref --verify --quiet refs/heads/main'] = { exitCode: 0, stdout: '' };
      answers['show-ref --verify --quiet refs/heads/master'] = { exitCode: 0, stdout: '' };

      // Act
      const mainBranch = await gitClient.detectMainBranch(REPO_PATH);

      // Assert
      expect(mainBranch).toBe('main');
    });

    it('detectMainBranch_WithoutAnyKnownBranch_ReturnsMain', async () => {
      // Arrange
      // Nothing to arrange: every git call fails, as in a repository without commits.

      // Act
      const mainBranch = await gitClient.detectMainBranch(REPO_PATH);

      // Assert
      expect(mainBranch).toBe('main');
    });
  });

  describe('resolveRepositoryRoot', () => {
    it('resolveRepositoryRoot_OutsideRepository_ReturnsNull', async () => {
      // Arrange
      // Nothing to arrange: rev-parse fails like in a folder without .git.

      // Act
      const root = await gitClient.resolveRepositoryRoot('D:\\Downloads');

      // Assert
      expect(root).toBeNull();
    });

    it('resolveRepositoryRoot_InSubfolderOfRepository_ReturnsRootAsWindowsPath', async () => {
      // Arrange
      // git reports the root with forward slashes, even on Windows.
      answers['rev-parse --show-toplevel'] = { exitCode: 0, stdout: 'D:/Repos/webshop\n' };

      // Act
      const root = await gitClient.resolveRepositoryRoot('D:\\Repos\\webshop\\src');

      // Assert
      expect(root).toBe(REPO_PATH);
    });
  });
});
