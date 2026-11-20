import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { Logger } from '../logging/logger';
import {
  closeTerminalsBeforeQuit,
  type BeforeQuitEventLike,
  type QuitControlLike,
} from './close-terminals-before-quit';
import { createFakeLogger } from '../logging/testing/fake-logger';

/** Fake of Electron's `app` quit flow: lets the test fire `before-quit` and see `quit()`. */
class FakeQuitControl implements QuitControlLike {
  quitCount = 0;
  private readonly listeners: ((event: BeforeQuitEventLike) => void)[] = [];

  /** @inheritdoc */
  onBeforeQuit(listener: (event: BeforeQuitEventLike) => void): void {
    this.listeners.push(listener);
  }

  /** @inheritdoc */
  quit(): void {
    this.quitCount += 1;
  }

  /**
   * Fires `before-quit` like Electron does when the app is about to quit.
   * @returns Whether a listener cancelled the quit.
   */
  fireBeforeQuit(): boolean {
    let isPrevented = false;
    const event: BeforeQuitEventLike = {
      preventDefault: () => {
        isPrevented = true;
      },
    };
    for (const listener of this.listeners) {
      listener(event);
    }
    return isPrevented;
  }
}

/** A promise the test resolves or rejects by hand. */
interface Deferred {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
  readonly reject: (error: Error) => void;
}

/**
 * Creates a {@link Deferred}.
 * @returns The promise with its resolve and reject functions.
 */
function createDeferred(): Deferred {
  let resolve: () => void = () => undefined;
  let reject: (error: Error) => void = () => undefined;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('closeTerminalsBeforeQuit', () => {
  let quitControl: FakeQuitControl;
  let closing: Deferred;
  let closeAll: Mock<() => Promise<void>>;
  let logError: Mock<Logger['error']>;

  beforeEach(() => {
    quitControl = new FakeQuitControl();
    closing = createDeferred();
    closeAll = vi.fn(() => closing.promise);
    logError = vi.fn();
    closeTerminalsBeforeQuit(quitControl, { closeAll }, createFakeLogger({ error: logError }));
  });

  it('closeTerminalsBeforeQuit_OnFirstBeforeQuit_IsCancelledAndQuitsAgainOnlyAfterAllTerminalsEnded', async () => {
    // Act
    const isPrevented = quitControl.fireBeforeQuit();
    await Promise.resolve();
    const quitCountWhileClosing = quitControl.quitCount;
    closing.resolve();
    await vi.waitFor(() => {
      expect(quitControl.quitCount).toBe(1);
    });

    // Assert
    expect(isPrevented).toBe(true);
    expect(closeAll).toHaveBeenCalledOnce();
    expect(quitCountWhileClosing).toBe(0);
  });

  it('closeTerminalsBeforeQuit_OnBeforeQuitAfterTerminalsEnded_PassesThrough', async () => {
    // Arrange
    quitControl.fireBeforeQuit();
    closing.resolve();
    await vi.waitFor(() => {
      expect(quitControl.quitCount).toBe(1);
    });

    // Act: the repeated quit fires before-quit again
    const isPrevented = quitControl.fireBeforeQuit();

    // Assert
    expect(isPrevented).toBe(false);
    expect(closeAll).toHaveBeenCalledOnce();
  });

  it('closeTerminalsBeforeQuit_OnBeforeQuitWhileTerminalsAreClosing_IsCancelledWithoutClosingTwice', () => {
    // Arrange
    quitControl.fireBeforeQuit();

    // Act: e.g. the user closes the window a second time
    const isPrevented = quitControl.fireBeforeQuit();

    // Assert
    expect(isPrevented).toBe(true);
    expect(closeAll).toHaveBeenCalledOnce();
  });

  it('closeTerminalsBeforeQuit_WhenClosingTerminalsFails_LogsErrorAndQuitsAnyway', async () => {
    // Arrange
    quitControl.fireBeforeQuit();

    // Act
    closing.reject(new Error('pty broken'));
    await vi.waitFor(() => {
      expect(quitControl.quitCount).toBe(1);
    });

    // Assert
    expect(logError).toHaveBeenCalledWith(
      expect.stringContaining('before quit') as string,
      expect.objectContaining({ error: expect.any(Error) as Error }),
    );
  });
});
