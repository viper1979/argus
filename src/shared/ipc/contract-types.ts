import type { z } from 'zod';

/** One request/response pair; both directions are validated in the main process. */
export interface IpcEndpoint {
  readonly request: z.ZodType;
  readonly response: z.ZodType;
}

/** Shape every IPC contract must follow: domain → action → endpoint. */
export type IpcContractShape = Readonly<Record<string, Readonly<Record<string, IpcEndpoint>>>>;

/** Action names of one domain in a contract. */
export type IpcActionName<
  TContract extends IpcContractShape,
  TDomain extends keyof TContract,
> = keyof TContract[TDomain] & string;

/** Endpoint addressed by domain and action. */
type EndpointOf<
  TContract extends IpcContractShape,
  TDomain extends keyof TContract,
  TAction extends IpcActionName<TContract, TDomain>,
> = TContract[TDomain][TAction];

/** Typed API the renderer sees: `api.<domain>.<action>(request)`. */
export type IpcClientApi<TContract extends IpcContractShape> = {
  readonly [TDomain in keyof TContract]: {
    readonly [TAction in IpcActionName<TContract, TDomain>]: (
      request: z.input<EndpointOf<TContract, TDomain, TAction>['request']>,
    ) => Promise<z.output<EndpointOf<TContract, TDomain, TAction>['response']>>;
  };
};

/** Implementations the main process provides; they receive already validated requests. */
export type IpcHandlers<TContract extends IpcContractShape> = {
  readonly [TDomain in keyof TContract]: {
    readonly [TAction in IpcActionName<TContract, TDomain>]: (
      request: z.output<EndpointOf<TContract, TDomain, TAction>['request']>,
    ) =>
      | z.input<EndpointOf<TContract, TDomain, TAction>['response']>
      | Promise<z.input<EndpointOf<TContract, TDomain, TAction>['response']>>;
  };
};

/** Electron channel name of an endpoint, always in the form `domain:action`. */
export type IpcChannel = `${string}:${string}`;

/**
 * Builds the Electron channel name for an endpoint. Channel strings are never written by hand,
 * so main and preload cannot drift apart.
 * @param domain Domain key of the contract, e.g. `app`.
 * @param action Action key within the domain, e.g. `getInfo`.
 * @returns Channel name in the form `domain:action`.
 */
export function toIpcChannel(domain: string, action: string): IpcChannel {
  return `${domain}:${action}`;
}
