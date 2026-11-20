import type { IpcContract } from '@shared/ipc/contract';
import type { IpcHandlers } from '@shared/ipc/contract-types';
import { app } from 'electron';
import type { AgentSessionService } from '../agents/agent-session-service';
import type { ProjectService } from '../projects/project-service';
import type { SettingsService } from '../settings/settings-service';
import type { TaskService } from '../tasks/task-service';
import type { TerminalService } from '../terminals/terminal-service';
import { AgentSessionTerminalCloseError } from './agent-session-terminal-close-error';

/** Services the IPC handlers delegate to; created once at app start. */
export interface IpcHandlerDependencies {
  readonly projectService: ProjectService;
  readonly taskService: TaskService;
  readonly terminalService: TerminalService;
  readonly agentSessionService: AgentSessionService;
  readonly settingsService: SettingsService;
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
  const {
    projectService,
    taskService,
    terminalService,
    agentSessionService,
    settingsService,
    pickFolder,
  } = dependencies;

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
    task: {
      list: async () => ({ tasks: await taskService.list() }),
      create: (request) => taskService.create(request),
    },
    terminal: {
      open: (request) => terminalService.open(request),
      write: ({ terminalId, data }) => {
        terminalService.write(terminalId, data);
        return {};
      },
      resize: ({ terminalId, ...size }) => {
        terminalService.resize(terminalId, size);
        return {};
      },
      close: async ({ terminalId }) => {
        // The renderer offers no close button for it; checked here, because the renderer is not
        // trusted. The rejection is logged by registerIpcHandlers.
        if (agentSessionService.isAgentSessionTerminal(terminalId)) {
          throw new AgentSessionTerminalCloseError(terminalId);
        }
        await terminalService.close(terminalId);
        return {};
      },
    },
    agentSession: {
      start: (request) => agentSessionService.start(request),
    },
    settings: {
      get: () => settingsService.get(),
      update: (patch) => settingsService.update(patch),
    },
  };
}
