import { DEFAULT_SETTINGS } from '@shared/domain/settings';
import type { Project } from '@shared/domain/project';
import type { CreateTaskRequest, Task } from '@shared/domain/task';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type {
  WorktreeChangeResult,
  BranchLocation,
  FetchBranchResult,
  NewWorktree,
} from '../git/git-client';
import { GitUnavailableError } from '../git/git-unavailable-error';
import type { Logger } from '../logging/logger';
import { createEmptyAppState, type AppState } from '../persistence/app-state';
import { createAppStateHolder } from '../persistence/app-state-holder';
import { FakeStateStore } from '../persistence/testing/fake-state-store';
import { createTaskService, type TaskGitClient, type TaskService } from './task-service';

/** Fixed id so that created tasks can be compared with literals. */
const TASK_ID = '3c9e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a';

/** Commit `origin/main` points to after the fetch. */
const ORIGIN_MAIN_COMMIT = '1111111111111111111111111111111111111111';

/** Commit the local `main` points to; differs from origin, as after commits not yet pulled. */
const LOCAL_MAIN_COMMIT = '2222222222222222222222222222222222222222';

/** The project all tests create tasks in. */
const WEBSHOP: Project = {
  id: '6f1c2b8e-1d2a-4c3b-9e4f-5a6b7c8d9e0f',
  name: 'Webshop',
  repoPath: 'D:\\Repos\\webshop',
  mainBranch: 'main',
  branchPrefix: 'agent',
  defaultAgentType: 'claude-code',
  setupScript: null,
};

/** Id of a project other than {@link WEBSHOP}. */
const OTHER_PROJECT_ID = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

/** Where the task of {@link LOGIN_REQUEST} ends up. */
const LOGIN_WORKTREE_PATH = 'D:\\Worktrees\\Webshop\\login';

/** A request as the dialog sends it with its defaults. */
const LOGIN_REQUEST: CreateTaskRequest = {
  projectId: WEBSHOP.id,
  name: 'Login',
  baseBranch: 'main',
  startPrompt: 'Baue den Login um.',
  agentType: 'claude-code',
};

/** What git reports when origin cannot be contacted. */
const UNREACHABLE_GIT_MESSAGE = 'fatal: unable to access origin: Could not resolve host';

/** What git reports when it refuses to remove a worktree with untracked files. */
const REMOVE_REFUSED_GIT_MESSAGE = "fatal: 'D:/Worktrees/Webshop/login' contains untracked files";

/** Error a fake call rejects with when git is not installed. */
function gitMissingError(): GitUnavailableError {
  return new GitUnavailableError(new Error('spawn git ENOENT'));
}

/** Stand-in for git that keeps branches in memory and records what was changed. */
class FakeGitClient implements TaskGitClient {
  /** Local branches, e.g. `main` or `agent/login`. */
  branches: string[] = ['main'];
  /** Commit per `<location>:<branch>`; branches not listed do not resolve. */
  readonly commits = new Map<string, string>([['origin:main', ORIGIN_MAIN_COMMIT]]);
  fetchOutcome: FetchBranchResult['outcome'] = 'fetched';
  /** Result `addWorktree` reports. */
  addWorktreeResult: WorktreeChangeResult = { ok: true };
  /** Runs right before a failing `addWorktree` returns, e.g. to let a branch appear meanwhile. */
  onFailingAdd: () => void = () => undefined;
  /** Branches `deleteBranchIfUnchanged` must keep, because they moved meanwhile. */
  readonly movedBranches = new Set<string>();
  /** When `true`, the git queries fail as if git were not installed. */
  isGitMissing = false;
  readonly addedWorktrees: NewWorktree[] = [];
  readonly removedWorktrees: string[] = [];
  readonly deletedBranches: { branch: string; expectedCommit: string }[] = [];

  /** Returns the configured outcome; an unreachable origin comes with a git message. */
  fetchBranch(): Promise<FetchBranchResult> {
    if (this.isGitMissing) {
      return Promise.reject(gitMissingError());
    }
    return Promise.resolve(
      this.fetchOutcome === 'unreachable'
        ? { outcome: 'unreachable', gitMessage: UNREACHABLE_GIT_MESSAGE }
        : { outcome: this.fetchOutcome },
    );
  }

