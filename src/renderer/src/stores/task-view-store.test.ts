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
});
