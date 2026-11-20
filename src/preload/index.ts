import { ARGUS_BRIDGE_KEY, ipcContract } from '@shared/ipc/contract';
import { contextBridge, ipcRenderer } from 'electron';
import { createIpcClientApi } from './create-ipc-client-api';

// The only bridge between renderer and main process: `window.argus.<domain>.<action>()`.
contextBridge.exposeInMainWorld(
  ARGUS_BRIDGE_KEY,
  createIpcClientApi(ipcContract, (channel, request) => ipcRenderer.invoke(channel, request)),
);
