import type {
  IpcChannel,
  IpcEventContractShape,
  IpcEventEmitter,
} from '@shared/ipc/contract-types';
import { mapContract } from '@shared/ipc/map-contract';

/** The part of Electron's `WebContents` this module needs; allows a fake in tests. */
export interface IpcEventTargetLike {
  /** Whether the window has been closed; sending to it would throw. */
  isDestroyed(): boolean;

  /**
   * Sends a message to the renderer.
   * @param channel Channel in the form `domain:event`.
   * @param payload The message.
   */
  send(channel: IpcChannel, payload: unknown): void;
}

/**
 * Derives the typed sender (`emitter.<domain>.<event>(payload)`) from an event contract.
 * Events go only to the app's own window, so no other frame can receive them; payloads are not
 * validated at runtime, because the main process produces them itself and terminal output is
 * too frequent for a schema check per chunk.
 * @param events The event contract.
 * @param getTarget Returns the main window's web contents, or `null` if there is no window.
 * @returns One send method per event, grouped by domain.
 */
export function createIpcEventEmitter<TEvents extends IpcEventContractShape>(
  events: TEvents,
  getTarget: () => IpcEventTargetLike | null,
): IpcEventEmitter<TEvents> {
  const emitter = mapContract(events, (event, channel) => [
    event,
    (payload: unknown) => {
      const target = getTarget();
      // Without a live window nobody is listening; dropping the event is correct.
      if (target === null || target.isDestroyed()) {
        return;
      }
      target.send(channel, payload);
    },
  ]);
  return emitter as IpcEventEmitter<TEvents>;
}
