import type { ARGUS_BRIDGE_KEY, ArgusApi } from '@shared/ipc/contract';

declare global {
  interface Window {
    /** Typed bridge to the main process, exposed by the preload script. */
    readonly [ARGUS_BRIDGE_KEY]: ArgusApi;
  }
}
