import { z } from 'zod';
import { INVALID_BRANCH_NAME_MESSAGE, isValidBranchName } from './git-ref-name';
import { agentTypeSchema } from './project';
import { INVALID_FOLDER_NAME_MESSAGE, isValidWindowsFolderName } from './windows-folder-name';

/** A bounded piece of work in a project with exactly one worktree and one branch. */
export const taskSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  /** Cleaned and unique within its project; last segment of branch and worktree path. */
  name: z.string().refine(isValidWindowsFolderName, INVALID_FOLDER_NAME_MESSAGE),
  /** `<prefix>/<task-name>`, created without upstream. */
  branch: z.string().refine(isValidBranchName, INVALID_BRANCH_NAME_MESSAGE),
  /** Branch the task was created from, e.g. `main`; later the target of the merge. */
  baseBranch: z.string().refine(isValidBranchName, INVALID_BRANCH_NAME_MESSAGE),
  /** `<WorktreeRoot>\<project>\<task-name>`. */
  worktreePath: z.string().min(1),
  /** Prompt for the first agent session; `null` if the user gave none. */
  startPrompt: z.string().nullable(),
  /** Agent type of the first agent session. */
  agentType: agentTypeSchema,
});

/** A bounded piece of work in a project (glossary: Task). */
export type Task = z.infer<typeof taskSchema>;

/**
 * A task name that must not be used again in its project, because a task with this name was
 * removed: Claude stores conversations per path (concept 5.2, step 1).
 */
export const consumedTaskNameSchema = z.object({
  projectId: z.uuid(),
  name: z.string().min(1),
});

/** Input of the "Task anlegen" dialog; the name is cleaned by the main process. */
export const createTaskRequestSchema = z.object({
  projectId: z.uuid(),
  /** Name as typed by the user. */
  name: z.string(),
  baseBranch: z.string().trim().refine(isValidBranchName, INVALID_BRANCH_NAME_MESSAGE),
  startPrompt: z.string().nullable(),
  agentType: agentTypeSchema,
});

/** Input of the "Task anlegen" dialog. */
export type CreateTaskRequest = z.infer<typeof createTaskRequestSchema>;

/** Why a task could not be created; the renderer maps it to a German message. */
export const createTaskFailureReasonSchema = z.enum([
  'project-not-found',
  'worktree-root-missing',
  'invalid-task-name',
  'prefix-branch-exists',
  'fetch-failed',
  'base-branch-unknown',
  'branch-exists',
  'path-exists',
  'worktree-failed',
  'git-unavailable',
]);

/** Outcome of creating a task; business failures are results, not exceptions. */
export const createTaskResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), task: taskSchema }),
  z.object({ ok: z.literal(false), reason: createTaskFailureReasonSchema }),
]);

/** Outcome of creating a task. */
export type CreateTaskResult = z.infer<typeof createTaskResultSchema>;
