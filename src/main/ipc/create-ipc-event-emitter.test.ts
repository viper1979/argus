import { testEventContract } from '@shared/ipc/testing/test-contract';
import { describe, expect, it, vi, type Mock } from 'vitest';
import { createIpcEventEmitter, type IpcEventTargetLike } from './create-ipc-event-emitter';

/** A fake of the main window's `webContents` together with the spy on its `send`. */
interface FakeTarget {
  readonly target: IpcEventTargetLike;
  readonly send: Mock<IpcEventTargetLike['send']>;
}

/**
 * Creates a fake of the main window's `webContents`.
 * @param isDestroyed Whether the window has already been closed.
 * @returns The fake and the spy on `send`.
 */
function fakeTarget(isDestroyed: boolean): FakeTarget {
  const send = vi.fn<IpcEventTargetLike['send']>();
  return { target: { isDestroyed: () => isDestroyed, send }, send };
}

describe('createIpcEventEmitter', () => {
  it('createIpcEventEmitter_WhenEventIsEmitted_SendsPayloadOnDerivedChannel', () => {
    // Arrange
    const { target, send } = fakeTarget(false);
    const emitter = createIpcEventEmitter(testEventContract, () => target);

    // Act
    emitter.greeting.greeted({ name: 'Argus' });

    // Assert
    expect(send).toHaveBeenCalledExactlyOnceWith('greeting:greeted', { name: 'Argus' });
  });

  it('createIpcEventEmitter_WithoutWindow_DropsEventWithoutThrowing', () => {
    // Arrange
    const emitter = createIpcEventEmitter(testEventContract, () => null);

    // Act
    const emit = (): void => {
      emitter.greeting.greeted({ name: 'Argus' });
    };

    // Assert
    expect(emit).not.toThrow();
  });

  it('createIpcEventEmitter_WithDestroyedWindow_DoesNotSend', () => {
    // Arrange: e.g. terminal output arriving while the window is closing
    const { target, send } = fakeTarget(true);
    const emitter = createIpcEventEmitter(testEventContract, () => target);

    // Act
    emitter.greeting.greeted({ name: 'Argus' });

    // Assert
    expect(send).not.toHaveBeenCalled();
  });
});
