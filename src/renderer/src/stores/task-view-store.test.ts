import type { TaskAgentSessionStatus } from '@shared/domain/agent-session';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTaskViewStore, type TaskViewStore } from './task-view-store';

/** Ids only need to be distinct; real ones are UUIDs. */
const LOGIN_TASK_ID = 'task-login';
const EXPORT_TASK_ID = 'task-export';
const FIRST_TERMINAL_ID = 'terminal-1';
const SECOND_TERMINAL_ID = 'terminal-2';
const THIRD_TERMINAL_ID = 'terminal-3';
const FOURTH_TERMINAL_ID = 'terminal-4';
/** Title the renderer passes for a Claude Code agent session. */
const AGENT_TAB_TITLE = 'Claude Code';
const LOGIN_AGENT_SESSION_ID = 'agent-session-login';
const EXPORT_AGENT_SESSION_ID = 'agent-session-export';

/**
 * Builds a status the main process reports for the login task.
 * @param status The status.
 * @param subagentCount Running subagents.
 * @returns The status with agent session and task.
 */
function loginStatus(
  status: TaskAgentSessionStatus['status'],
  subagentCount = 0,
): TaskAgentSessionStatus {
  return { agentSessionId: LOGIN_AGENT_SESSION_ID, taskId: LOGIN_TASK_ID, status, subagentCount };
}

/** Status of the export task's agent session. */
const EXPORT_WORKING: TaskAgentSessionStatus = {
  agentSessionId: EXPORT_AGENT_SESSION_ID,
  taskId: EXPORT_TASK_ID,
  status: 'working',
  subagentCount: 0,
};

