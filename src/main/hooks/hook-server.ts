import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AgentType } from '@shared/domain/project';
import type { Logger } from '../logging/logger';
import { HookServerAddressError } from './hook-server-address-error';

/** Host the hook server binds to; never reachable from other machines (concept 4). */
const HOOK_SERVER_HOST = '127.0.0.1';

/** Lets the operating system pick a free port; the hook settings file gets the real one. */
const ANY_FREE_PORT = 0;

/** Header that carries the agent session id, set from `ARGUS_SESSION_ID` (ADR 0003). */
export const HOOK_SESSION_HEADER = 'X-Argus-Session';

/** Header that carries the secret, set from `ARGUS_TOKEN` (ADR 0003). */
export const HOOK_TOKEN_HEADER = 'X-Argus-Token';

/** Each agent type posts to `/hooks/<agent-type>`; the rest of the url must match exactly. */
const HOOK_ROUTE_PREFIX = '/hooks/';

/**
 * Path an agent type posts its hook events to.
 * @param agentType The agent type.
 * @returns `/hooks/<agent-type>`.
 */
function buildHookPath(agentType: AgentType): string {
  return `${HOOK_ROUTE_PREFIX}${agentType}`;
}

/**
 * Url an agent type's hooks post to. The port is a literal number: Claude does not resolve
 * `$VAR` in the url, so the file is rewritten with the current port on every app start (ADR 0003).
 * @param port Port the hook server listens on.
 * @param agentType The agent type.
 * @returns E.g. `http://127.0.0.1:51234/hooks/claude-code`.
 */
export function buildHookUrl(port: number, agentType: AgentType): string {
  return `http://${HOOK_SERVER_HOST}:${String(port)}${buildHookPath(agentType)}`;
}

/** Accepted; Claude ignores the body of an HTTP hook response, so none is sent. */
const HTTP_NO_CONTENT = 204;
/** No token at all. */
const HTTP_UNAUTHORIZED = 401;
/** A token, but not the one of this app start. */
const HTTP_FORBIDDEN = 403;
/** No route for this path. */
const HTTP_NOT_FOUND = 404;
/** Hooks only ever post. */
const HTTP_METHOD_NOT_ALLOWED = 405;
const ALLOWED_METHOD = 'POST';
/** The request passed the checks, but Argus failed to take it. */
const HTTP_INTERNAL_SERVER_ERROR = 500;

/** One hook event that passed all checks; interpreted later by the agent type adapter (#8). */
export interface HookEvent {
  /** Agent type from the url `/hooks/<agent-type>`. */
  readonly agentType: AgentType;
  /** Agent session from the `X-Argus-Session` header; `null` if the header is missing. */
  readonly agentSessionId: string | null;
  /** Raw request body, unparsed. */
  readonly body: string;
}

/** The running hook server. */
export interface HookServer {
  /** Port the server listens on; goes into the hook settings file. */
  readonly port: number;
  /** Stops listening and closes open connections. */
  close(): Promise<void>;
}

/** What the hook server needs. */
export interface HookServerOptions {
  /** Secret every request must carry in `X-Argus-Token`. */
  readonly token: string;
  /** Agent types with a route `/hooks/<agent-type>`. */
  readonly agentTypes: readonly AgentType[];
  /** Receives every accepted event. */
  readonly onHookEvent: (event: HookEvent) => void;
  /** Receives requests that failed after passing the checks. */
  readonly logger: Logger;
}

/**
 * Starts the hook server on 127.0.0.1 with a free port.
 * @param options Token, routes and receiver of the events.
 * @returns The running server, once it listens.
 */
export async function startHookServer(options: HookServerOptions): Promise<HookServer> {
  const server = createServer((request, response) => {
    void handleRequest(request, response, options);
  });
  await listen(server);
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new HookServerAddressError(address);
  }
  return {
    port: address.port,
    close: () => closeServer(server),
  };
}

/**
 * Accepts one hook request.
 * @param request The incoming request.
 * @param response The response to send.
 * @param options Token, routes and receiver of the events.
 */
async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: HookServerOptions,
): Promise<void> {
  const agentType = options.agentTypes.find(
    (candidate) => request.url === buildHookPath(candidate),
  );
  if (agentType === undefined) {
    reject(request, response, HTTP_NOT_FOUND);
    return;
  }

  if (request.method !== ALLOWED_METHOD) {
    // RFC 9110: a 405 names the methods the route supports.
    response.setHeader('Allow', ALLOWED_METHOD);
    reject(request, response, HTTP_METHOD_NOT_ALLOWED);
    return;
  }

  const token = readHeader(request, HOOK_TOKEN_HEADER);
  if (token === null) {
    reject(request, response, HTTP_UNAUTHORIZED);
    return;
  }
  if (!isExpectedToken(token, options.token)) {
    reject(request, response, HTTP_FORBIDDEN);
    return;
  }

  const agentSessionId = readHeader(request, HOOK_SESSION_HEADER);
  try {
    const body = await readBody(request);
    options.onHookEvent({ agentType, agentSessionId, body });
    response.writeHead(HTTP_NO_CONTENT).end();
  } catch (error: unknown) {
    // E.g. the hook process was killed mid-request ("aborted"). Never log the body: it may
    // contain prompts and tool output.
    options.logger.error('Hook request failed', { agentType, agentSessionId, error });
    answerFailure(response);
  }
}

/**
 * Compares the sent token with the expected one in constant time, so response times do not
 * reveal how many leading characters were right.
 * @param sentToken Token from the request header.
 * @param expectedToken Token of this app start.
 * @returns Whether they are equal.
 */
function isExpectedToken(sentToken: string, expectedToken: string): boolean {
  const sent = Buffer.from(sentToken, 'utf8');
  const expected = Buffer.from(expectedToken, 'utf8');
  // timingSafeEqual requires equal lengths; the length of the token is no secret.
  return sent.length === expected.length && timingSafeEqual(sent, expected);
}

/**
 * Answers a request that did not pass the checks; its body is discarded unread.
 * @param request The rejected request.
 * @param response The response to send.
 * @param statusCode Why it was rejected.
 */
function reject(request: IncomingMessage, response: ServerResponse, statusCode: number): void {
  // Drain the body, so the connection is not left with unread data.
  request.resume();
  response.writeHead(statusCode).end();
}

/**
 * Ends a request that failed after it passed the checks: with 500 if the client still listens,
 * otherwise by closing the connection.
 * @param response The response of the failed request.
 */
function answerFailure(response: ServerResponse): void {
  if (response.headersSent || response.destroyed) {
    response.destroy();
    return;
  }
  response.writeHead(HTTP_INTERNAL_SERVER_ERROR).end();
}

/**
 * Reads a single-valued header.
 * @param request The incoming request.
 * @param name Header name in any case.
 * @returns The value, or `null` if it is missing or sent more than once.
 */
function readHeader(request: IncomingMessage, name: string): string | null {
  // Node stores incoming header names in lower case.
  const value = request.headers[name.toLowerCase()];
  return typeof value === 'string' ? value : null;
}

/**
 * Reads the whole request body as UTF-8.
 * @param request The incoming request.
 * @returns The body text.
 */
async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Starts listening on the loopback interface.
 * @param server The HTTP server.
 */
function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(ANY_FREE_PORT, HOOK_SERVER_HOST, () => {
      server.off('error', reject);
      resolve();
    });
  });
}

/**
 * Stops the server, including keep-alive connections that would otherwise keep it open.
 * @param server The HTTP server.
 */
function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
    server.closeAllConnections();
  });
}
