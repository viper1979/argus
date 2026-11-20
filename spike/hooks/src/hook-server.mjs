import http from 'node:http';
import fs from 'node:fs';

/**
 * Behaviour of the hook server when a request arrives.
 * - `respond`: answer immediately with 200 and an empty body (normal case).
 * - `hang`: accept the connection but never answer, to provoke Claude's hook timeout.
 * @typedef {'respond' | 'hang'} HookServerMode
 */

/**
 * Starts a minimal HTTP server on 127.0.0.1 that records every hook POST.
 * Every request is appended as one JSON line to `logFile` and kept in memory.
 *
 * @param {{ logFile: string, mode?: HookServerMode, port?: number }} options
 * @returns {Promise<{ port: number, events: object[], close: () => Promise<void> }>}
 */
export function startHookServer({ logFile, mode = 'respond', port = 0 }) {
  const events = [];
  const pendingResponses = new Set();

  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const event = buildEventRecord(request, Buffer.concat(chunks).toString('utf8'));
      events.push(event);
      fs.appendFileSync(logFile, JSON.stringify(event) + '\n');

      if (mode === 'hang') {
        // Deliberately never answer, so Claude has to run into its hook timeout.
        pendingResponses.add(response);
        return;
      }
      response.writeHead(200);
      response.end();
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      resolve({
        port: server.address().port,
        events,
        close: () => closeServer(server, pendingResponses),
      });
    });
  });
}

/**
 * Converts a raw request into the record we log: arrival time, path, Argus headers, parsed body.
 *
 * @param {http.IncomingMessage} request
 * @param {string} rawBody
 * @returns {object}
 */
function buildEventRecord(request, rawBody) {
  let body;
  try {
    body = JSON.parse(rawBody);
  } catch (parseError) {
    body = { unparsable: rawBody, error: String(parseError) };
  }

  // Only our own headers are interesting for the $VAR interpolation question.
  const argusHeaders = Object.fromEntries(
    Object.entries(request.headers).filter(([name]) => name.startsWith('x-argus-')),
  );

  return {
    receivedAt: Date.now(),
    url: request.url,
    headers: argusHeaders,
    hookEventName: body.hook_event_name,
    body,
  };
}

/**
 * Closes the server, including connections that were left hanging on purpose.
 *
 * @param {http.Server} server
 * @param {Set<http.ServerResponse>} pendingResponses
 * @returns {Promise<void>}
 */
function closeServer(server, pendingResponses) {
  for (const response of pendingResponses) {
    response.destroy();
  }
  server.closeAllConnections();
  return new Promise((resolve) => server.close(() => resolve()));
}

/**
 * Returns a port that is free right now and will refuse connections afterwards.
 * Used to simulate an unreachable hook URL.
 *
 * @returns {Promise<number>}
 */
export async function reserveClosedPort() {
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}
