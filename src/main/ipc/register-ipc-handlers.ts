import { fileURLToPath } from 'node:url';
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
import { UntrustedIpcSenderError } from './untrusted-ipc-sender-error';

/** The part of Electron's `IpcMainInvokeEvent` this module needs. */
export interface IpcInvokeEventLike {
  /**
   * Frame that sent the message; `null` once the frame has been destroyed or navigated away.
   * Reading `url` of a disposed frame may throw.
   */
  readonly senderFrame: { readonly url: string } | null;
}

/** The part of Electron's `ipcMain` this module needs; allows a fake in tests. */
export interface IpcMainLike {
  /**
   * Registers the listener that answers `ipcRenderer.invoke` calls on a channel.
   * @param channel Channel name in the form `domain:action`.
   * @param listener Receives the Electron event and the payload; its return value is the reply.
   */
  handle(
    channel: string,
    listener: (event: IpcInvokeEventLike, ...args: unknown[]) => unknown,
  ): void;
}

/** Everything needed to wire a contract to its handlers. */
export interface RegisterIpcHandlersOptions<TContract extends IpcContractShape> {
  readonly ipcMain: IpcMainLike;
  readonly contract: TContract;
  readonly handlers: IpcHandlers<TContract>;
  readonly logger: Logger;
  /**
   * URL the app's own renderer is loaded from: the Vite dev server in dev mode,
   * the `file:` URL of the built `index.html` otherwise. Messages from any other frame are rejected.
   */
  readonly allowedRendererUrl: URL;
}

/** Protocol of URLs that point to local files, as reported by `URL.protocol`. */
const FILE_PROTOCOL = 'file:';

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
  const { ipcMain, contract, handlers, logger, allowedRendererUrl } = options;
  const bindings = bindEndpointsToHandlers(contract, handlers);

  for (const { channel, endpoint, handler } of bindings) {
    ipcMain.handle(channel, async (event, payload) => {
      rejectUntrustedSender(event, allowedRendererUrl, { channel, logger });
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
 * Rejects a message that was not sent by the app's own renderer.
 * @param event The Electron invoke event carrying the sending frame.
 * @param allowedRendererUrl URL the app's renderer is loaded from.
 * @param context Channel and logger.
 * @throws UntrustedIpcSenderError if the sender is not the app's renderer.
 */
function rejectUntrustedSender(
  event: IpcInvokeEventLike,
  allowedRendererUrl: URL,
  context: EndpointContext,
): void {
  const senderUrl = parseSenderUrl(event);
  const isTrustedSender = senderUrl !== null && isAllowedRendererUrl(senderUrl, allowedRendererUrl);
  if (isTrustedSender) {
    return;
  }

  const { channel, logger } = context;
  const senderOrigin = senderUrl === null ? null : describeSenderOrigin(senderUrl);
  logger.warn(`Rejected IPC request from untrusted sender on ${channel}`, {
    channel,
    senderOrigin,
  });
  throw new UntrustedIpcSenderError(channel, senderOrigin);
}

/**
 * Reads the URL of the sending frame.
 * @param event The Electron invoke event.
 * @returns The parsed URL, or `null` if the frame is gone or its URL cannot be parsed.
 */
function parseSenderUrl(event: IpcInvokeEventLike): URL | null {
  const rawSenderUrl = readSenderFrameUrl(event);
  if (rawSenderUrl === null || !URL.canParse(rawSenderUrl)) {
    return null;
  }
  return new URL(rawSenderUrl);
}

/**
 * Reads the raw URL of the sending frame without letting a disposed frame break the request.
 * @param event The Electron invoke event.
 * @returns The frame URL, or `null` if there is no frame or it can no longer be read.
 */
function readSenderFrameUrl(event: IpcInvokeEventLike): string | null {
  try {
    return event.senderFrame?.url ?? null;
  } catch {
    // Catch-all on purpose: Electron throws a plain Error (no own type) when a WebFrameMain is
    // read after its render frame was disposed. Such a sender counts as missing and is rejected.
    return null;
  }
}

/**
 * Reduces a sender URL to its origin, so tokens in query or hash never reach the log.
 * Every file: URL has the opaque origin "null", so for files the path is kept instead.
 * @param senderUrl URL of the sending frame.
 * @returns The origin for http(s) senders, the URL without query and hash for files.
 */
function describeSenderOrigin(senderUrl: URL): string {
  if (senderUrl.protocol !== FILE_PROTOCOL) {
    return senderUrl.origin;
  }
  const fileUrlWithoutQueryOrHash = new URL(senderUrl.href);
  fileUrlWithoutQueryOrHash.search = '';
  fileUrlWithoutQueryOrHash.hash = '';
  return fileUrlWithoutQueryOrHash.href;
}

/**
 * Checks whether a frame URL belongs to the app's renderer. Query and hash are ignored,
 * so in-app routing does not matter.
 * @param senderUrl URL of the sending frame.
 * @param allowedRendererUrl URL the app's renderer is loaded from.
 * @returns `true` if the sender is the app's renderer.
 */
function isAllowedRendererUrl(senderUrl: URL, allowedRendererUrl: URL): boolean {
  // Every file: URL has the opaque origin "null", so the origin alone would let any local
  // HTML file through. A built renderer must therefore match the exact index.html path.
  if (allowedRendererUrl.protocol === FILE_PROTOCOL) {
    const senderPath = toComparableWindowsPath(senderUrl);
    return senderPath !== null && senderPath === toComparableWindowsPath(allowedRendererUrl);
  }
  return senderUrl.origin === allowedRendererUrl.origin;
}

/**
 * Turns a file: URL into a Windows path that can be compared with another one.
 * Comparing paths instead of URLs covers the UNC server name (`\\server\share`) and
 * percent-encoded characters; lower-casing covers that Windows paths are case-insensitive
 * (ADR 0002: Windows only) while Chromium upper-cases the drive letter and pathToFileURL
 * keeps the case it was given.
 * @param fileUrl A URL with any protocol.
 * @returns The lower-cased Windows path, or `null` if the URL is no valid Windows file URL.
 */
function toComparableWindowsPath(fileUrl: URL): string | null {
  if (fileUrl.protocol !== FILE_PROTOCOL) {
    return null;
  }
  try {
    return fileURLToPath(fileUrl, { windows: true }).toLowerCase();
  } catch (error: unknown) {
    // fileURLToPath throws a TypeError for file: URLs that are no valid Windows path,
    // e.g. with an encoded backslash; such a sender is treated as untrusted.
    if (error instanceof TypeError) {
      return null;
    }
    throw error;
  }
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
