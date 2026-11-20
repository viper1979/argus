import type { IpcChannel } from '@shared/ipc/contract-types';

/** Raised when an IPC message does not come from the app's own renderer. */
export class UntrustedIpcSenderError extends Error {
  /**
   * @param channel Channel of the rejected message, e.g. `app:getInfo`.
   * @param senderOrigin Origin of the sending frame (for files: the URL without query and hash),
   *   or `null` if the frame no longer exists or its URL cannot be parsed.
   */
  constructor(
    readonly channel: IpcChannel,
    readonly senderOrigin: string | null,
  ) {
    super(`Untrusted IPC sender on channel ${channel}`);
    this.name = 'UntrustedIpcSenderError';
  }
}
