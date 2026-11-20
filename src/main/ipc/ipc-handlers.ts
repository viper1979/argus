import type { IpcContract } from '@shared/ipc/contract';
import type { IpcHandlers } from '@shared/ipc/contract-types';
import { app } from 'electron';

/**
 * Creates the main-process implementations for every endpoint of the IPC contract.
 * @returns Handlers grouped by domain, matching {@link IpcContract}.
 */
export function createIpcHandlers(): IpcHandlers<IpcContract> {
  return {
    app: {
      getInfo: () => ({ name: app.getName(), version: app.getVersion() }),
    },
  };
}
