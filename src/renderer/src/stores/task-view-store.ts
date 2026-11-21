import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { StartAgentSessionResult, TaskAgentSessionStatus } from '@shared/domain/agent-session';

/**
 * What a terminal tab shows (glossary: Terminal-Tab): a plain terminal, or the agent session of
 * the task, which is always the first tab and cannot be closed (concept 5.3, step 5).
 */
export type TerminalTabKind = 'terminal' | 'agent-session';

/** A terminal tab of a task as the tab bar shows it. */
export interface TerminalTab {
  readonly terminalId: string;
  /**
   * Terminal tabs: "Terminal 1", "Terminal 2", … in the order they were opened. Agent session tab:
   * name of the agent type, e.g. "Claude Code".
   */
  readonly title: string;
  readonly kind: TerminalTabKind;
}

/**
 * Why the agent session of a task could not be started: a reason from the main process, or
 * `unexpected` if the call itself failed (details are in the log).
 */
export type AgentSessionStartFailure =
  Extract<StartAgentSessionResult, { ok: false }>['reason'] | 'unexpected';

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
  /** Why the agent session of a task could not be started; shown in its task view. */
  readonly agentSessionFailureByTask: Readonly<Record<string, AgentSessionStartFailure>>;
  /** Latest status of the agent session per task id; missing until its first status. */
  readonly agentSessionStatusByTask: Readonly<Record<string, TaskAgentSessionStatus>>;

  /**
   * Shows a task in the main area. Terminals of the previous task keep running.
   * @param taskId The task to show.
   */
  readonly selectTask: (taskId: string) => void;

  /**
   * Opens a task from the sidebar. If its agent session waits for the user, its tab is shown
   * right away, since that is where permissions and questions are answered (concept 5.4).
   * @param taskId The task to show.
   */
  readonly openTask: (taskId: string) => void;

  /**
   * Takes over a status the main process reported; it replaces the earlier one of the task.
   * @param status Status of an agent session and its task.
   */
  readonly applyAgentSessionStatus: (status: TaskAgentSessionStatus) => void;

  /**
   * Takes over the statuses listed at (re)load. Tasks that already got a status keep it: a
   * `statusChanged` event may overtake the slower list and is the newer one.
   * @param statuses Current status of every agent session.
   */
  readonly loadAgentSessionStatuses: (statuses: readonly TaskAgentSessionStatus[]) => void;

  /**
   * Adds the tab of a freshly opened terminal and shows it.
   * @param taskId The task the terminal belongs to.
   * @param terminalId Id the main process returned for the terminal.
   */
  readonly addTerminal: (taskId: string, terminalId: string) => void;

  /**
   * Adds the tab of a freshly started agent session as first tab and shows it. It takes no tab
   * number, so the next terminal tab is still "Terminal 1". Clears a previous start failure.
   * @param taskId The task the agent session belongs to.
   * @param terminalId Id of the terminal the agent session runs in.
   * @param title Name of the agent type, e.g. "Claude Code".
   */
  readonly addAgentSessionTerminal: (taskId: string, terminalId: string, title: string) => void;

  /**
   * Remembers why the agent session of a task could not be started.
   * @param taskId The task.
   * @param failure The reason.
   */
  readonly reportAgentSessionFailure: (taskId: string, failure: AgentSessionStartFailure) => void;

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
    agentSessionFailureByTask: {},
    agentSessionStatusByTask: {},

    selectTask: (taskId) => {
      set({ selectedTaskId: taskId });
    },

    openTask: (taskId) => {
      set((state) => {
        const agentSessionTab = state.terminalsByTask[taskId]?.find(
          (tab) => tab.kind === 'agent-session',
        );
        const isWaiting = state.agentSessionStatusByTask[taskId]?.status === 'waiting';
        if (!isWaiting || !agentSessionTab) {
          return { selectedTaskId: taskId };
        }
        return {
          selectedTaskId: taskId,
          activeTerminalByTask: {
            ...state.activeTerminalByTask,
            [taskId]: agentSessionTab.terminalId,
          },
        };
      });
    },

    applyAgentSessionStatus: (status) => {
      set((state) => ({
        agentSessionStatusByTask: { ...state.agentSessionStatusByTask, [status.taskId]: status },
      }));
    },

    loadAgentSessionStatuses: (statuses) => {
      set((state) => {
        const listedByTask = Object.fromEntries(statuses.map((status) => [status.taskId, status]));
        // Spread last, so statuses from events win over the listed ones.
        return {
          agentSessionStatusByTask: { ...listedByTask, ...state.agentSessionStatusByTask },
        };
      });
    },

    addTerminal: (taskId, terminalId) => {
      set((state) => {
        const tabNumber = (state.lastTabNumberByTask[taskId] ?? 0) + 1;
        const tab: TerminalTab = {
          terminalId,
          title: `${TERMINAL_TAB_TITLE_PREFIX} ${tabNumber}`,
          kind: 'terminal',
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

    addAgentSessionTerminal: (taskId, terminalId, title) => {
      set((state) => {
        const tab: TerminalTab = { terminalId, title, kind: 'agent-session' };
        const agentSessionFailureByTask = { ...state.agentSessionFailureByTask };
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- keyed by task id
        delete agentSessionFailureByTask[taskId];
        return {
          terminalsByTask: {
            ...state.terminalsByTask,
            // The agent session is always tab 1, even if terminal tabs were opened before it.
            [taskId]: [tab, ...(state.terminalsByTask[taskId] ?? [])],
          },
          activeTerminalByTask: { ...state.activeTerminalByTask, [taskId]: terminalId },
          agentSessionFailureByTask,
        };
      });
    },

    reportAgentSessionFailure: (taskId, failure) => {
      set((state) => ({
        agentSessionFailureByTask: { ...state.agentSessionFailureByTask, [taskId]: failure },
      }));
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
