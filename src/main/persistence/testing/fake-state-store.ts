import { createEmptyAppState, type AppState } from '../app-state';
import type { StateStore } from '../state-store';

/** In-memory stand-in for `state.json` for service tests; remembers what was saved last. */
export class FakeStateStore implements StateStore {
  savedState: AppState | null = null;
  /** Error thrown by the next save, e.g. a locked file; cleared after it was thrown once. */
  nextSaveError: Error | null = null;

  /**
   * @param initialState What `state.json` contains before the test; empty like a fresh install.
   */
  constructor(private readonly initialState: AppState = createEmptyAppState()) {}

  /** Returns the last saved state, or the initial one. */
  load(): Promise<AppState> {
    return Promise.resolve(this.savedState ?? this.initialState);
  }

  /** Remembers the state instead of writing a file, or fails once if {@link nextSaveError} is set. */
  save(state: AppState): Promise<void> {
    const error = this.nextSaveError;
    this.nextSaveError = null;
    if (error) {
      return Promise.reject(error);
    }
    this.savedState = state;
    return Promise.resolve();
  }
}
