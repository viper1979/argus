import { projectSchema } from '@shared/domain/project';
import { settingsSchema } from '@shared/domain/settings';
import { consumedTaskNameSchema, taskSchema } from '@shared/domain/task';
import { z } from 'zod';

/**
 * Version of the `state.json` format; raised together with a migration on breaking changes only.
 * A new field gets a default instead, so files of older Argus versions stay readable; otherwise
 * `load()` would move every existing file aside as corrupt.
 */
export const APP_STATE_VERSION = 1;

/** Everything Argus persists in `state.json`. */
export const appStateSchema = z.object({
  version: z.literal(APP_STATE_VERSION),
  projects: z.array(projectSchema),
  settings: settingsSchema,
  /** Added with #4; missing in files written before. */
  tasks: z.array(taskSchema).default([]),
  /** Added with #4; missing in files written before. */
  consumedTaskNames: z.array(consumedTaskNameSchema).default([]),
});

/** Everything Argus persists in `state.json`. */
export type AppState = z.infer<typeof appStateSchema>;

/**
 * Creates the state of a fresh installation.
 * @returns State without projects, tasks and worktree root.
 */
export function createEmptyAppState(): AppState {
  return {
    version: APP_STATE_VERSION,
    projects: [],
    settings: { worktreeRoot: null },
    tasks: [],
    consumedTaskNames: [],
  };
}
