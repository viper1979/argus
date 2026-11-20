import type {
  IpcChannel,
  IpcContractShape,
  IpcEndpoint,
  IpcHandlers,
} from '@shared/ipc/contract-types';
import { toIpcChannel } from '@shared/ipc/contract-types';
import type { z } from 'zod';
import type { Logger } from '../logging/logger';
import { IpcValidationError, type IpcMessageDirection } from './ipc-validation-error';
import { MissingIpcHandlerError } from './missing-ipc-handler-error';

/** The part of Electron's `ipcMain` this module needs; allows a fake in tests. */
export interface IpcMainLike {
  /**
   * Registers the listener that answers `ipcRenderer.invoke` calls on a channel.
   * @param channel Channel name in the form `domain:action`.
   * @param listener Receives the Electron event and the payload; its return value is the reply.
   */
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void;
}

/** Everything needed to wire a contract to its handlers. */
export interface RegisterIpcHandlersOptions<TContract extends IpcContractShape> {
  readonly ipcMain: IpcMainLike;
  readonly contract: TContract;
  readonly handlers: IpcHandlers<TContract>;
  readonly logger: Logger;
}

/** Handler of one endpoint after the contract types have been erased for iteration. */
type UntypedHandler = (request: unknown) => unknown;

/** One contract endpoint together with its implementation, ready to be registered. */
interface EndpointBinding {
  readonly channel: IpcChannel;
  readonly endpoint: IpcEndpoint;
  readonly handler: UntypedHandler;
}

/**
 * Registers one `ipcMain.handle` listener per contract endpoint. Each listener validates the
 * request, calls the handler and validates the response; every rejection is logged.
 * All handlers are checked before the first listener is registered, so a missing handler
 * never leaves a half-registered state behind.
 * @param options Electron ipcMain, contract, handler implementations and logger.
 * @throws MissingIpcHandlerError if an endpoint of the contract has no handler.
 */
export function registerIpcHandlers<TContract extends IpcContractShape>(
  options: RegisterIpcHandlersOptions<TContract>,
): void {
  const { ipcMain, contract, handlers, logger } = options;
  const bindings = bindEndpointsToHandlers(contract, handlers);

  for (const { channel, endpoint, handler } of bindings) {
    ipcMain.handle(channel, async (_event, payload) => {
      const request = parseOrReject(endpoint.request, payload, {
        channel,
        direction: 'request',
        logger,
      });
      const response = await invokeHandler(handler, request, { channel, logger });
      return parseOrReject(endpoint.response, response, {
        channel,
        direction: 'response',
        logger,
      });
    });
  }
}

/**
 * Pairs every contract endpoint with its handler.
 * @param contract The IPC contract.
 * @param handlers The handler implementations.
 * @returns One binding per endpoint.
 * @throws MissingIpcHandlerError for the first endpoint without handler.
 */
function bindEndpointsToHandlers<TContract extends IpcContractShape>(
  contract: TContract,
  handlers: IpcHandlers<TContract>,
): EndpointBinding[] {
  const bindings: EndpointBinding[] = [];

  for (const [domain, endpoints] of Object.entries(contract)) {
    const domainHandlers = handlers[domain] as Record<string, UntypedHandler | undefined>;

    for (const [action, endpoint] of Object.entries(endpoints)) {
      const channel = toIpcChannel(domain, action);
      const handler = domainHandlers[action];
      if (!handler) {
        throw new MissingIpcHandlerError(channel);
      }
      bindings.push({ channel, endpoint, handler });
    }
  }

  return bindings;
}

/** Channel and logger of one endpoint, shared by validation and handler invocation. */
interface EndpointContext {
  readonly channel: IpcChannel;
  readonly logger: Logger;
}

/** Where a value is validated, used for logging and the rejection error. */
interface ValidationContext extends EndpointContext {
  readonly direction: IpcMessageDirection;
}

/**
 * Validates an IPC message against its schema and rejects it if it does not match.
 * Invalid requests come from the renderer (untrusted input) and are logged as warning;
 * invalid responses are a bug in the main process and are logged as error.
 * @param schema The zod schema from the contract.
 * @param value The raw message.
 * @param context Channel, direction and logger.
 * @returns The parsed value.
 * @throws IpcValidationError if the value does not match the schema.
 */
function parseOrReject(schema: z.ZodType, value: unknown, context: ValidationContext): unknown {
  const { channel, direction, logger } = context;
  const result = schema.safeParse(value);
  if (result.success) {
    return result.data;
  }

  const log = direction === 'request' ? logger.warn.bind(logger) : logger.error.bind(logger);
  log(`Rejected invalid IPC ${direction} on ${channel}`, {
    channel,
    direction,
    issues: summarizeIssues(result.error),
  });
  throw new IpcValidationError(channel, direction);
}

/**
 * Calls a handler and logs any failure with its channel before passing it on.
 * @param handler The endpoint implementation.
 * @param request The already validated request.
 * @param context Channel and logger.
 * @returns Whatever the handler returns.
 */
async function invokeHandler(
  handler: UntypedHandler,
  request: unknown,
  context: EndpointContext,
): Promise<unknown> {
  try {
    return await handler(request);
  } catch (error: unknown) {
    // Catch-all on purpose: this is the process boundary. Any handler failure is logged
    // here and then rethrown unchanged so the renderer still sees it.
    // NOTE: the whole error is logged, so handlers must not put sensitive data into messages.
    context.logger.error(`IPC handler failed on ${context.channel}`, {
      channel: context.channel,
      error,
    });
    throw error;
  }
}

/**
 * Reduces zod issues to path and message so rejected payload values never end up in the log.
 * @param error The zod error of a failed parse.
 * @returns One `path: message` entry per issue.
 */
function summarizeIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`);
}
