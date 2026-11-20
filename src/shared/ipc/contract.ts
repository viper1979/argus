import { z } from 'zod';
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
} as const satisfies IpcContractShape;

/** Property of `window` under which the preload exposes {@link ArgusApi}. */
export const ARGUS_BRIDGE_KEY = 'argus';

/** The contract type, used to derive handler and client signatures. */
export type IpcContract = typeof ipcContract;

/** API exposed to the renderer as `window.argus`. */
export type ArgusApi = IpcClientApi<IpcContract>;
