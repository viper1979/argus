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

/**
 * Shape every event contract must follow: domain → event → payload schema.
 * Events flow only from main to renderer (e.g. terminal output); the renderer never sends one.
 */
export type IpcEventContractShape = Readonly<Record<string, Readonly<Record<string, z.ZodType>>>>;

/** Event names of one domain in an event contract. */
type IpcEventName<
  TEvents extends IpcEventContractShape,
  TDomain extends keyof TEvents,
> = keyof TEvents[TDomain] & string;

/** Payload of an event, as the renderer receives it. */
type EventPayloadOf<
  TEvents extends IpcEventContractShape,
  TDomain extends keyof TEvents,
  TEvent extends IpcEventName<TEvents, TDomain>,
> = z.output<TEvents[TDomain][TEvent]>;

/** Stops a subscription; calling it more than once does nothing. */
export type IpcUnsubscribe = () => void;

/** Name of the subscribe method of an event, e.g. `output` → `onOutput`. */
export type IpcSubscribeMethodName<TEvent extends string> = `on${Capitalize<TEvent>}`;

/** Subscriptions the renderer sees: `api.<domain>.on<Event>(listener)`. */
export type IpcEventApi<TEvents extends IpcEventContractShape> = {
  readonly [TDomain in keyof TEvents]: {
    readonly [TEvent in IpcEventName<TEvents, TDomain> as IpcSubscribeMethodName<TEvent>]: (
      listener: (payload: EventPayloadOf<TEvents, TDomain, TEvent>) => void,
    ) => IpcUnsubscribe;
  };
};

/** Typed sender the main process uses: `emitter.<domain>.<event>(payload)`. */
export type IpcEventEmitter<TEvents extends IpcEventContractShape> = {
  readonly [TDomain in keyof TEvents]: {
    readonly [TEvent in IpcEventName<TEvents, TDomain>]: (
      payload: z.input<TEvents[TDomain][TEvent]>,
    ) => void;
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
