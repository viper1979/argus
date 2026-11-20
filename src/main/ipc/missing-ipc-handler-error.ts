import type { IpcChannel } from '@shared/ipc/contract-types';

/** Raised at startup when a contract endpoint has no main-process implementation. */
export class MissingIpcHandlerError extends Error {
  /**
   * @param channel Channel of the endpoint without implementation, e.g. `app:getInfo`.
   */
  constructor(readonly channel: IpcChannel) {
    super(`No IPC handler implemented for channel ${channel}`);
    this.name = 'MissingIpcHandlerError';
  }
}
