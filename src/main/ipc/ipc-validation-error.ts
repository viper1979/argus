import type { IpcChannel } from '@shared/ipc/contract-types';

/** Direction of an IPC message relative to the main process. */
export type IpcMessageDirection = 'request' | 'response';

/** Raised when an IPC message does not match its zod schema in the contract. */
export class IpcValidationError extends Error {
  /**
   * @param channel Channel of the rejected message, e.g. `app:getInfo`.
   * @param direction Whether the incoming request or the outgoing response was invalid.
   */
  constructor(
    readonly channel: IpcChannel,
    readonly direction: IpcMessageDirection,
  ) {
    super(`Invalid IPC ${direction} on channel ${channel}`);
    this.name = 'IpcValidationError';
  }
}
