import type { ArgusApi } from '@shared/ipc/contract';
import { ARGUS_BRIDGE_KEY, ipcContract, ipcEventContract } from '@shared/ipc/contract';
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { createIpcClientApi } from './create-ipc-client-api';
import { createIpcEventApi, mergeIpcApis, type IpcSubscribe } from './create-ipc-event-api';

/**
 * Listens on a channel and hides the Electron event object, so the renderer only ever sees
 * the payload and never gets access to `ipcRenderer` itself.
 */
const subscribe: IpcSubscribe = (channel, listener) => {
  const forwardPayload = (_event: IpcRendererEvent, payload: unknown): void => {
    listener(payload);
  };
  ipcRenderer.on(channel, forwardPayload);
  return () => {
    ipcRenderer.removeListener(channel, forwardPayload);
  };
};

const argusApi: ArgusApi = mergeIpcApis(
  createIpcClientApi(ipcContract, (channel, request) => ipcRenderer.invoke(channel, request)),
  createIpcEventApi(ipcEventContract, subscribe),
);

// The only bridge between renderer and main process: `window.argus.<domain>.<action>()` and
// `window.argus.<domain>.on<Event>()`.
contextBridge.exposeInMainWorld(ARGUS_BRIDGE_KEY, argusApi);
