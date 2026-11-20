import { useCallback, useEffect, useState } from 'react';
import type {
  AddProjectResult,
  Project,
  ProjectSettings,
  UpdateProjectResult,
} from '@shared/domain/project';

/** Projects plus the actions the sidebar offers on them. */
export interface ProjectsState {
  /** Registered projects, or `null` while the first load is running. */
  readonly projects: Project[] | null;
  /**
   * Registers the repository of a folder.
   * @param folderPath Folder picked by the user.
   * @returns The new project, or why it could not be added.
   */
  readonly addProject: (folderPath: string) => Promise<AddProjectResult>;
  /**
   * Saves changed project settings.
   * @param projectId Id of the project.
   * @param settings The new settings.
   * @returns The changed project, or why it could not be saved.
   */
  readonly updateProject: (
    projectId: string,
    settings: ProjectSettings,
  ) => Promise<UpdateProjectResult>;
  /**
   * Removes a project from Argus; nothing on disk is deleted.
   * @param projectId Id of the project.
   */
  readonly removeProject: (projectId: string) => Promise<void>;
}

/**
 * Loads the projects from the main process and keeps them in sync after every change.
 * @returns Projects and actions.
 */
export function useProjects(): ProjectsState {
  const [projects, setProjects] = useState<Project[] | null>(null);

  /** Fetches the current projects after a change, so the sidebar shows what main stored. */
  const reload = useCallback(async () => {
    const response = await window.argus.project.list({});
    setProjects(response.projects);
  }, []);

  // The first load does not reuse `reload`: setting state inside the effect body is not allowed,
  // and the cancel flag protects against an unmounted component.
  useEffect(() => {
    let isCancelled = false;

    window.argus.project
      .list({})
      .then((response) => {
        if (!isCancelled) {
          setProjects(response.projects);
        }
      })
      .catch((error: unknown) => {
        // Failures are logged in the main process; the sidebar then simply stays empty.
        console.error('Could not load projects', error);
        if (!isCancelled) {
          setProjects([]);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, []);

  const addProject = useCallback(
    async (folderPath: string) => {
      const result = await window.argus.project.add({ folderPath });
      await reload();
      return result;
    },
    [reload],
  );

  const updateProject = useCallback(
    async (projectId: string, settings: ProjectSettings) => {
      const result = await window.argus.project.update({ projectId, settings });
      await reload();
      return result;
    },
    [reload],
  );

  const removeProject = useCallback(
    async (projectId: string) => {
      await window.argus.project.remove({ projectId });
      await reload();
    },
    [reload],
  );

  return { projects, addProject, updateProject, removeProject };
}
