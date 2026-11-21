import { z } from 'zod';
import {
  startAgentSessionRequestSchema,
  startAgentSessionResultSchema,
  taskAgentSessionStatusSchema,
} from '../domain/agent-session';
import {
  addProjectResultSchema,
  projectSchema,
  projectSettingsSchema,
  updateProjectResultSchema,
} from '../domain/project';
import { settingsPatchSchema, settingsSchema } from '../domain/settings';
import { createTaskRequestSchema, createTaskResultSchema, taskSchema } from '../domain/task';
import {
  openTerminalRequestSchema,
  openTerminalResultSchema,
  resizeTerminalRequestSchema,
  terminalExitEventSchema,
  terminalOutputEventSchema,
  terminalReferenceSchema,
  writeTerminalRequestSchema,
} from '../domain/terminal';
import type {
  IpcClientApi,
  IpcContractShape,
  IpcEventApi,
  IpcEventContractShape,
} from './contract-types';

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
  task: {
    list: {
      request: z.object({}).strict(),
      response: z.object({ tasks: z.array(taskSchema) }),
    },
    /** Creates worktree and branch, then saves the task (concept 5.2, steps 1 to 3). */
    create: {
      request: createTaskRequestSchema.strict(),
      response: createTaskResultSchema,
    },
  },
  terminal: {
    /** Starts a PowerShell in the worktree of the task (issue #5). */
    open: {
      request: openTerminalRequestSchema.strict(),
      response: openTerminalResultSchema,
    },
    /** Forwards keystrokes; input for an ended terminal is dropped. */
    write: {
      request: writeTerminalRequestSchema.strict(),
      response: z.object({}),
    },
    /** Applies the size xterm.js measured; ignored for an ended terminal. */
    resize: {
      request: resizeTerminalRequestSchema.strict(),
      response: z.object({}),
    },
    /** Ends the process and resolves once it has ended. */
    close: {
      request: terminalReferenceSchema.strict(),
      response: z.object({}),
    },
  },
  agentSession: {
    /** Starts the agent session of a task in a new terminal (concept 5.3, issue #7). */
    start: {
      request: startAgentSessionRequestSchema.strict(),
      response: startAgentSessionResultSchema,
    },
    /**
     * Current status of every agent session that has one, for a renderer that (re)loads and
     * missed earlier `statusChanged` events.
     */
    listStatuses: {
      request: z.object({}).strict(),
      response: z.object({ statuses: z.array(taskAgentSessionStatusSchema) }),
    },
  },
  settings: {
    get: {
      request: z.object({}).strict(),
      response: settingsSchema,
    },
    update: {
      request: settingsPatchSchema,
      response: settingsSchema,
    },
  },
} as const satisfies IpcContractShape;

/**
 * Events the main process pushes to the renderer; channel names are derived as `domain:event`.
 * Event names must differ from the action names of the same domain, since both end up on
 * `window.argus.<domain>`.
 */
export const ipcEventContract = {
  terminal: {
    output: terminalOutputEventSchema,
    exit: terminalExitEventSchema,
  },
  agentSession: {
    /** Status or subagent count of an agent session changed (concept 3). */
    statusChanged: taskAgentSessionStatusSchema,
  },
} as const satisfies IpcEventContractShape;

/** Property of `window` under which the preload exposes {@link ArgusApi}. */
export const ARGUS_BRIDGE_KEY = 'argus';

/** The contract type, used to derive handler and client signatures. */
export type IpcContract = typeof ipcContract;

/** The event contract type, used to derive emitter and subscription signatures. */
export type IpcEventContract = typeof ipcEventContract;

/** API exposed to the renderer as `window.argus`: invoke methods and event subscriptions. */
export type ArgusApi = IpcClientApi<IpcContract> & IpcEventApi<IpcEventContract>;
