import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';

/** A terminal tab of a task as the tab bar shows it. */
export interface TerminalTab {
  readonly terminalId: string;
  /** "Terminal 1", "Terminal 2", … in the order the tabs were opened. */
  readonly title: string;
}

/** UI state of the task view: which task is shown and which terminal tabs it has. */
export interface TaskViewState {
  /** Task shown in the main area; `null` shows "Kein Task ausgewählt". */
  readonly selectedTaskId: string | null;
  /** Open terminal tabs per task id, in tab order. */
  readonly terminalsByTask: Readonly<Record<string, readonly TerminalTab[]>>;
  /** Visible terminal per task id. */
  readonly activeTerminalByTask: Readonly<Record<string, string>>;
  /** Highest tab number handed out per task id; numbers are never reused. */
  readonly lastTabNumberByTask: Readonly<Record<string, number>>;

  /**
   * Shows a task in the main area. Terminals of the previous task keep running.
   * @param taskId The task to show.
   */
  readonly selectTask: (taskId: string) => void;

  /**
   * Adds the tab of a freshly opened terminal and shows it.
   * @param taskId The task the terminal belongs to.
   * @param terminalId Id the main process returned for the terminal.
   */
  readonly addTerminal: (taskId: string, terminalId: string) => void;

  /**
   * Shows a terminal tab of a task.
   * @param taskId The task.
   * @param terminalId One of its terminals.
   */
  readonly activateTerminal: (taskId: string, terminalId: string) => void;

  /**
   * Removes the tab of a terminal that was closed or whose process ended. If it was the visible
   * one, its neighbour becomes visible.
   * @param terminalId The terminal; unknown ids are ignored.
   */
  readonly removeTerminal: (terminalId: string) => void;
}

/** The store as used by components and tests. */
export type TaskViewStore = StoreApi<TaskViewState>;

/** German label of a terminal tab (UI texts are German). */
const TERMINAL_TAB_TITLE_PREFIX = 'Terminal';

/**
 * Creates an empty task view store; components use the app-wide instance, tests a fresh one.
 * @returns The store.
 */
export function createTaskViewStore(): TaskViewStore {
  return createStore<TaskViewState>()((set) => ({
    selectedTaskId: null,
    terminalsByTask: {},
    activeTerminalByTask: {},
    lastTabNumberByTask: {},

    selectTask: (taskId) => {
      set({ selectedTaskId: taskId });
    },

    addTerminal: (taskId, terminalId) => {
      set((state) => {
        const tabNumber = (state.lastTabNumberByTask[taskId] ?? 0) + 1;
        const tab: TerminalTab = {
          terminalId,
          title: `${TERMINAL_TAB_TITLE_PREFIX} ${tabNumber}`,
        };
        return {
          terminalsByTask: {
            ...state.terminalsByTask,
            [taskId]: [...(state.terminalsByTask[taskId] ?? []), tab],
          },
          activeTerminalByTask: { ...state.activeTerminalByTask, [taskId]: terminalId },
          lastTabNumberByTask: { ...state.lastTabNumberByTask, [taskId]: tabNumber },
        };
      });
    },

    activateTerminal: (taskId, terminalId) => {
      set((state) => ({
        activeTerminalByTask: { ...state.activeTerminalByTask, [taskId]: terminalId },
      }));
    },

    removeTerminal: (terminalId) => {
      set((state) => {
        const owner = findTabOwner(state.terminalsByTask, terminalId);
        if (!owner) {
          return state;
        }
        const { taskId, tabs, tabIndex } = owner;
        const remainingTabs = tabs.filter((tab) => tab.terminalId !== terminalId);
        const activeTerminalByTask = { ...state.activeTerminalByTask };
        if (activeTerminalByTask[taskId] === terminalId) {
          // Same as browser tabs: the tab to the right moves into place; at the end, the left one.
          const neighbour = remainingTabs[tabIndex] ?? remainingTabs[tabIndex - 1];
          if (neighbour) {
            activeTerminalByTask[taskId] = neighbour.terminalId;
          } else {
            // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- keyed by task id
            delete activeTerminalByTask[taskId];
          }
        }
        return {
          terminalsByTask: { ...state.terminalsByTask, [taskId]: remainingTabs },
          activeTerminalByTask,
        };
      });
    },
  }));
}

/** Where a terminal tab lives. */
interface TabOwner {
  readonly taskId: string;
  readonly tabs: readonly TerminalTab[];
  readonly tabIndex: number;
}

/**
 * Finds the task a terminal tab belongs to.
 * @param terminalsByTask Tabs per task.
 * @param terminalId The terminal.
 * @returns Task, its tabs and the position of the tab, or `null` if no task has it.
 */
function findTabOwner(
  terminalsByTask: TaskViewState['terminalsByTask'],
  terminalId: string,
): TabOwner | null {
  for (const [taskId, tabs] of Object.entries(terminalsByTask)) {
    const tabIndex = tabs.findIndex((tab) => tab.terminalId === terminalId);
    if (tabIndex !== -1) {
      return { taskId, tabs, tabIndex };
    }
  }
  return null;
}

/** The app-wide task view store. */
export const taskViewStore = createTaskViewStore();

/**
 * Reads a slice of the app-wide task view store and re-renders when it changes.
 * @param selector Picks the slice; must return a stable value (no new arrays or objects).
 * @returns The selected slice.
 */
export function useTaskView<TSlice>(selector: (state: TaskViewState) => TSlice): TSlice {
  return useStore(taskViewStore, selector);
}