  /** Returns the current branches. */
  listBranches(): Promise<string[]> {
    return this.isGitMissing
      ? Promise.reject(gitMissingError())
      : Promise.resolve([...this.branches]);
  }

  /** Looks the commit up in {@link commits}. */
  resolveBranchCommit(
    _repoPath: string,
    branch: string,
    location: BranchLocation,
  ): Promise<string | null> {
    return Promise.resolve(this.commits.get(`${location}:${branch}`) ?? null);
  }

  /** Records the worktree and its branch, or reports the configured failure. */
  addWorktree(_repoPath: string, worktree: NewWorktree): Promise<WorktreeChangeResult> {
    if (this.addWorktreeResult.ok) {
      this.addedWorktrees.push(worktree);
      this.branches.push(worktree.branch);
    } else {
      this.onFailingAdd();
    }
    return Promise.resolve(this.addWorktreeResult);
  }

  /** When `false`, `removeWorktree` fails, e.g. because a file in the worktree is locked. */
  isWorktreeRemovable = true;

  /** Records the removal, or fails if {@link isWorktreeRemovable} is `false`. */
  removeWorktree(_repoPath: string, worktreePath: string): Promise<WorktreeChangeResult> {
    if (!this.isWorktreeRemovable) {
      return Promise.resolve({ ok: false, gitMessage: REMOVE_REFUSED_GIT_MESSAGE });
    }
    this.removedWorktrees.push(worktreePath);
    return Promise.resolve({ ok: true });
  }

  /** Deletes the branch unless it is one of {@link movedBranches}. */
  deleteBranchIfUnchanged(
    _repoPath: string,
    branch: string,
    expectedCommit: string,
  ): Promise<boolean> {
    if (this.movedBranches.has(branch) || !this.branches.includes(branch)) {
      return Promise.resolve(false);
    }
    this.deletedBranches.push({ branch, expectedCommit });
    this.branches = this.branches.filter((existing) => existing !== branch);
    return Promise.resolve(true);
  }
}

/**
 * Builds an existing task named `login`.
 * @param projectId Project the task belongs to.
 * @returns The task.
 */
function existingLoginTask(projectId: string): Task {
  return {
    id: '9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a',
    projectId,
    name: 'login',
    branch: 'agent/login',
    baseBranch: 'main',
    worktreePath: LOGIN_WORKTREE_PATH,
    startPrompt: null,
    agentType: 'claude-code',
  };
}

/**
 * Builds a state with the webshop project and a worktree root.
 * @param changes Fields to override, e.g. existing tasks.
 * @returns The state.
 */
function stateWithWebshop(changes: Partial<AppState> = {}): AppState {
  return {
    ...createEmptyAppState(),
    projects: [WEBSHOP],
    settings: { ...DEFAULT_SETTINGS, worktreeRoot: 'D:\\Worktrees' },
    ...changes,
  };
}

