import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyAppState, type AppState } from './app-state';
import { createAppStateHolder, type AppStateHolder } from './app-state-holder';
import type { StateStore } from './state-store';

/** Store fake that records every load and save and can be told to fail. */
class RecordingStateStore implements StateStore {
  loadCount = 0;
  readonly savedStates: AppState[] = [];
  /** Error thrown by the next load; cleared after it was thrown once. */
  nextLoadError: Error | null = null;
  /** Error thrown by the next save; cleared after it was thrown once. */
  nextSaveError: Error | null = null;

  /** Counts the load and fails once if {@link nextLoadError} is set. */
  load(): Promise<AppState> {
    this.loadCount++;
    const error = this.nextLoadError;
    this.nextLoadError = null;
    return error ? Promise.reject(error) : Promise.resolve(createEmptyAppState());
  }

  /** Records the state and fails once if {@link nextSaveError} is set. */
  save(state: AppState): Promise<void> {
    const error = this.nextSaveError;
    this.nextSaveError = null;
    if (error) {
      return Promise.reject(error);
    }
    this.savedStates.push(state);
    return Promise.resolve();
  }
}

/**
 * Change that sets the worktree root, as the settings dialog does.
 * @param worktreeRoot The new worktree root.
 * @returns A pure state change.
 */
function setWorktreeRoot(worktreeRoot: string): (state: AppState) => AppState {
  return (state) => ({ ...state, settings: { worktreeRoot } });
}

describe('createAppStateHolder', () => {
  let store: RecordingStateStore;
  let holder: AppStateHolder;

  beforeEach(() => {
    store = new RecordingStateStore();
    holder = createAppStateHolder(store);
  });

  it('update_WithConcurrentUpdates_AppliesThemOneAfterAnother', async () => {
    // Arrange
    // Both changes read the state; without a queue the second would overwrite the first.
    const appendA = (state: AppState): AppState => ({
      ...state,
      settings: { worktreeRoot: `${state.settings.worktreeRoot ?? ''}A` },
    });
    const appendB = (state: AppState): AppState => ({
      ...state,
      settings: { worktreeRoot: `${state.settings.worktreeRoot ?? ''}B` },
    });

    // Act
    await Promise.all([holder.update(appendA), holder.update(appendB)]);

    // Assert
    expect((await holder.read()).settings.worktreeRoot).toBe('AB');
    expect(store.loadCount).toBe(1);
  });

  it('update_WhenChangeReturnsSameState_DoesNotSave', async () => {
    // Arrange
    // Nothing to arrange: the change below decides to do nothing.

    // Act
    await holder.update((state) => state);

    // Assert
    expect(store.savedStates).toEqual([]);
  });

  it('update_AfterFailedSave_RejectsAndStillAppliesNextUpdate', async () => {
    // Arrange
    store.nextSaveError = new Error('EPERM: operation not permitted');

    // Act
    const failedUpdate = holder.update(setWorktreeRoot('D:\\Failed'));
    const nextUpdate = holder.update(setWorktreeRoot('D:\\Worktrees'));

    // Assert
    await expect(failedUpdate).rejects.toThrow('EPERM');
    await expect(nextUpdate).resolves.toMatchObject({
      settings: { worktreeRoot: 'D:\\Worktrees' },
    });
    expect(store.savedStates).toHaveLength(1);
  });

  it('read_AfterFailedLoad_LoadsAgain', async () => {
    // Arrange
    // E.g. the file was locked by a virus scanner during the first read.
    store.nextLoadError = new Error('EBUSY: resource busy or locked');
    await holder.read().catch(() => undefined);

    // Act
    const state = await holder.read();

    // Assert
    expect(state).toEqual(createEmptyAppState());
    expect(store.loadCount).toBe(2);
  });
});
