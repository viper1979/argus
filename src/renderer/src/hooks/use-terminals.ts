import { useCallback } from 'react';
import type { OpenTerminalResult } from '@shared/domain/terminal';
import { taskViewStore, useTaskView, type TerminalTab } from '@renderer/stores/task-view-store';
import { discardTerminal } from '@renderer/terminals/terminal-events';
import { createTerminalView } from '@renderer/terminals/terminal-views';

/** Why a terminal could not be opened, as the task view shows it. */
export type OpenTerminalFailureReason = Extract<OpenTerminalResult, { ok: false }>['reason'];

/** Terminals of one task plus the actions the task view offers on them. */
export interface TerminalsState {
  /** Open terminals of the task, in tab order. */
  readonly tabs: readonly TerminalTab[];
  /** Visible terminal, or `undefined` if the task has none. */
  readonly activeTerminalId: string | undefined;
  /**
   * Starts a new PowerShell in the worktree and shows it.
   * @returns `null` on success, otherwise why it could not be opened.
   */
  readonly openTerminal: () => Promise<OpenTerminalFailureReason | null>;
  /**
   * Ends the process of a terminal and removes its tab.
   * @param terminalId The terminal to close.
   */
  readonly closeTerminal: (terminalId: string) => Promise<void>;
  /**
   * Shows another terminal of the task.
   * @param terminalId The terminal to show.
   */
  readonly activateTerminal: (terminalId: string) => void;
}

/**
 * Size the PTY starts with. The real size is only known once xterm.js is on the page; it is
 * sent right after the first display.
 */
const INITIAL_TERMINAL_SIZE = { cols: 120, rows: 30 };

/** Stable empty list, so the store selector does not create a new array on every render. */
const NO_TABS: readonly TerminalTab[] = [];

/**
 * Gives a task view access to the terminals of its task.
 * @param taskId The task.
 * @returns Tabs and actions.
 */
export function useTerminals(taskId: string): TerminalsState {
  const tabs = useTaskView((state) => state.terminalsByTask[taskId]) ?? NO_TABS;
  const activeTerminalId = useTaskView((state) => state.activeTerminalByTask[taskId]);

  const openTerminal = useCallback(async (): Promise<OpenTerminalFailureReason | null> => {
    const result = await window.argus.terminal.open({ taskId, ...INITIAL_TERMINAL_SIZE });
    if (!result.ok) {
      return result.reason;
    }
    // A shell that already exited before this reply arrived gets no (dead) tab.
    if (createTerminalView(result.terminalId)) {
      taskViewStore.getState().addTerminal(taskId, result.terminalId);
    }
    return null;
  }, [taskId]);

  const closeTerminal = useCallback(async (terminalId: string): Promise<void> => {
    await window.argus.terminal.close({ terminalId });
    // The exit event usually did this already; repeating it covers a process that never
    // reported its end (main gives up waiting after a timeout).
    discardTerminal(terminalId);
  }, []);

  const activateTerminal = useCallback(
    (terminalId: string): void => {
      taskViewStore.getState().activateTerminal(taskId, terminalId);
    },
    [taskId],
  );

  return { tabs, activeTerminalId, openTerminal, closeTerminal, activateTerminal };
}
