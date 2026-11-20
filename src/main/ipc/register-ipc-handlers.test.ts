import type { IpcHandlers } from '@shared/ipc/contract-types';
import { testContract } from '@shared/ipc/testing/test-contract';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { z } from 'zod';
import type { Logger } from '../logging/logger';
import { IpcValidationError } from './ipc-validation-error';
import { MissingIpcHandlerError } from './missing-ipc-handler-error';
import { registerIpcHandlers, type IpcMainLike } from './register-ipc-handlers';

type InvokeListener = (event: unknown, ...args: unknown[]) => unknown;

/** In-memory stand-in for Electron's ipcMain that records registered listeners. */
class FakeIpcMain implements IpcMainLike {
  private readonly listeners = new Map<string, InvokeListener>();

  /** Records the listener for the given channel. */
  handle(channel: string, listener: InvokeListener): void {
    this.listeners.set(channel, listener);
  }

  /** Channels that currently have a listener, in registration order. */
  get registeredChannels(): string[] {
    return [...this.listeners.keys()];
  }

  /** Simulates `ipcRenderer.invoke(channel, payload)` from the renderer. */
  async invoke(channel: string, payload: unknown): Promise<unknown> {
    const listener = this.listeners.get(channel);
    if (!listener) {
      throw new Error(`No handler registered for ${channel}`);
    }
    return await listener({}, payload);
  }
}

describe('registerIpcHandlers', () => {
  let ipcMain: FakeIpcMain;
  let logger: Logger;
  let logWarn: Mock<Logger['warn']>;
  let logError: Mock<Logger['error']>;

  /**
   * Registers the test contract with a single `greeting.greet` implementation.
   * @param greet Implementation of the `greeting:greet` endpoint.
   */
  function registerGreet(greet: IpcHandlers<typeof testContract>['greeting']['greet']): void {
    registerIpcHandlers({
      ipcMain,
      contract: testContract,
      handlers: { greeting: { greet } },
      logger,
    });
  }

  beforeEach(() => {
    ipcMain = new FakeIpcMain();
    logWarn = vi.fn<Logger['warn']>();
    logError = vi.fn<Logger['error']>();
    logger = { warn: logWarn, error: logError };
  });

  it('registerIpcHandlers_WithValidRequest_ReturnsHandlerResponse', async () => {
    // Arrange
    registerGreet(({ name }) => ({ message: `Hallo ${name}` }));

    // Act
    const response = await ipcMain.invoke('greeting:greet', { name: 'Argus' });

    // Assert
    expect(response).toEqual({ message: 'Hallo Argus' });
  });

  it('registerIpcHandlers_WithInvalidRequest_RejectsWithoutCallingHandlerAndLogs', async () => {
    // Arrange
    const greet = vi.fn(() => ({ message: 'unreachable' }));
    registerGreet(greet);

    // Act
    const invocation = ipcMain.invoke('greeting:greet', { name: 42 });

    // Assert
    await expect(invocation).rejects.toBeInstanceOf(IpcValidationError);
    expect(greet).not.toHaveBeenCalled();
    expect(logWarn).toHaveBeenCalledWith(
      expect.stringContaining('greeting:greet'),
      expect.objectContaining({ channel: 'greeting:greet', direction: 'request' }),
    );
  });

  it('registerIpcHandlers_WithInvalidRequest_DoesNotLogPayloadValues', async () => {
    // Arrange
    const sensitiveValue = 'secret-token-4711';
    registerGreet(() => ({ message: 'unreachable' }));

    // Act
    await ipcMain.invoke('greeting:greet', { name: [sensitiveValue] }).catch(() => undefined);

    // Assert
    expect(logWarn).toHaveBeenCalled();
    expect(JSON.stringify(logWarn.mock.calls)).not.toContain(sensitiveValue);
  });

  it('registerIpcHandlers_WithInvalidHandlerResponse_RejectsAndLogsError', async () => {
    // Arrange
    registerGreet(() => ({ message: 7 }) as unknown as { message: string });

    // Act
    const invocation = ipcMain.invoke('greeting:greet', { name: 'Argus' });

    // Assert
    await expect(invocation).rejects.toBeInstanceOf(IpcValidationError);
    expect(logError).toHaveBeenCalledWith(
      expect.stringContaining('greeting:greet'),
      expect.objectContaining({ channel: 'greeting:greet', direction: 'response' }),
    );
  });

  it('registerIpcHandlers_WithInvalidHandlerResponse_DoesNotLogResponseValues', async () => {
    // Arrange
    const sensitiveValue = 'secret-token-0815';
    registerGreet(() => ({ message: [sensitiveValue] }) as unknown as { message: string });

    // Act
    await ipcMain.invoke('greeting:greet', { name: 'Argus' }).catch(() => undefined);

    // Assert
    expect(logError).toHaveBeenCalled();
    expect(JSON.stringify(logError.mock.calls)).not.toContain(sensitiveValue);
  });

  it('registerIpcHandlers_WhenHandlerThrows_LogsErrorAndRejectsWithOriginalError', async () => {
    // Arrange
    const handlerFailure = new Error('disk full');
    registerGreet(() => {
      throw handlerFailure;
    });

    // Act
    const invocation = ipcMain.invoke('greeting:greet', { name: 'Argus' });

    // Assert
    await expect(invocation).rejects.toBe(handlerFailure);
    expect(logError).toHaveBeenCalledWith(
      expect.stringContaining('greeting:greet'),
      expect.objectContaining({ channel: 'greeting:greet', error: handlerFailure }),
    );
  });

  it('registerIpcHandlers_WithMissingHandler_ThrowsMissingIpcHandlerError', () => {
    // Arrange
    // The types forbid a missing handler; the cast simulates a gap that slipped past them.
    const incompleteHandlers = { greeting: {} } as unknown as IpcHandlers<typeof testContract>;

    // Act
    const register = (): void => {
      registerIpcHandlers({
        ipcMain,
        contract: testContract,
        handlers: incompleteHandlers,
        logger,
      });
    };

    // Assert
    expect(register).toThrow(MissingIpcHandlerError);
  });

  it('registerIpcHandlers_WithMissingHandler_RegistersNoChannel', () => {
    // Arrange
    // Two endpoints, only the first one implemented: nothing may be registered half-way.
    const twoEndpointContract = {
      greeting: {
        greet: testContract.greeting.greet,
        wave: { request: z.object({}), response: z.object({}) },
      },
    } as const;
    const incompleteHandlers = {
      greeting: { greet: () => ({ message: 'Hallo' }) },
    } as unknown as IpcHandlers<typeof twoEndpointContract>;

    // Act
    try {
      registerIpcHandlers({
        ipcMain,
        contract: twoEndpointContract,
        handlers: incompleteHandlers,
        logger,
      });
    } catch {
      // Expected: MissingIpcHandlerError, covered by the previous test.
    }

    // Assert
    expect(ipcMain.registeredChannels).toEqual([]);
  });
});
