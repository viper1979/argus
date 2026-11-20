import { beforeEach, describe, expect, it } from 'vitest';
import { createTaskViewStore, type TaskViewStore } from './task-view-store';

/** Ids only need to be distinct; real ones are UUIDs. */
const LOGIN_TASK_ID = 'task-login';
const EXPORT_TASK_ID = 'task-export';
const FIRST_TERMINAL_ID = 'terminal-1';
const SECOND_TERMINAL_ID = 'terminal-2';
const THIRD_TERMINAL_ID = 'terminal-3';
const FOURTH_TERMINAL_ID = 'terminal-4';

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
      { terminalId: FIRST_TERMINAL_ID, title: 'Terminal 1' },
    ]);
    expect(state.activeTerminalByTask[LOGIN_TASK_ID]).toBe(FIRST_TERMINAL_ID);
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