describe('TaskViewStore', () => {
  let store: TaskViewStore;

  beforeEach(() => {
    store = createTaskViewStore();
  });

  it('addTerminal_FirstOfTask_IsNamedTerminal1AndBecomesActive', () => {
    // Act
    store.getState().addTerminal(LOGIN_TASK_ID, FIRST_TERMINAL_ID);

    // Assert
    const state = store.getState();
    expect(state.terminalsByTask[LOGIN_TASK_ID]).toEqual([
      { terminalId: FIRST_TERMINAL_ID, title: 'Terminal 1', kind: 'terminal' },
    ]);
    expect(state.activeTerminalByTask[LOGIN_TASK_ID]).toBe(FIRST_TERMINAL_ID);
  });

  it('addAgentSessionTerminal_WithTerminalTabsOpen_InsertsAsFirstTabAndBecomesActive', () => {
    // Arrange
    const { addTerminal } = store.getState();
    addTerminal(LOGIN_TASK_ID, FIRST_TERMINAL_ID);
    addTerminal(LOGIN_TASK_ID, SECOND_TERMINAL_ID);

    // Act
    store.getState().addAgentSessionTerminal(LOGIN_TASK_ID, THIRD_TERMINAL_ID, AGENT_TAB_TITLE);

    // Assert
    const state = store.getState();
    expect(state.terminalsByTask[LOGIN_TASK_ID]).toEqual([
      { terminalId: THIRD_TERMINAL_ID, title: AGENT_TAB_TITLE, kind: 'agent-session' },
      { terminalId: FIRST_TERMINAL_ID, title: 'Terminal 1', kind: 'terminal' },
      { terminalId: SECOND_TERMINAL_ID, title: 'Terminal 2', kind: 'terminal' },
    ]);
    expect(state.activeTerminalByTask[LOGIN_TASK_ID]).toBe(THIRD_TERMINAL_ID);
  });

  it('addTerminal_AfterAgentSessionTab_StartsNumberingAtTerminal1', () => {
    // Arrange
    store.getState().addAgentSessionTerminal(LOGIN_TASK_ID, FIRST_TERMINAL_ID, AGENT_TAB_TITLE);

    // Act
    store.getState().addTerminal(LOGIN_TASK_ID, SECOND_TERMINAL_ID);

    // Assert
    expect(store.getState().terminalsByTask[LOGIN_TASK_ID]?.map((tab) => tab.title)).toEqual([
      AGENT_TAB_TITLE,
      'Terminal 1',
    ]);
  });

  it('reportAgentSessionFailure_ForTask_KeepsReasonForThatTaskOnly', () => {
    // Act
    store.getState().reportAgentSessionFailure(LOGIN_TASK_ID, 'hooks-unavailable');

    // Assert
    expect(store.getState().agentSessionFailureByTask[LOGIN_TASK_ID]).toBe('hooks-unavailable');
    expect(store.getState().agentSessionFailureByTask[EXPORT_TASK_ID]).toBeUndefined();
  });

  it('addAgentSessionTerminal_AfterReportedFailure_ClearsIt', () => {
    // Arrange
    store.getState().reportAgentSessionFailure(LOGIN_TASK_ID, 'hooks-unavailable');

    // Act
    store.getState().addAgentSessionTerminal(LOGIN_TASK_ID, FIRST_TERMINAL_ID, AGENT_TAB_TITLE);

    // Assert
    expect(store.getState().agentSessionFailureByTask[LOGIN_TASK_ID]).toBeUndefined();
  });

  it('removeTerminal_OfActiveMiddleTab_ActivatesRightNeighbour', () => {
    // Arrange
    const { addTerminal, activateTerminal } = store.getState();
    addTerminal(LOGIN_TASK_ID, FIRST_TERMINAL_ID);
    addTerminal(LOGIN_TASK_ID, SECOND_TERMINAL_ID);
    addTerminal(LOGIN_TASK_ID, THIRD_TERMINAL_ID);
    activateTerminal(LOGIN_TASK_ID, SECOND_TERMINAL_ID);

    // Act
    store.getState().removeTerminal(SECOND_TERMINAL_ID);

    // Assert
    const state = store.getState();
    expect(state.terminalsByTask[LOGIN_TASK_ID]?.map((tab) => tab.title)).toEqual([
      'Terminal 1',
      'Terminal 3',
    ]);
    expect(state.activeTerminalByTask[LOGIN_TASK_ID]).toBe(THIRD_TERMINAL_ID);
  });

  it('removeTerminal_OfActiveLastTab_ActivatesLeftNeighbour', () => {
    // Arrange
    const { addTerminal } = store.getState();
    addTerminal(LOGIN_TASK_ID, FIRST_TERMINAL_ID);
    addTerminal(LOGIN_TASK_ID, SECOND_TERMINAL_ID);

    // Act
    store.getState().removeTerminal(SECOND_TERMINAL_ID);

    // Assert
    expect(store.getState().activeTerminalByTask[LOGIN_TASK_ID]).toBe(FIRST_TERMINAL_ID);
  });

  it('removeTerminal_OfOnlyTab_LeavesNoActiveTerminal', () => {
    // Arrange
    store.getState().addTerminal(LOGIN_TASK_ID, FIRST_TERMINAL_ID);

    // Act
    store.getState().removeTerminal(FIRST_TERMINAL_ID);

    // Assert
    expect(store.getState().terminalsByTask[LOGIN_TASK_ID]).toEqual([]);
    expect(store.getState().activeTerminalByTask[LOGIN_TASK_ID]).toBeUndefined();
  });

  it('addTerminal_AfterClosingOne_NeverReusesNumberAndCountsPerTask', () => {
    // Arrange
    const { addTerminal, removeTerminal } = store.getState();
    addTerminal(LOGIN_TASK_ID, FIRST_TERMINAL_ID);
    addTerminal(LOGIN_TASK_ID, SECOND_TERMINAL_ID);
    removeTerminal(SECOND_TERMINAL_ID);

    // Act
    addTerminal(LOGIN_TASK_ID, THIRD_TERMINAL_ID);
    addTerminal(EXPORT_TASK_ID, FOURTH_TERMINAL_ID);

    // Assert
    const state = store.getState();
    expect(state.terminalsByTask[LOGIN_TASK_ID]?.map((tab) => tab.title)).toEqual([
      'Terminal 1',
      'Terminal 3',
    ]);
    expect(state.terminalsByTask[EXPORT_TASK_ID]?.map((tab) => tab.title)).toEqual(['Terminal 1']);
  });

  it('selectTask_WithTaskId_MakesItTheShownTask', () => {
    // Act
    store.getState().selectTask(EXPORT_TASK_ID);

    // Assert
    expect(store.getState().selectedTaskId).toBe(EXPORT_TASK_ID);
  });

  it('applyAgentSessionStatus_ForTask_KeepsItForThatTaskOnly', () => {
    // Act
    store.getState().applyAgentSessionStatus(loginStatus('waiting', 2));

    // Assert
    expect(store.getState().agentSessionStatusByTask).toEqual({
      [LOGIN_TASK_ID]: loginStatus('waiting', 2),
    });
  });

  it('applyAgentSessionStatus_Twice_KeepsTheLatest', () => {
    // Arrange
    store.getState().applyAgentSessionStatus(loginStatus('working'));

    // Act
    store.getState().applyAgentSessionStatus(loginStatus('ready'));

    // Assert
    expect(store.getState().agentSessionStatusByTask[LOGIN_TASK_ID]).toEqual(loginStatus('ready'));
  });

  it('loadAgentSessionStatuses_IntoEmptyStore_TakesAll', () => {
    // Act
    store.getState().loadAgentSessionStatuses([loginStatus('ready'), EXPORT_WORKING]);

    // Assert
    expect(store.getState().agentSessionStatusByTask).toEqual({
      [LOGIN_TASK_ID]: loginStatus('ready'),
      [EXPORT_TASK_ID]: EXPORT_WORKING,
    });
  });

  it('loadAgentSessionStatuses_AfterEventForTask_KeepsTheEventStatus', () => {
    // Arrange: the event overtook the list, so the listed status is older
    store.getState().applyAgentSessionStatus(loginStatus('waiting'));

    // Act
    store.getState().loadAgentSessionStatuses([loginStatus('working'), EXPORT_WORKING]);

    // Assert
    expect(store.getState().agentSessionStatusByTask).toEqual({
      [LOGIN_TASK_ID]: loginStatus('waiting'),
      [EXPORT_TASK_ID]: EXPORT_WORKING,
    });
  });

  it('openTask_WhileAgentSessionWaits_SelectsTaskAndShowsAgentSessionTab', () => {
    // Arrange: a terminal tab is in front of the agent session tab
    const { addAgentSessionTerminal, addTerminal, applyAgentSessionStatus } = store.getState();
    addAgentSessionTerminal(LOGIN_TASK_ID, FIRST_TERMINAL_ID, AGENT_TAB_TITLE);
    addTerminal(LOGIN_TASK_ID, SECOND_TERMINAL_ID);
    applyAgentSessionStatus(loginStatus('waiting'));

    // Act
    store.getState().openTask(LOGIN_TASK_ID);

    // Assert: permissions and questions are answered in the agent session (concept 5.4)
    const state = store.getState();
    expect(state.selectedTaskId).toBe(LOGIN_TASK_ID);
    expect(state.activeTerminalByTask[LOGIN_TASK_ID]).toBe(FIRST_TERMINAL_ID);
  });

  it.each(['working', 'ready', 'failed', 'ended'] as const)(
    'openTask_WhileAgentSessionIs%s_KeepsActiveTab',
    (status) => {
      // Arrange
      const { addAgentSessionTerminal, addTerminal, applyAgentSessionStatus } = store.getState();
      addAgentSessionTerminal(LOGIN_TASK_ID, FIRST_TERMINAL_ID, AGENT_TAB_TITLE);
      addTerminal(LOGIN_TASK_ID, SECOND_TERMINAL_ID);
      applyAgentSessionStatus(loginStatus(status));

      // Act
      store.getState().openTask(LOGIN_TASK_ID);

      // Assert
      const state = store.getState();
      expect(state.selectedTaskId).toBe(LOGIN_TASK_ID);
      expect(state.activeTerminalByTask[LOGIN_TASK_ID]).toBe(SECOND_TERMINAL_ID);
    },
  );

  it('openTask_WhileWaitingWithoutAgentSessionTab_OnlySelectsTask', () => {
    // Arrange: e.g. after a reload of the renderer, which lost its tabs
    store.getState().addTerminal(LOGIN_TASK_ID, THIRD_TERMINAL_ID);
    store.getState().addTerminal(LOGIN_TASK_ID, FOURTH_TERMINAL_ID);
    store.getState().applyAgentSessionStatus(loginStatus('waiting'));

    // Act
    store.getState().openTask(LOGIN_TASK_ID);

    // Assert
    const state = store.getState();
    expect(state.selectedTaskId).toBe(LOGIN_TASK_ID);
    expect(state.activeTerminalByTask[LOGIN_TASK_ID]).toBe(FOURTH_TERMINAL_ID);
  });

  it('openTask_WhileOtherTaskWaits_KeepsActiveTab', () => {
    // Arrange: only the status of the opened task counts
    const { addAgentSessionTerminal, addTerminal, applyAgentSessionStatus } = store.getState();
    addAgentSessionTerminal(LOGIN_TASK_ID, FIRST_TERMINAL_ID, AGENT_TAB_TITLE);
    addTerminal(LOGIN_TASK_ID, SECOND_TERMINAL_ID);
    applyAgentSessionStatus({ ...EXPORT_WORKING, status: 'waiting' });

    // Act
    store.getState().openTask(LOGIN_TASK_ID);

    // Assert
    expect(store.getState().activeTerminalByTask[LOGIN_TASK_ID]).toBe(SECOND_TERMINAL_ID);
  });
});
