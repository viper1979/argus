import { hasBranchNamed, isBranchBlocked } from '@shared/domain/git-ref-name';
import type { Project } from '@shared/domain/project';
import type { CreateTaskRequest, CreateTaskResult, Task } from '@shared/domain/task';
import {
  buildTaskLocation,
  findFreeTaskName,
  sanitizeTaskName,
  type TaskLocation,
} from '@shared/domain/task-name';
import type { GitClient } from '../git/git-client';
import { GitUnavailableError } from '../git/git-unavailable-error';
import type { Logger } from '../logging/logger';
import type { AppState } from '../persistence/app-state';
import type { AppStateHolder } from '../persistence/app-state-holder';

/** Creates tasks: a worktree on a new branch, then the task in `state.json`. */
export interface TaskService {
  /**
   * Creates a task (concept 5.2, steps 1 to 3). The task is saved only after git succeeded, and
   * whatever git created is undone if a later step fails, so no half-created task remains.
   * @param request Input of the dialog.
   * @returns The new task, or why it could not be created.
   */
  create(request: CreateTaskRequest): Promise<CreateTaskResult>;

  /**
   * Returns the tasks of all projects.
   * @returns Tasks in the order they were created.
   */
  list(): Promise<Task[]>;
}

/** The git operations the task service needs. */
export type TaskGitClient = Pick<
  GitClient,
  | 'fetchBranch'
  | 'listBranches'
  | 'resolveBranchCommit'
  | 'addWorktree'
  | 'removeWorktree'
  | 'deleteBranchIfUnchanged'
>;

/** Collaborators of the task service; `generateId` makes ids deterministic in tests. */
export interface TaskServiceOptions {
  readonly gitClient: TaskGitClient;
  readonly stateHolder: AppStateHolder;
  readonly generateId: () => string;
  /** Tells whether a file or folder exists at a path. */
  readonly pathExists: (path: string) => Promise<boolean>;
  readonly logger: Logger;
}

/** Failure reasons of {@link TaskService.create}. */
type CreateTaskFailureReason = Extract<CreateTaskResult, { ok: false }>['reason'];

/** A failed step; the reason travels up unchanged to the dialog. */
interface StepFailure {
  readonly ok: false;
  readonly reason: CreateTaskFailureReason;
}

/** Project and worktree root a new task is created with. */
interface TaskTarget {
  readonly project: Project;
  readonly worktreeRoot: string;
}

/**
 * Creates the task service.
 * @param options Git access, state, id generator, file system check and logger.
 * @returns The service.
 */
export function createTaskService(options: TaskServiceOptions): TaskService {
  return {
    create: async (request) => {
      try {
        return await createTask(options, request);
      } catch (error: unknown) {
        // A missing git is a setup problem the user can fix, so it is a result, not a crash.
        if (error instanceof GitUnavailableError) {
          return { ok: false, reason: 'git-unavailable' };
        }
        throw error;
      }
    },

    list: async () => (await options.stateHolder.read()).tasks,
  };
}

/**
 * Runs the steps of {@link TaskService.create}: check input, pick base commit and free name,
 * add the worktree, save the task.
 * @param options Collaborators.
 * @param request Input of the dialog.
 * @returns The new task, or why it could not be created.
 */
