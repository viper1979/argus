import { beforeEach, describe, expect, it } from 'vitest';
import { GitUnavailableError } from '../git/git-unavailable-error';
import { createAppStateHolder } from '../persistence/app-state-holder';
import { FakeStateStore } from '../persistence/testing/fake-state-store';
import {
  createProjectService,
  type ProjectGitClient,
  type ProjectService,
} from './project-service';

/** Fixed id so that created projects can be compared with literals. */
const PROJECT_ID = '6f1c2b8e-1d2a-4c3b-9e4f-5a6b7c8d9e0f';

/** Id of a second project in tests with two projects. */
const OTHER_PROJECT_ID = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

/** Stand-in for git that knows a fixed set of repositories. */
class FakeGitClient implements ProjectGitClient {
  /** Repository root per folder path; folders not listed are no repository. */
  readonly repositoryRoots = new Map<string, string>();
  mainBranch = 'main';

  /** Returns the configured main branch. */
  detectMainBranch(): Promise<string> {
    return Promise.resolve(this.mainBranch);
  }

  /** Looks the folder up in {@link repositoryRoots}. */
  resolveRepositoryRoot(folderPath: string): Promise<string | null> {
    return Promise.resolve(this.repositoryRoots.get(folderPath) ?? null);
  }
}

describe('createProjectService', () => {
  let stateStore: FakeStateStore;
  let gitClient: FakeGitClient;
  let projectService: ProjectService;

  beforeEach(() => {
    stateStore = new FakeStateStore();
    gitClient = new FakeGitClient();
    projectService = createProjectService({
      gitClient,
      stateHolder: createAppStateHolder(stateStore),
      generateId: () => PROJECT_ID,
    });
  });

  it('add_WithFolderOutsideRepository_ReturnsNotAGitRepositoryAndSavesNothing', async () => {
    // Arrange
    // Nothing to arrange: the fake git knows no repository.

    // Act
    const result = await projectService.add('D:\\Downloads');

    // Assert
    expect(result).toEqual({ ok: false, reason: 'not-a-git-repository' });
    expect(stateStore.savedState).toBeNull();
  });

  it('add_WithSubfolderOfRepository_PersistsProjectWithDefaults', async () => {
    // Arrange
    gitClient.repositoryRoots.set('D:\\Repos\\webshop\\src', 'D:\\Repos\\webshop');
    gitClient.mainBranch = 'develop';

    // Act
    const result = await projectService.add('D:\\Repos\\webshop\\src');

    // Assert
    const expectedProject = {
      id: PROJECT_ID,
      name: 'webshop',
      repoPath: 'D:\\Repos\\webshop',
      mainBranch: 'develop',
      branchPrefix: 'agent',
      defaultAgentType: 'claude-code',
      setupScript: null,
    };
    expect(result).toEqual({ ok: true, project: expectedProject });
    expect(stateStore.savedState?.projects).toEqual([expectedProject]);
  });

  it('add_WithAlreadyRegisteredRepositoryInOtherCase_ReturnsAlreadyRegistered', async () => {
    // Arrange
    // Windows paths are case-insensitive: both spellings are the same repository.
    gitClient.repositoryRoots.set('D:\\Repos\\webshop', 'D:\\Repos\\webshop');
    gitClient.repositoryRoots.set('d:\\repos\\WEBSHOP', 'd:\\repos\\WEBSHOP');
    await projectService.add('D:\\Repos\\webshop');

    // Act
    const result = await projectService.add('d:\\repos\\WEBSHOP');

    // Assert
    expect(result).toEqual({ ok: false, reason: 'already-registered' });
    expect(stateStore.savedState?.projects).toHaveLength(1);
  });

  it('add_WithRepositoryAtDriveRoot_UsesDriveLetterAsName', async () => {
    // Arrange
    // The folder name of "D:\" is empty, which is no valid project name.
    gitClient.repositoryRoots.set('D:\\', 'D:\\');

    // Act
    const result = await projectService.add('D:\\');

    // Assert
    expect(result.ok && result.project.name).toBe('D');
  });

  it('add_WhenGitIsNotInstalled_ReturnsGitUnavailable', async () => {
    // Arrange
    gitClient.resolveRepositoryRoot = () =>
      Promise.reject(new GitUnavailableError(new Error('spawn git ENOENT')));

    // Act
    const result = await projectService.add('D:\\Repos\\webshop');

    // Assert
    expect(result).toEqual({ ok: false, reason: 'git-unavailable' });
  });

  it('add_WithSecondRepositoryOfSameFolderName_AddsNumberedName', async () => {
    // Arrange
    // Project names become worktree folders, so two "webshop" repositories must not collide.
    gitClient.repositoryRoots.set('D:\\Repos\\webshop', 'D:\\Repos\\webshop');
    gitClient.repositoryRoots.set('E:\\Kunde\\Webshop', 'E:\\Kunde\\Webshop');
    let nextId = 0;
    const ids = [PROJECT_ID, OTHER_PROJECT_ID];
    const service = createProjectService({
      gitClient,
      stateHolder: createAppStateHolder(stateStore),
      generateId: () => ids[nextId++] ?? PROJECT_ID,
    });
    await service.add('D:\\Repos\\webshop');

    // Act
    const result = await service.add('E:\\Kunde\\Webshop');

    // Assert
    expect(result.ok && result.project.name).toBe('Webshop (2)');
  });

  it('update_WithNameOfOtherProjectInOtherCase_ReturnsNameTaken', async () => {
    // Arrange
    gitClient.repositoryRoots.set('D:\\Repos\\webshop', 'D:\\Repos\\webshop');
    gitClient.repositoryRoots.set('D:\\Repos\\shop-api', 'D:\\Repos\\shop-api');
    let nextId = 0;
    const ids = [PROJECT_ID, OTHER_PROJECT_ID];
    const service = createProjectService({
      gitClient,
      stateHolder: createAppStateHolder(stateStore),
      generateId: () => ids[nextId++] ?? PROJECT_ID,
    });
    await service.add('D:\\Repos\\webshop');
    await service.add('D:\\Repos\\shop-api');

    // Act
    const result = await service.update(OTHER_PROJECT_ID, {
      name: 'WEBSHOP',
      mainBranch: 'main',
      branchPrefix: 'agent',
      defaultAgentType: 'claude-code',
      setupScript: null,
    });

    // Assert
    expect(result).toEqual({ ok: false, reason: 'name-taken' });
    expect(stateStore.savedState?.projects.map((project) => project.name)).toEqual([
      'webshop',
      'shop-api',
    ]);
  });

  it('update_WithExistingProject_PersistsNewSettings', async () => {
    // Arrange
    gitClient.repositoryRoots.set('D:\\Repos\\webshop', 'D:\\Repos\\webshop');
    await projectService.add('D:\\Repos\\webshop');
    const newSettings = {
      name: 'Webshop',
      mainBranch: 'release',
      branchPrefix: 'claude',
      defaultAgentType: 'claude-code',
      setupScript: 'Copy-Item $env:ARGUS_ROOT_PATH\\.env .env',
    } as const;

    // Act
    const result = await projectService.update(PROJECT_ID, newSettings);

    // Assert
    const expectedProject = { id: PROJECT_ID, repoPath: 'D:\\Repos\\webshop', ...newSettings };
    expect(result).toEqual({ ok: true, project: expectedProject });
    expect(stateStore.savedState?.projects).toEqual([expectedProject]);
  });

  it('update_WithUnknownProject_ReturnsNotFound', async () => {
    // Arrange
    // Nothing to arrange: no project is registered.

    // Act
    const result = await projectService.update(PROJECT_ID, {
      name: 'Webshop',
      mainBranch: 'main',
      branchPrefix: 'agent',
      defaultAgentType: 'claude-code',
      setupScript: null,
    });

    // Assert
    expect(result).toEqual({ ok: false, reason: 'not-found' });
  });

  it('remove_WithRegisteredProject_RemovesItFromState', async () => {
    // Arrange
    gitClient.repositoryRoots.set('D:\\Repos\\webshop', 'D:\\Repos\\webshop');
    await projectService.add('D:\\Repos\\webshop');

    // Act
    await projectService.remove(PROJECT_ID);

    // Assert
    // Only the state changes; the service has no file system access to the repository at all.
    expect(stateStore.savedState?.projects).toEqual([]);
  });

  it('list_AfterRestart_ReturnsPersistedProjects', async () => {
    // Arrange
    gitClient.repositoryRoots.set('D:\\Repos\\webshop', 'D:\\Repos\\webshop');
    await projectService.add('D:\\Repos\\webshop');
    const serviceAfterRestart = createProjectService({
      gitClient,
      stateHolder: createAppStateHolder(stateStore),
      generateId: () => PROJECT_ID,
    });

    // Act
    const projects = await serviceAfterRestart.list();

    // Assert
    expect(projects.map((project) => project.repoPath)).toEqual(['D:\\Repos\\webshop']);
  });
});
