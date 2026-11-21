import type { TaskAgentSessionStatus } from '@shared/domain/agent-session';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTaskViewStore, type TaskViewStore } from '@renderer/stores/task-view-store';
import {
  startAgentSessionStatusListening,
  type AgentSessionStatusApi,
} from './agent-session-status-events';

const LOGIN_TASK_ID = 'task-login';

/**
 * Builds a status of the login task's agent session.
 * @param status The status.
 * @returns The status with agent session and task.
 */
function loginStatus(status: TaskAgentSessionStatus['status']): TaskAgentSessionStatus {
  return { agentSessionId: 'agent-session-login', taskId: LOGIN_TASK_ID, status, subagentCount: 0 };
}

/** Stand-in for the preload API: events are pushed by the test, the list answers on demand. */
interface FakeStatusApi extends AgentSessionStatusApi {
  /** Delivers a `statusChanged` event to the subscriber. */
  push(status: TaskAgentSessionStatus): void;
  /** Answers the pending `listStatuses` call. */
  answerList(statuses: TaskAgentSessionStatus[]): void;
}

/**
 * Creates the fake API; `listStatuses` stays pending until the test answers it.
 * @returns The fake.
 */
function createFakeStatusApi(): FakeStatusApi {
  let listener: ((status: TaskAgentSessionStatus) => void) | null = null;
  let answer: ((response: { statuses: TaskAgentSessionStatus[] }) => void) | null = null;
  return {
    onStatusChanged: (newListener) => {
      listener = newListener;
      return () => {
        listener = null;
      };
    },
    listStatuses: () =>
      new Promise((resolve) => {
        answer = resolve;
      }),
    push: (status) => {
      listener?.(status);
    },
    answerList: (statuses) => {
      answer?.({ statuses });
    },
  };
}

describe('startAgentSessionStatusListening', () => {
  let store: TaskViewStore;
  let api: FakeStatusApi;

  beforeEach(() => {
    store = createTaskViewStore();
    api = createFakeStatusApi();
  });

  it('startAgentSessionStatusListening_WhenListed_LoadsStatusesIntoStore', async () => {
    // Arrange
    const listening = startAgentSessionStatusListening(api, store);

    // Act
    api.answerList([loginStatus('ready')]);
    await listening;

    // Assert
    expect(store.getState().agentSessionStatusByTask[LOGIN_TASK_ID]).toEqual(loginStatus('ready'));
  });

  it('startAgentSessionStatusListening_EventBeforeListAnswer_KeepsEventStatus', async () => {
    // Arrange: subscribed before listing, so no change between both gets lost
    const listening = startAgentSessionStatusListening(api, store);

    // Act
    api.push(loginStatus('waiting'));
    api.answerList([loginStatus('working')]);
    await listening;

    // Assert
    expect(store.getState().agentSessionStatusByTask[LOGIN_TASK_ID]).toEqual(
      loginStatus('waiting'),
    );
  });

  it('startAgentSessionStatusListening_EventAfterLoad_AppliesIt', async () => {
    // Arrange
    const listening = startAgentSessionStatusListening(api, store);
    api.answerList([loginStatus('working')]);
    await listening;

    // Act
    api.push(loginStatus('ready'));

    // Assert
    expect(store.getState().agentSessionStatusByTask[LOGIN_TASK_ID]).toEqual(loginStatus('ready'));
  });
});
