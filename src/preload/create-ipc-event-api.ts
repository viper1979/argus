import type {
  IpcChannel,
  IpcEventApi,
  IpcEventContractShape,
  IpcUnsubscribe,
} from '@shared/ipc/contract-types';
import { mapContract } from '@shared/ipc/map-contract';

/**
 * Listens on a channel for messages from the main process; in production a wrapper around
 * `ipcRenderer.on/removeListener` that hides the Electron event object from the renderer.
 * @param channel Channel in the form `domain:event`.
 * @param listener Receives each payload.
 * @returns Stops listening.
 */
export type IpcSubscribe = (
  channel: IpcChannel,
  listener: (payload: unknown) => void,
) => IpcUnsubscribe;

/**
 * Derives the subscriptions (`api.<domain>.on<Event>(listener)`) from an event contract.
 * Payloads are not validated: they come from the main process, which the renderer trusts.
 * @param events The event contract.
 * @param subscribe Transport used to listen to the main process.
 * @returns One subscribe method per event, grouped by domain.
 */
export function createIpcEventApi<TEvents extends IpcEventContractShape>(
  events: TEvents,
  subscribe: IpcSubscribe,
): IpcEventApi<TEvents> {
  const api = mapContract(events, (event, channel) => [
    toSubscribeMethodName(event),
    (listener: (payload: unknown) => void) => subscribe(channel, listener),
  ]);
  return api as IpcEventApi<TEvents>;
}

/**
 * Builds the subscribe method name of an event, matching `IpcSubscribeMethodName`.
 * @param event Event name, e.g. `output`.
 * @returns E.g. `onOutput`.
 */
function toSubscribeMethodName(event: string): string {
  return `on${event.charAt(0).toUpperCase()}${event.slice(1)}`;
}

/**
 * Combines invoke methods and subscriptions into one API per domain, so the renderer calls
 * `window.argus.terminal.open()` and `window.argus.terminal.onOutput()` side by side.
 * @param clientApi Invoke methods derived from the IPC contract.
 * @param eventApi Subscriptions derived from the event contract.
 * @returns A new object; the inputs are not modified.
 */
export function mergeIpcApis<
  TClientApi extends Readonly<Record<string, object>>,
  TEventApi extends Readonly<Record<string, object>>,
>(clientApi: TClientApi, eventApi: TEventApi): TClientApi & TEventApi {
  const merged: Record<string, object> = { ...clientApi };
  for (const [domain, domainEventApi] of Object.entries(eventApi)) {
    merged[domain] = { ...merged[domain], ...domainEventApi };
  }
  return merged as TClientApi & TEventApi;
}
