import { z } from 'zod';
import {
  addProjectResultSchema,
  projectSchema,
  projectSettingsSchema,
  updateProjectResultSchema,
} from '../domain/project';
import { settingsSchema } from '../domain/settings';
import type { IpcClientApi, IpcContractShape } from './contract-types';

/**
 * Central IPC contract between renderer and main process.
 * Every new IPC call is added here; channel names are derived as `domain:action`.
 */
export const ipcContract = {
  app: {
    getInfo: {
      request: z.object({}).strict(),
      response: z.object({
        name: z.string().min(1),
        version: z.string().min(1),
      }),
    },
  },
  dialog: {
    /** Opens the native folder picker; `null` if the user cancelled. */
    pickFolder: {
      request: z.object({ title: z.string().min(1) }).strict(),
      response: z.object({ folderPath: z.string().min(1).nullable() }),
    },
  },
  project: {
    list: {
      request: z.object({}).strict(),
      response: z.object({ projects: z.array(projectSchema) }),
    },
    add: {
      request: z.object({ folderPath: z.string().min(1) }).strict(),
      response: addProjectResultSchema,
    },
    update: {
      request: z.object({ projectId: z.uuid(), settings: projectSettingsSchema }).strict(),
      response: updateProjectResultSchema,
    },
    /** Removes the project from Argus only; nothing on disk is deleted. */
    remove: {
      request: z.object({ projectId: z.uuid() }).strict(),
      response: z.object({}),
    },
  },
  settings: {
    get: {
      request: z.object({}).strict(),
      response: settingsSchema,
    },
    update: {
      request: settingsSchema.strict(),
      response: settingsSchema,
    },
  },
} as const satisfies IpcContractShape;

/** Property of `window` under which the preload exposes {@link ArgusApi}. */
export const ARGUS_BRIDGE_KEY = 'argus';

/** The contract type, used to derive handler and client signatures. */
export type IpcContract = typeof ipcContract;

/** API exposed to the renderer as `window.argus`. */
export type ArgusApi = IpcClientApi<IpcContract>;
