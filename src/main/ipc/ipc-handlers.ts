import type { IpcContract } from '@shared/ipc/contract';
import type { IpcHandlers } from '@shared/ipc/contract-types';
import { app } from 'electron';
import type { AppStateHolder } from '../persistence/app-state-holder';
import type { ProjectService } from '../projects/project-service';

/** Services the IPC handlers delegate to; created once at app start. */
export interface IpcHandlerDependencies {
  readonly projectService: ProjectService;
  readonly stateHolder: AppStateHolder;
  /**
   * Shows the native folder picker.
   * @param title Title of the dialog.
   * @returns The picked folder, or `null` if the user cancelled.
   */
  readonly pickFolder: (title: string) => Promise<string | null>;
}

/**
 * Creates the main-process implementations for every endpoint of the IPC contract.
 * @param dependencies Services the handlers delegate to.
 * @returns Handlers grouped by domain, matching {@link IpcContract}.
 */
export function createIpcHandlers(dependencies: IpcHandlerDependencies): IpcHandlers<IpcContract> {
  const { projectService, stateHolder, pickFolder } = dependencies;

  return {
    app: {
      getInfo: () => ({ name: app.getName(), version: app.getVersion() }),
    },
    dialog: {
      pickFolder: async ({ title }) => ({ folderPath: await pickFolder(title) }),
    },
    project: {
      list: async () => ({ projects: await projectService.list() }),
      add: ({ folderPath }) => projectService.add(folderPath),
      update: ({ projectId, settings }) => projectService.update(projectId, settings),
      remove: async ({ projectId }) => {
        await projectService.remove(projectId);
        return {};
      },
    },
    settings: {
      get: async () => (await stateHolder.read()).settings,
      update: async (settings) =>
        (await stateHolder.update((state) => ({ ...state, settings }))).settings,
    },
  };
}
