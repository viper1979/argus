import type { AppState } from './app-state';
import type { StateStore } from './state-store';

/** Single owner of the in-memory state; every change is persisted before it is visible. */
export interface AppStateHolder {
  /**
   * Returns the current state, loading it from disk on first access.
   * @returns The current state.
   */
  read(): Promise<AppState>;

  /**
   * Applies a change and persists the result. Changes run one after another, so two
   * concurrent IPC calls can never overwrite each other's result.
   * @param change Pure function from the current to the new state.
   * @returns The new state.
   */
  update(change: (state: AppState) => AppState): Promise<AppState>;
}

/**
 * Creates the holder on top of a store.
 * @param store Reads and writes `state.json`.
 * @returns The holder.
 */
export function createAppStateHolder(store: StateStore): AppStateHolder {
  let currentState: Promise<AppState> | null = null;
  // Tail of the queue of pending updates; each update waits for the previous one.
  let pendingUpdates: Promise<unknown> = Promise.resolve();

  const read = (): Promise<AppState> => {
    if (currentState === null) {
      const loading = store.load();
      currentState = loading;
      // Forget a failed load (e.g. a file briefly locked by a virus scanner), so the next
      // call tries again instead of failing until Argus is restarted.
      loading.catch(() => {
        if (currentState === loading) {
          currentState = null;
        }
      });
    }
    return currentState;
  };

  return {
    read,
    update: (change) => {
      const updated = pendingUpdates.then(async () => {
        const previousState = await read();
        const nextState = change(previousState);
        if (nextState === previousState) {
          // The change decided to do nothing; skip the disk write.
          return nextState;
        }
        await store.save(nextState);
        currentState = Promise.resolve(nextState);
        return nextState;
      });
      // A failed update must not block the following ones; the caller still sees the error.
      pendingUpdates = updated.catch(() => undefined);
      return updated;
    },
  };
}
