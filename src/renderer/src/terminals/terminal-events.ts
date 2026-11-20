import { taskViewStore } from '@renderer/stores/task-view-store';
import { deliverTerminalOutput, disposeTerminalView } from './terminal-views';

/**
 * Removes every trace of a terminal from the renderer: its xterm.js instance and its
 * Terminal-Tab. Used when the shell ended and when the tab was closed; safe to call twice.
 * @param terminalId The terminal.
 */
export function discardTerminal(terminalId: string): void {
  disposeTerminalView(terminalId);
  taskViewStore.getState().removeTerminal(terminalId);
}

/**
 * Subscribes once to terminal output and exits from the main process. Call before anything
 * renders, so no output can arrive unheard.
 */
export function startTerminalEventListening(): void {
  window.argus.terminal.onOutput(({ terminalId, data }) => {
    deliverTerminalOutput(terminalId, data);
  });
  window.argus.terminal.onExit(({ terminalId }) => {
    // A terminal whose shell ended (e.g. after `exit`) loses its tab, like closing it.
    discardTerminal(terminalId);
  });
}
