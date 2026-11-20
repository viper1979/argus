import { useCallback, useEffect, useState } from 'react';
import type { CreateTaskRequest, CreateTaskResult, Task } from '@shared/domain/task';

/** Tasks of all projects plus the actions the sidebar offers on them. */
export interface TasksState {
  /** Tasks of all projects, or `null` while the first load is running. */
  readonly tasks: Task[] | null;
  /**
   * Creates a task with its own worktree and branch.
   * @param request Input of the dialog.
   * @returns The new task, or why it could not be created.
   */
  readonly createTask: (request: CreateTaskRequest) => Promise<CreateTaskResult>;
}

/**
 * Loads the tasks from the main process and keeps them in sync after every change.
 * @returns Tasks and actions.
 */
export function useTasks(): TasksState {
  const [tasks, setTasks] = useState<Task[] | null>(null);

  /** Fetches the current tasks after a change, so the sidebar shows what main stored. */
  const reload = useCallback(async () => {
    const response = await window.argus.task.list({});
    setTasks(response.tasks);
  }, []);

  // The first load does not reuse `reload`: setting state inside the effect body is not allowed,
  // and the cancel flag protects against an unmounted component.
  useEffect(() => {
    let isCancelled = false;

    window.argus.task
      .list({})
      .then((response) => {
        if (!isCancelled) {
          setTasks(response.tasks);
        }
      })
      .catch((error: unknown) => {
        // Failures are logged in the main process; the sidebar then simply shows no tasks.
        console.error('Could not load tasks', error);
        if (!isCancelled) {
          setTasks([]);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, []);

  const createTask = useCallback(
    async (request: CreateTaskRequest) => {
      const result = await window.argus.task.create(request);
      if (result.ok) {
        await reload();
      }
      return result;
    },
    [reload],
  );

  return { tasks, createTask };
}