describe('createTaskService', () => {
  let gitClient: FakeGitClient;
  let existingPaths: Set<string>;
  let logError: Mock<Logger['error']>;
  let logWarn: Mock<Logger['warn']>;

  beforeEach(() => {
    gitClient = new FakeGitClient();
    existingPaths = new Set<string>();
    logError = vi.fn<Logger['error']>();
    logWarn = vi.fn<Logger['warn']>();
  });

  /**
   * Creates the service on top of a state.
   * @param initialState What `state.json` contains when the test starts.
   * @returns The service and the store, to inspect what was saved.
   */
  function createService(initialState: AppState): {
    taskService: TaskService;
    stateStore: FakeStateStore;
  } {
    const stateStore = new FakeStateStore(initialState);
    const taskService = createTaskService({
      gitClient,
      stateHolder: createAppStateHolder(stateStore),
      generateId: () => TASK_ID,
      pathExists: (path) => Promise.resolve(existingPaths.has(path)),
      logger: { warn: logWarn, error: logError },
    });
    return { taskService, stateStore };
  }

  it('create_WithValidRequest_AddsWorktreeAtFetchedCommitAndPersistsTask', async () => {
    // Arrange
    const { taskService, stateStore } = createService(stateWithWebshop());

    // Act
    const result = await taskService.create(LOGIN_REQUEST);

    // Assert
    const expectedTask = {
      id: TASK_ID,
      projectId: WEBSHOP.id,
      name: 'login',
      branch: 'agent/login',
      baseBranch: 'main',
      worktreePath: LOGIN_WORKTREE_PATH,
      startPrompt: 'Baue den Login um.',
      agentType: 'claude-code',
    };
    expect(result).toEqual({ ok: true, task: expectedTask });
    // The commit, not `origin/main`: it is also the guard for undoing the branch.
    expect(gitClient.addedWorktrees).toEqual([
      { path: LOGIN_WORKTREE_PATH, branch: 'agent/login', startPoint: ORIGIN_MAIN_COMMIT },
    ]);
    expect(stateStore.savedState?.tasks).toEqual([expectedTask]);
  });

  it('create_WithoutWorktreeRoot_ReturnsWorktreeRootMissingAndTouchesNothing', async () => {
    // Arrange
    const { taskService, stateStore } = createService(
      stateWithWebshop({ settings: { ...DEFAULT_SETTINGS, worktreeRoot: null } }),
    );

    // Act
    const result = await taskService.create(LOGIN_REQUEST);

    // Assert
    expect(result).toEqual({ ok: false, reason: 'worktree-root-missing' });
    expect(gitClient.addedWorktrees).toEqual([]);
    expect(stateStore.savedState).toBeNull();
  });

  it('create_ForUnknownProject_ReturnsProjectNotFound', async () => {
    // Arrange
    // E.g. the project was removed in another window while the dialog was open.
    const { taskService } = createService(stateWithWebshop({ projects: [] }));

    // Act
    const result = await taskService.create(LOGIN_REQUEST);

    // Assert
    expect(result).toEqual({ ok: false, reason: 'project-not-found' });
  });

  it('create_WithNameWithoutUsableCharacters_ReturnsInvalidTaskNameAndTouchesNothing', async () => {
    // Arrange
    const { taskService, stateStore } = createService(stateWithWebshop());

    // Act
    const result = await taskService.create({ ...LOGIN_REQUEST, name: '!!!' });

    // Assert
    expect(result).toEqual({ ok: false, reason: 'invalid-task-name' });
    expect(gitClient.addedWorktrees).toEqual([]);
    expect(stateStore.savedState).toBeNull();
  });

  it.each([
    ['same case', 'agent'],
    ['other case, e.g. a packed ref', 'Agent'],
  ])(
    'create_WhenBranchNamedLikePrefixExists_ReturnsPrefixBranchExistsAndTouchesNothing (%s)',
    async (_case, prefixBranch) => {
      // Arrange
      // git cannot create `agent/login` while a branch `agent` exists (issue #4, comment).
      gitClient.branches.push(prefixBranch);
      const { taskService, stateStore } = createService(stateWithWebshop());

      // Act
      const result = await taskService.create(LOGIN_REQUEST);

      // Assert
      expect(result).toEqual({ ok: false, reason: 'prefix-branch-exists' });
      expect(gitClient.addedWorktrees).toEqual([]);
      expect(stateStore.savedState).toBeNull();
    },
  );

  it.each([
    ['active task', () => ({ tasks: [existingLoginTask(WEBSHOP.id)] }), () => undefined],
    [
      'removed task',
      () => ({ consumedTaskNames: [{ projectId: WEBSHOP.id, name: 'login' }] }),
      () => undefined,
    ],
    ['branch', () => ({}), () => gitClient.branches.push('agent/login')],
    ['branch in other case', () => ({}), () => gitClient.branches.push('agent/Login')],
    ['branch below it', () => ({}), () => gitClient.branches.push('agent/login/draft')],
    ['folder', () => ({}), () => existingPaths.add(LOGIN_WORKTREE_PATH)],
  ])(
    'create_WhenNameIsTakenBy_AppendsNumber (%s)',
    async (_takenBy, stateChanges, prepareEnvironment) => {
      // Arrange
      prepareEnvironment();
      const { taskService } = createService(stateWithWebshop(stateChanges()));

      // Act
      const result = await taskService.create(LOGIN_REQUEST);

      // Assert
      expect(result).toMatchObject({
        ok: true,
        task: {
          name: 'login-2',
          branch: 'agent/login-2',
          worktreePath: 'D:\\Worktrees\\Webshop\\login-2',
        },
      });
    },
  );

  it('create_WhenSameNameIsUsedInOtherProject_KeepsName', async () => {
    // Arrange
    // Worktree paths and branches are per project, so names only clash within one project.
    const { taskService } = createService(
      stateWithWebshop({
        tasks: [existingLoginTask(OTHER_PROJECT_ID)],
        consumedTaskNames: [{ projectId: OTHER_PROJECT_ID, name: 'login' }],
      }),
    );

    // Act
    const result = await taskService.create(LOGIN_REQUEST);

    // Assert
    expect(result).toMatchObject({ ok: true, task: { name: 'login' } });
  });

  it.each([
    ['repository without origin', 'no-origin'],
    ['branch never pushed', 'not-on-remote'],
  ] as const)(
    'create_WhenOriginCannotProvideBaseButLocalBranchExists_StartsAtLocalBranch (%s)',
    async (_case, fetchOutcome) => {
      // Arrange
      gitClient.fetchOutcome = fetchOutcome;
      gitClient.commits.set('local:main', LOCAL_MAIN_COMMIT);
      const { taskService } = createService(stateWithWebshop());

      // Act
      const result = await taskService.create(LOGIN_REQUEST);

      // Assert
      expect(result.ok).toBe(true);
      expect(gitClient.addedWorktrees.map((worktree) => worktree.startPoint)).toEqual([
        LOCAL_MAIN_COMMIT,
      ]);
    },
  );

  it.each([
    ['origin unreachable', 'unreachable', 'fetch-failed'],
    ['not on origin and not local', 'not-on-remote', 'base-branch-unknown'],
    ['no origin and not local', 'no-origin', 'base-branch-unknown'],
  ] as const)(
    'create_WhenBaseBranchCannotBeResolved_ReturnsReasonAndTouchesNothing (%s)',
    async (_case, fetchOutcome, expectedReason) => {
      // Arrange
      gitClient.fetchOutcome = fetchOutcome;
      const { taskService, stateStore } = createService(stateWithWebshop());

      // Act
      const result = await taskService.create(LOGIN_REQUEST);

      // Assert
      expect(result).toEqual({ ok: false, reason: expectedReason });
      expect(gitClient.addedWorktrees).toEqual([]);
      expect(stateStore.savedState).toBeNull();
    },
  );

  it('create_WhenOriginIsUnreachable_LogsGitMessage', async () => {
    // Arrange
    // The dialog only says "check the network"; the log keeps git's exact reason.
    gitClient.fetchOutcome = 'unreachable';
    const { taskService } = createService(stateWithWebshop());

    // Act
    await taskService.create(LOGIN_REQUEST);

    // Assert
    expect(logWarn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        repoPath: WEBSHOP.repoPath,
        baseBranch: 'main',
        gitMessage: UNREACHABLE_GIT_MESSAGE,
      }),
    );
  });

  it('create_WhenWorktreeAddFailsButLeavesBranch_UndoesBranchAndLogsGitMessage', async () => {
    // Arrange
    // Real git creates the branch before it checks the folder, e.g. for a deleted worktree
    // that is still registered (integration test of the git client).
    gitClient.addWorktreeResult = { ok: false, gitMessage: 'fatal: missing but registered' };
    gitClient.onFailingAdd = () => gitClient.branches.push('agent/login');
    const { taskService, stateStore } = createService(stateWithWebshop());

    // Act
    const result = await taskService.create(LOGIN_REQUEST);

    // Assert
    expect(result).toEqual({ ok: false, reason: 'worktree-failed' });
    expect(gitClient.deletedBranches).toEqual([
      { branch: 'agent/login', expectedCommit: ORIGIN_MAIN_COMMIT },
    ]);
    expect(logError).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ gitMessage: 'fatal: missing but registered' }),
    );
    expect(stateStore.savedState).toBeNull();
  });

  it.each([
    [
      'branch-exists',
      () => {
        // Created by someone else and already moved on, so it is not undone.
        gitClient.branches.push('agent/login');
        gitClient.movedBranches.add('agent/login');
      },
    ],
    ['path-exists', () => existingPaths.add(LOGIN_WORKTREE_PATH)],
  ])(
    'create_WhenBranchOrPathAppearsMeanwhile_ReturnsCauseAndSavesNothing (%s)',
    async (expectedReason, appearMeanwhile) => {
      // Arrange
      gitClient.addWorktreeResult = { ok: false, gitMessage: 'fatal: already exists' };
      gitClient.onFailingAdd = appearMeanwhile;
      const { taskService, stateStore } = createService(stateWithWebshop());

      // Act
      const result = await taskService.create(LOGIN_REQUEST);

      // Assert
      expect(result).toEqual({ ok: false, reason: expectedReason });
      expect(stateStore.savedState).toBeNull();
    },
  );

  it('create_WhenSavingFails_RemovesWorktreeAndBranchAndRejects', async () => {
    // Arrange
    const { taskService, stateStore } = createService(stateWithWebshop());
    stateStore.nextSaveError = new Error('EPERM: operation not permitted');

    // Act
    const creating = taskService.create(LOGIN_REQUEST);

    // Assert
    await expect(creating).rejects.toThrow('EPERM');
    expect(gitClient.removedWorktrees).toEqual([LOGIN_WORKTREE_PATH]);
    expect(gitClient.deletedBranches).toEqual([
      { branch: 'agent/login', expectedCommit: ORIGIN_MAIN_COMMIT },
    ]);
  });

  it('create_WhenSavingFailsAndWorktreeCannotBeRemoved_KeepsBranchAndLogs', async () => {
    // Arrange
    // E.g. a post-checkout hook left an untracked file or a virus scanner locks one. Deleting
    // the branch anyway would leave a worktree on a branch that no longer exists.
    gitClient.isWorktreeRemovable = false;
    const { taskService, stateStore } = createService(stateWithWebshop());
    stateStore.nextSaveError = new Error('EPERM: operation not permitted');

    // Act
    const creating = taskService.create(LOGIN_REQUEST);

    // Assert
    await expect(creating).rejects.toThrow('EPERM');
    expect(gitClient.deletedBranches).toEqual([]);
    expect(gitClient.branches).toContain('agent/login');
    expect(logError).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        repoPath: WEBSHOP.repoPath,
        worktreePath: LOGIN_WORKTREE_PATH,
        branch: 'agent/login',
        failedStep: 'remove-worktree',
        gitMessage: REMOVE_REFUSED_GIT_MESSAGE,
      }),
    );
  });

  it('create_WhenGitIsMissing_ReturnsGitUnavailableAndSavesNothing', async () => {
    // Arrange
    gitClient.isGitMissing = true;
    const { taskService, stateStore } = createService(stateWithWebshop());

    // Act
    const result = await taskService.create(LOGIN_REQUEST);

    // Assert
    expect(result).toEqual({ ok: false, reason: 'git-unavailable' });
    expect(stateStore.savedState).toBeNull();
  });

  it('list_AfterCreate_ReturnsExistingAndNewTaskInCreationOrder', async () => {
    // Arrange
    const existingTask = existingLoginTask(WEBSHOP.id);
    const { taskService } = createService(stateWithWebshop({ tasks: [existingTask] }));
    await taskService.create({ ...LOGIN_REQUEST, name: 'Checkout' });

    // Act
    const tasks = await taskService.list();

    // Assert
    expect(tasks.map((task) => task.name)).toEqual(['login', 'checkout']);
  });
});
