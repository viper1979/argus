import type { IpcHandlers } from '@shared/ipc/contract-types';
import { testContract } from '@shared/ipc/testing/test-contract';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { z } from 'zod';
import type { Logger } from '../logging/logger';
import { IpcValidationError } from './ipc-validation-error';
import { MissingIpcHandlerError } from './missing-ipc-handler-error';
import {
  registerIpcHandlers,
  type IpcInvokeEventLike,
  type IpcMainLike,
} from './register-ipc-handlers';
import { UntrustedIpcSenderError } from './untrusted-ipc-sender-error';

type InvokeListener = (event: IpcInvokeEventLike, ...args: unknown[]) => unknown;

/** Renderer URL the tests register as allowed, shaped like the Vite dev server. */
const ALLOWED_RENDERER_URL = new URL('http://localhost:5173/');

/** A sender outside the app, e.g. a remote page that got loaded into a frame. */
const FOREIGN_SENDER_URL = 'https://evil.example/';
const FOREIGN_SENDER_ORIGIN = 'https://evil.example';

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

  /**
   * Simulates `ipcRenderer.invoke(channel, payload)` from a renderer frame.
   * @param channel Channel name in the form `domain:action`.
   * @param payload Request payload.
   * @param senderUrl URL of the sending frame; `null` simulates a destroyed frame.
   *   Defaults to the allowed renderer URL.
   */
  async invoke(
    channel: string,
    payload: unknown,
    senderUrl: string | null = ALLOWED_RENDERER_URL.href,
  ): Promise<unknown> {
    const senderFrame = senderUrl === null ? null : { url: senderUrl };
    return await this.invokeFromFrame(channel, payload, senderFrame);
  }

  /**
   * Simulates `ipcRenderer.invoke(channel, payload)` with full control over the sending frame.
   * @param channel Channel name in the form `domain:action`.
   * @param payload Request payload.
   * @param senderFrame The frame Electron reports as sender.
   */
  async invokeFromFrame(
    channel: string,
    payload: unknown,
    senderFrame: IpcInvokeEventLike['senderFrame'],
  ): Promise<unknown> {
    const listener = this.listeners.get(channel);
    if (!listener) {
      throw new Error(`No handler registered for ${channel}`);
    }
    return await listener({ senderFrame }, payload);
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
   * @param allowedRendererUrl URL of the only sender that is accepted.
   */
  function registerGreet(
    greet: IpcHandlers<typeof testContract>['greeting']['greet'],
    allowedRendererUrl: URL = ALLOWED_RENDERER_URL,
  ): void {
    registerIpcHandlers({
      ipcMain,
      contract: testContract,
      handlers: { greeting: { greet } },
      logger,
      allowedRendererUrl,
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

  it('registerIpcHandlers_WithForeignSender_RejectsWithoutCallingHandlerAndLogsOrigin', async () => {
    // Arrange
    const greet = vi.fn(() => ({ message: 'unreachable' }));
    registerGreet(greet);

    // Act
    const invocation = ipcMain.invoke('greeting:greet', { name: 'Argus' }, FOREIGN_SENDER_URL);

    // Assert
    await expect(invocation).rejects.toBeInstanceOf(UntrustedIpcSenderError);
    expect(greet).not.toHaveBeenCalled();
    expect(logWarn).toHaveBeenCalledWith(
      expect.stringContaining('greeting:greet'),
      expect.objectContaining({ channel: 'greeting:greet', senderOrigin: FOREIGN_SENDER_ORIGIN }),
    );
  });

  it('registerIpcHandlers_WithMissingSender_RejectsWithoutCallingHandlerAndLogs', async () => {
    // Arrange
    const greet = vi.fn(() => ({ message: 'unreachable' }));
    registerGreet(greet);

    // Act
    const invocation = ipcMain.invoke('greeting:greet', { name: 'Argus' }, null);

    // Assert
    await expect(invocation).rejects.toBeInstanceOf(UntrustedIpcSenderError);
    expect(greet).not.toHaveBeenCalled();
    expect(logWarn).toHaveBeenCalledWith(
      expect.stringContaining('greeting:greet'),
      expect.objectContaining({ channel: 'greeting:greet', senderOrigin: null }),
    );
  });

  it('registerIpcHandlers_WhenSenderFrameUrlThrows_RejectsAsMissingSender', async () => {
    // Arrange
    // Electron throws when a WebFrameMain is read after its render frame was disposed.
    const greet = vi.fn(() => ({ message: 'unreachable' }));
    registerGreet(greet);
    const disposedFrame = {
      get url(): string {
        throw new Error('Render frame was disposed before WebFrameMain could be accessed');
      },
    };

    // Act
    const invocation = ipcMain.invokeFromFrame('greeting:greet', { name: 'Argus' }, disposedFrame);

    // Assert
    await expect(invocation).rejects.toBeInstanceOf(UntrustedIpcSenderError);
    expect(greet).not.toHaveBeenCalled();
    expect(logWarn).toHaveBeenCalledWith(
      expect.stringContaining('greeting:greet'),
      expect.objectContaining({ channel: 'greeting:greet', senderOrigin: null }),
    );
  });

  it('registerIpcHandlers_WithUnparsableSenderUrl_RejectsAsUntrustedSender', async () => {
    // Arrange
    const greet = vi.fn(() => ({ message: 'unreachable' }));
    registerGreet(greet);

    // Act
    const invocation = ipcMain.invoke('greeting:greet', { name: 'Argus' }, '');

    // Assert
    await expect(invocation).rejects.toBeInstanceOf(UntrustedIpcSenderError);
    expect(greet).not.toHaveBeenCalled();
  });

  it('registerIpcHandlers_WithForeignSender_DoesNotLogPayloadValues', async () => {
    // Arrange
    const sensitiveValue = 'secret-token-1337';
    registerGreet(() => ({ message: 'unreachable' }));

    // Act
    await ipcMain
      .invoke('greeting:greet', { name: sensitiveValue }, FOREIGN_SENDER_URL)
      .catch(() => undefined);

    // Assert
    expect(logWarn).toHaveBeenCalled();
    expect(JSON.stringify(logWarn.mock.calls)).not.toContain(sensitiveValue);
  });

  it('registerIpcHandlers_WithForeignSenderUrlContainingSecrets_LogsOnlyOrigin', async () => {
    // Arrange
    const sensitiveValue = 'secret-token-2342';
    registerGreet(() => ({ message: 'unreachable' }));

    // Act
    const error: unknown = await ipcMain
      .invoke(
        'greeting:greet',
        { name: 'Argus' },
        `${FOREIGN_SENDER_URL}page?token=${sensitiveValue}#${sensitiveValue}`,
      )
      .catch((rejection: unknown) => rejection);

    // Assert
    expect(logWarn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ senderOrigin: FOREIGN_SENDER_ORIGIN }),
    );
    expect(JSON.stringify(logWarn.mock.calls)).not.toContain(sensitiveValue);
    expect(String(error)).not.toContain(sensitiveValue);
    expect(JSON.stringify(error)).not.toContain(sensitiveValue);
  });

  describe('with a built renderer loaded from file', () => {
    const builtRendererUrl = new URL('file:///D:/Argus/out/renderer/index.html');

    const greetByName: IpcHandlers<typeof testContract>['greeting']['greet'] = ({ name }) => ({
      message: `Hallo ${name}`,
    });

    it('registerIpcHandlers_WithBuiltRendererAsSender_ReturnsHandlerResponse', async () => {
      // Arrange
      registerGreet(greetByName, builtRendererUrl);

      // Act
      const response = await ipcMain.invoke(
        'greeting:greet',
        { name: 'Argus' },
        builtRendererUrl.href,
      );

      // Assert
      expect(response).toEqual({ message: 'Hallo Argus' });
    });

    it('registerIpcHandlers_WithDriveLetterInDifferentCase_ReturnsHandlerResponse', async () => {
      // Arrange
      // Chromium reports the drive letter in upper case, while pathToFileURL keeps the case
      // of the path it gets, e.g. when the app was started from a "d:\..." directory.
      registerGreet(greetByName, new URL('file:///d:/Argus/out/renderer/index.html'));

      // Act
      const response = await ipcMain.invoke(
        'greeting:greet',
        { name: 'Argus' },
        builtRendererUrl.href,
      );

      // Assert
      expect(response).toEqual({ message: 'Hallo Argus' });
    });

    it('registerIpcHandlers_WithUmlautInDifferentCase_ReturnsHandlerResponse', async () => {
      // Arrange
      // Percent-encoded umlauts differ by case ("%C3%84" = Ä, "%C3%A4" = ä), which lower-casing
      // the URL does not fold; Windows still treats both paths as the same file.
      registerGreet(greetByName, new URL('file:///D:/%C3%84pps/out/renderer/index.html'));

      // Act
      const response = await ipcMain.invoke(
        'greeting:greet',
        { name: 'Argus' },
        'file:///D:/%C3%A4pps/out/renderer/index.html',
      );

      // Assert
      expect(response).toEqual({ message: 'Hallo Argus' });
    });

    it('registerIpcHandlers_WithSameUncPathOnOtherServer_Rejects', async () => {
      // Arrange
      registerGreet(greetByName, new URL('file://fileserver/apps/argus/out/renderer/index.html'));

      // Act
      const invocation = ipcMain.invoke(
        'greeting:greet',
        { name: 'Argus' },
        'file://evil-server/apps/argus/out/renderer/index.html',
      );

      // Assert
      await expect(invocation).rejects.toBeInstanceOf(UntrustedIpcSenderError);
    });

    it('registerIpcHandlers_WithOtherLocalFileAsSender_Rejects', async () => {
      // Arrange
      registerGreet(greetByName, builtRendererUrl);

      // Act
      const invocation = ipcMain.invoke(
        'greeting:greet',
        { name: 'Argus' },
        'file:///C:/Users/Public/Downloads/evil.html',
      );

      // Assert
      await expect(invocation).rejects.toBeInstanceOf(UntrustedIpcSenderError);
    });

    it('registerIpcHandlers_WithOtherLocalFileAsSender_LogsFilePathWithoutQueryOrHash', async () => {
      // Arrange
      registerGreet(greetByName, builtRendererUrl);

      // Act
      await ipcMain
        .invoke('greeting:greet', { name: 'Argus' }, 'file:///C:/Temp/evil.html?token=1#secret')
        .catch(() => undefined);

      // Assert
      expect(logWarn).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ senderOrigin: 'file:///C:/Temp/evil.html' }),
      );
    });
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
        allowedRendererUrl: ALLOWED_RENDERER_URL,
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
        allowedRendererUrl: ALLOWED_RENDERER_URL,
      });
    } catch {
      // Expected: MissingIpcHandlerError, covered by the previous test.
    }

    // Assert
    expect(ipcMain.registeredChannels).toEqual([]);
  });
});
