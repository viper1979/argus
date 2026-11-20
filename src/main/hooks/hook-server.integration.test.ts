import { request as httpRequest } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { Logger } from '../logging/logger';
import { startHookServer, type HookEvent, type HookServer } from './hook-server';
import { createFakeLogger } from '../logging/testing/fake-logger';

/** Token the server under test expects; generated randomly per app start in production. */
const TOKEN = 'test-token-0123456789abcdef';

/** Payload as Claude Code posts it; the server passes it on without interpreting it. */
const STOP_PAYLOAD = '{"hook_event_name":"Stop","session_id":"conversation-1"}';

describe('startHookServer', () => {
  let server: HookServer;
  let onHookEvent: Mock<(event: HookEvent) => void>;
  let logError: Mock<Logger['error']>;

  beforeEach(async () => {
    onHookEvent = vi.fn();
    logError = vi.fn();
    server = await startHookServer({
      token: TOKEN,
      agentTypes: ['claude-code'],
      onHookEvent,
      logger: createFakeLogger({ error: logError }),
    });
  });

  afterEach(async () => {
    await server.close();
  });

  /**
   * Sends a request to the server under test, like Claude's HTTP hook does.
   * @param path Request path.
   * @param init Method, headers and body.
   * @returns The response.
   */
  function send(path: string, init: RequestInit): Promise<Response> {
    return fetch(`http://127.0.0.1:${String(server.port)}${path}`, init);
  }

  it('post_WithValidToken_Returns204AndForwardsEvent', async () => {
    // Act
    const response = await send('/hooks/claude-code', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Argus-Token': TOKEN,
        'X-Argus-Session': 'session-1',
      },
      body: STOP_PAYLOAD,
    });

    // Assert
    expect(response.status).toBe(204);
    expect(onHookEvent).toHaveBeenCalledExactlyOnceWith({
      agentType: 'claude-code',
      agentSessionId: 'session-1',
      body: STOP_PAYLOAD,
    });
  });

  it('post_WithoutToken_Returns401AndDropsEvent', async () => {
    // Act: e.g. another local process probing the port
    const response = await send('/hooks/claude-code', { method: 'POST', body: STOP_PAYLOAD });

    // Assert
    expect(response.status).toBe(401);
    expect(onHookEvent).not.toHaveBeenCalled();
  });

  it.each([
    ['Shorter', 'wrong'],
    ['SameLength', 'test-token-0123456789abcdeX'],
  ])('post_WithWrongToken_%s_Returns403AndDropsEvent', async (_case, wrongToken) => {
    // Act
    const response = await send('/hooks/claude-code', {
      method: 'POST',
      headers: { 'X-Argus-Token': wrongToken },
      body: STOP_PAYLOAD,
    });

    // Assert
    expect(response.status).toBe(403);
    expect(onHookEvent).not.toHaveBeenCalled();
  });

  it.each([['/hooks/codex'], ['/hooks/claude-code/extra'], ['/']])(
    'post_ToUnknownPath_%s_Returns404AndDropsEvent',
    async (path) => {
      // Act: even with the right token, only routes of known agent types accept events
      const response = await send(path, {
        method: 'POST',
        headers: { 'X-Argus-Token': TOKEN },
        body: STOP_PAYLOAD,
      });

      // Assert
      expect(response.status).toBe(404);
      expect(onHookEvent).not.toHaveBeenCalled();
    },
  );

  it('get_OnHookRoute_Returns405AndDropsEvent', async () => {
    // Act: hooks only ever post
    const response = await send('/hooks/claude-code', {
      method: 'GET',
      headers: { 'X-Argus-Token': TOKEN },
    });

    // Assert
    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('POST');
    expect(onHookEvent).not.toHaveBeenCalled();
  });

  it('post_WhenClientAbortsDuringBody_LogsErrorAndDropsEvent', async () => {
    // Arrange: announce a longer body than is sent, like a hook process killed mid-request
    const abortedRequest = httpRequest({
      host: '127.0.0.1',
      port: server.port,
      path: '/hooks/claude-code',
      method: 'POST',
      headers: { 'X-Argus-Token': TOKEN, 'Content-Length': '1000' },
    });
    abortedRequest.on('error', () => {
      // Expected: the test destroys its own request.
    });

    // Act
    abortedRequest.write('{"hook_event_name":');
    await vi.waitFor(() => {
      expect(abortedRequest.socket).not.toBeNull();
    });
    abortedRequest.destroy();

    // Assert
    await vi.waitFor(() => {
      expect(logError).toHaveBeenCalledWith(
        'Hook request failed',
        expect.objectContaining({ agentType: 'claude-code' }),
      );
    });
    expect(onHookEvent).not.toHaveBeenCalled();
  });

  it('post_WhenReceiverThrows_Returns500AndLogsError', async () => {
    // Arrange: a bug in the receiver must not leave Claude waiting for its hook timeout
    const receiverError = new Error('Receiver failed');
    onHookEvent.mockImplementation(() => {
      throw receiverError;
    });

    // Act
    const response = await send('/hooks/claude-code', {
      method: 'POST',
      headers: { 'X-Argus-Token': TOKEN, 'X-Argus-Session': 'session-1' },
      body: STOP_PAYLOAD,
    });

    // Assert
    expect(response.status).toBe(500);
    expect(logError).toHaveBeenCalledExactlyOnceWith('Hook request failed', {
      agentType: 'claude-code',
      agentSessionId: 'session-1',
      error: receiverError,
    });
  });
});