async function createTask(
  options: TaskServiceOptions,
  request: CreateTaskRequest,
): Promise<CreateTaskResult> {
  const { gitClient, generateId } = options;
  const state = await options.stateHolder.read();
  const target = findTaskTarget(state, request.projectId);
  if (!target.ok) {
    return target;
  }
  const { project, worktreeRoot } = target;

  const baseName = sanitizeTaskName(request.name);
  if (baseName === '') {
    return { ok: false, reason: 'invalid-task-name' };
  }
  const branchesBefore = await gitClient.listBranches(project.repoPath);
  // A ref cannot be a branch and a folder at once: `agent` blocks every `agent/<task>`.
  if (hasBranchNamed(project.branchPrefix, branchesBefore)) {
    return { ok: false, reason: 'prefix-branch-exists' };
  }
  const startCommit = await resolveStartCommit(options, project.repoPath, request.baseBranch);
  if (!startCommit.ok) {
    return startCommit;
  }

  const usedNames = collectUsedTaskNames(state, project.id);
  const name = await findFreeTaskName(baseName, async (candidate) => {
    if (usedNames.has(candidate)) {
      return true;
    }
    const location = buildTaskLocation(worktreeRoot, project, candidate);
    return (
      isBranchBlocked(location.branch, branchesBefore) ||
      (await options.pathExists(location.worktreePath))
    );
  });
  const location = buildTaskLocation(worktreeRoot, project, name);
  const added = await gitClient.addWorktree(project.repoPath, {
    path: location.worktreePath,
    branch: location.branch,
    startPoint: startCommit.commit,
  });
  if (!added.ok) {
    const reason = await explainFailedWorktree(
      options,
      project.repoPath,
      location,
      startCommit.commit,
    );
    if (reason === 'worktree-failed') {
      options.logger.error('git worktree add failed', {
        repoPath: project.repoPath,
        worktreePath: location.worktreePath,
        gitMessage: added.gitMessage,
      });
    }
    return { ok: false, reason };
  }

  const task: Task = {
    id: generateId(),
    projectId: project.id,
    name,
    ...location,
    baseBranch: request.baseBranch,
    startPrompt: request.startPrompt,
    agentType: request.agentType,
  };
  await saveTask(options, task, project.repoPath, startCommit.commit);
  return { ok: true, task };
}

/**
 * Finds the project of a new task and the worktree root it goes below.
 * @param state The current state.
 * @param projectId Project chosen in the dialog.
 * @returns Project and worktree root, or why there are none.
 */
function findTaskTarget(
  state: AppState,
  projectId: string,
): ({ readonly ok: true } & TaskTarget) | StepFailure {
  const project = state.projects.find((candidate) => candidate.id === projectId);
  if (project === undefined) {
    return { ok: false, reason: 'project-not-found' };
  }
  const worktreeRoot = state.settings.worktreeRoot;
  if (worktreeRoot === null) {
    return { ok: false, reason: 'worktree-root-missing' };
  }
  return { ok: true, project, worktreeRoot };
}

/**
 * Collects the task names a project must not use again: those of its tasks and of its removed
 * tasks, because Claude stores conversations per path (concept 5.2, step 1).
 * @param state The current state.
 * @param projectId The project of the new task.
 * @returns The names in use within the project.
 */
function collectUsedTaskNames(state: AppState, projectId: string): Set<string> {
  const activeNames = state.tasks
    .filter((task) => task.projectId === projectId)
    .map((task) => task.name);
  const consumedNames = state.consumedTaskNames
    .filter((consumed) => consumed.projectId === projectId)
    .map((consumed) => consumed.name);
  return new Set([...activeNames, ...consumedNames]);
}

/** Commit a new task branch starts at, or why the base branch cannot be used. */
type StartCommitResult = { readonly ok: true; readonly commit: string } | StepFailure;

/**
 * Fetches the base branch and decides at which commit the task branch starts (concept 5.2,
 * step 2): the fresh `origin/<base>`, or the local branch if the repository has no origin or
 * origin does not know the branch (e.g. a local branch that was never pushed).
 * @param options Collaborators; the logger keeps git's reason for a failed fetch.
 * @param repoPath Root of the repository.
 * @param baseBranch Base branch from the dialog, e.g. `main`.
 * @returns The commit, or why there is none.
 */
