import type { Logger } from '../logging/logger';
import type { TerminalService } from './terminal-service';

/** The part of Electron's `before-quit` event this module needs. */
export interface BeforeQuitEventLike {
  /** Cancels this quit attempt. */
  preventDefault(): void;
}

/** The part of Electron's `app` this module needs; allows a fake in tests. */
export interface QuitControlLike {
  /**
   * Registers a listener that runs before the app quits and may cancel the quit.
   * @param listener Receives the cancellable event.
   */
  onBeforeQuit(listener: (event: BeforeQuitEventLike) => void): void;

  /** Starts quitting the app; fires `before-quit` again. */
  quit(): void;
}

/**
 * Holds back quitting until every terminal has ended, so no `pwsh` outlives Argus and no file
 * in a worktree stays locked (ADR 0004, concept 5.6). The first `before-quit` is cancelled,
 * the terminals are closed, then the quit is repeated and passes through.
 * Limit: `before-quit` does not fire on a crash or `app.exit()` (ADR 0007).
 * @param quitControl Electron's quit flow.
 * @param terminalService Owns all PTYs.
 * @param logger Receives a failure to close the terminals; quitting continues anyway.
 */
export function closeTerminalsBeforeQuit(
  quitControl: QuitControlLike,
  terminalService: Pick<TerminalService, 'closeAll'>,
  logger: Logger,
): void {
  let areTerminalsClosed = false;
  let isClosingTerminals = false;

  quitControl.onBeforeQuit((event) => {
    if (areTerminalsClosed) {
      return;
    }
    event.preventDefault();
    if (isClosingTerminals) {
      return;
    }
    isClosingTerminals = true;
    void terminalService
      .closeAll()
      .catch((error: unknown) => {
        // Quitting must not be blocked by a failing PTY; log it and quit anyway.
        logger.error('Closing terminals before quit failed', { error });
      })
      .finally(() => {
        areTerminalsClosed = true;
        quitControl.quit();
      });
  });
}
