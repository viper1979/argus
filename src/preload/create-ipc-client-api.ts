import type { IpcChannel, IpcClientApi, IpcContractShape } from '@shared/ipc/contract-types';
import { mapContract } from '@shared/ipc/map-contract';

/** Sends a message on a channel and resolves with the reply; in production `ipcRenderer.invoke`. */
export type IpcInvoke = (channel: IpcChannel, request: unknown) => Promise<unknown>;

/**
 * Derives the namespaced client API (`api.<domain>.<action>()`) from a contract.
 * Validation happens in the main process; the client only forwards calls.
 * @param contract The IPC contract whose endpoints become client methods.
 * @param invoke Transport used to reach the main process.
 * @returns One async method per endpoint, grouped by domain.
 */
export function createIpcClientApi<TContract extends IpcContractShape>(
  contract: TContract,
  invoke: IpcInvoke,
): IpcClientApi<TContract> {
  const api = mapContract(contract, (action, channel) => [
    action,
    (request: unknown) => invoke(channel, request),
  ]);
  return api as IpcClientApi<TContract>;
}