async function resolveStartCommit(
  options: TaskServiceOptions,
  repoPath: string,
  baseBranch: string,
): Promise<StartCommitResult> {
  const { gitClient } = options;
  const fetchResult = await gitClient.fetchBranch(repoPath, baseBranch);
  // Without a connection the local branch may be outdated; the user should retry instead.
  if (fetchResult.outcome === 'unreachable') {
    options.logger.warn('Could not fetch the base branch from origin', {
      repoPath,
      baseBranch,
      gitMessage: fetchResult.gitMessage,
    });
    return { ok: false, reason: 'fetch-failed' };
  }
  const location = fetchResult.outcome === 'fetched' ? 'origin' : 'local';
  const commit = await gitClient.resolveBranchCommit(repoPath, baseBranch, location);
  return commit === null ? { ok: false, reason: 'base-branch-unknown' } : { ok: true, commit };
}

/**
 * Cleans up after `git worktree add` failed and finds out why. Git may have created the branch
 * before it failed (integration test of the git client); that branch is undone as long as it
 * still points to the start commit, so a branch someone else created meanwhile is kept.
 * @param options Collaborators.
 * @param repoPath Root of the repository.
 * @param location Branch and folder that were to be created.
 * @param startCommit Commit the branch was to start at.
 * @returns `branch-exists` or `path-exists` if the name was taken meanwhile, else `worktree-failed`.
 */
async function explainFailedWorktree(
  options: TaskServiceOptions,
  repoPath: string,
  location: TaskLocation,
  startCommit: string,
): Promise<CreateTaskFailureReason> {
  const { gitClient } = options;
  // The result is not needed: `false` usually just means git did not create the branch at all.
  // Whether a blocking branch remains is read fresh right below.
  await gitClient.deleteBranchIfUnchanged(repoPath, location.branch, startCommit);
  const branchesAfter = await gitClient.listBranches(repoPath);
  if (isBranchBlocked(location.branch, branchesAfter)) {
    return 'branch-exists';
  }
  if (await options.pathExists(location.worktreePath)) {
    return 'path-exists';
  }
  return 'worktree-failed';
}

/**
 * Saves the new task. If that fails (e.g. a locked `state.json`), worktree and branch are
 * removed again, so the next attempt does not find a worktree without task.
 * @param options Collaborators.
 * @param task The task to save; its worktree exists already.
 * @param repoPath Root of the repository.
 * @param startCommit Commit the branch was created at; guards the branch deletion.
 */
async function saveTask(
  options: TaskServiceOptions,
  task: Task,
  repoPath: string,
  startCommit: string,
): Promise<void> {
  try {
    await options.stateHolder.update((current) => ({
      ...current,
      tasks: [...current.tasks, task],
    }));
  } catch (saveError: unknown) {
    // Rethrown below: the caller sees the save error; this only undoes the git part.
    await undoCreatedWorktree(options, task, repoPath, startCommit);
    throw saveError;
  }
}

/**
 * Removes worktree and branch of a task that could not be saved. Anything left behind is logged
 * with the failed step, so it can be cleaned up by hand.
 * @param options Collaborators.
 * @param task The unsaved task.
 * @param repoPath Root of the repository.
 * @param startCommit Commit the branch was created at; guards the branch deletion.
 */
async function undoCreatedWorktree(
  options: TaskServiceOptions,
  task: Task,
  repoPath: string,
  startCommit: string,
): Promise<void> {
  const leftovers = { repoPath, worktreePath: task.worktreePath, branch: task.branch };
  const removal = await options.gitClient.removeWorktree(repoPath, task.worktreePath);
  // Only without its worktree: deleting a checked-out branch would leave a broken worktree.
  if (!removal.ok) {
    options.logger.error('Could not undo the worktree of a task that was not saved', {
      ...leftovers,
      failedStep: 'remove-worktree',
      gitMessage: removal.gitMessage,
    });
    return;
  }
  const isBranchDeleted = await options.gitClient.deleteBranchIfUnchanged(
    repoPath,
    task.branch,
    startCommit,
  );
  if (!isBranchDeleted) {
    // update-ref only refuses if the branch moved meanwhile, so it is kept on purpose.
    options.logger.error('Could not undo the branch of a task that was not saved', {
      ...leftovers,
      failedStep: 'delete-branch',
    });
  }
}
