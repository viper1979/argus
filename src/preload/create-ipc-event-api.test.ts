import { testContract, testEventContract } from '@shared/ipc/testing/test-contract';
import { describe, expect, it, vi } from 'vitest';
import { createIpcClientApi } from './create-ipc-client-api';
import { createIpcEventApi, mergeIpcApis, type IpcSubscribe } from './create-ipc-event-api';

/** Fake of `ipcRenderer.on/removeListener`: remembers listeners per channel and can emit. */
class FakeIpcRendererEvents {
  private readonly listeners = new Map<string, Set<(payload: unknown) => void>>();

  /** The subscribe function to inject. */
  readonly subscribe: IpcSubscribe = (channel, listener) => {
    const channelListeners = this.listeners.get(channel) ?? new Set();
    channelListeners.add(listener);
    this.listeners.set(channel, channelListeners);
    return () => {
      channelListeners.delete(listener);
    };
  };

  /**
   * Simulates a message from the main process.
   * @param channel Channel the main process sends on.
   * @param payload The message.
   */
  emit(channel: string, payload: unknown): void {
    for (const listener of this.listeners.get(channel) ?? []) {
      listener(payload);
    }
  }
}

describe('createIpcEventApi', () => {
  it('createIpcEventApi_WhenSubscribed_ReceivesPayloadsOfDerivedChannel', () => {
    // Arrange
    const ipcEvents = new FakeIpcRendererEvents();
    const api = createIpcEventApi(testEventContract, ipcEvents.subscribe);
    const listener = vi.fn();

    // Act
    api.greeting.onGreeted(listener);
    ipcEvents.emit('greeting:greeted', { name: 'Argus' });

    // Assert
    expect(listener).toHaveBeenCalledExactlyOnceWith({ name: 'Argus' });
  });

  it('createIpcEventApi_AfterUnsubscribe_OnlyOtherListenersStillReceive', () => {
    // Arrange
    const ipcEvents = new FakeIpcRendererEvents();
    const api = createIpcEventApi(testEventContract, ipcEvents.subscribe);
    const unsubscribedListener = vi.fn();
    const remainingListener = vi.fn();
    const unsubscribe = api.greeting.onGreeted(unsubscribedListener);
    api.greeting.onGreeted(remainingListener);

    // Act
    unsubscribe();
    ipcEvents.emit('greeting:greeted', { name: 'Argus' });

    // Assert
    expect(unsubscribedListener).not.toHaveBeenCalled();
    expect(remainingListener).toHaveBeenCalledOnce();
  });
});

describe('mergeIpcApis', () => {
  it('mergeIpcApis_WithSharedDomain_OffersInvokeAndSubscribeMethodsSideBySide', async () => {
    // Arrange
    const invoke = vi.fn(() => Promise.resolve({ message: 'Hallo' }));
    const ipcEvents = new FakeIpcRendererEvents();
    const clientApi = createIpcClientApi(testContract, invoke);
    const eventApi = createIpcEventApi(testEventContract, ipcEvents.subscribe);
    const listener = vi.fn();

    // Act
    const api = mergeIpcApis(clientApi, eventApi);
    await api.greeting.greet({ name: 'Argus' });
    api.greeting.onGreeted(listener);
    ipcEvents.emit('greeting:greeted', { name: 'Argus' });

    // Assert
    expect(invoke).toHaveBeenCalledWith('greeting:greet', { name: 'Argus' });
    expect(listener).toHaveBeenCalledOnce();
  });
});
