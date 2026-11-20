import type { IpcChannel, IpcClientApi, IpcContractShape } from '@shared/ipc/contract-types';
import { toIpcChannel } from '@shared/ipc/contract-types';

/** Sends a message on a channel and resolves with the reply; in production `ipcRenderer.invoke`. */
export type IpcInvoke = (channel: IpcChannel, request: unknown) => Promise<unknown>;

/** Client methods of one domain after the contract types have been erased for construction. */
type UntypedDomainApi = Record<string, (request: unknown) => Promise<unknown>>;

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
  const api: Record<string, UntypedDomainApi> = {};

  for (const [domain, endpoints] of Object.entries(contract)) {
    const domainApi: UntypedDomainApi = {};
    for (const action of Object.keys(endpoints)) {
      const channel = toIpcChannel(domain, action);
      domainApi[action] = (request) => invoke(channel, request);
    }
    api[domain] = domainApi;
  }

  return api as IpcClientApi<TContract>;
}
