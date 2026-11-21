import type { ArgusApi } from '@shared/ipc/contract';
import type { TaskViewStore } from '@renderer/stores/task-view-store';

/** The part of `window.argus.agentSession` the status listening needs. */
export type AgentSessionStatusApi = Pick<
  ArgusApi['agentSession'],
  'onStatusChanged' | 'listStatuses'
>;

/**
 * Keeps the statuses in the store current: subscribes to changes, then loads the statuses the
 * renderer missed, e.g. after a reload.
 * @param api Status part of the preload API.
 * @param store The task view store.
 * @returns Resolves once the current statuses are loaded; rejects if listing them failed.
 */
export async function startAgentSessionStatusListening(
  api: AgentSessionStatusApi,
  store: TaskViewStore,
): Promise<void> {
  // Subscribed first: a change between listing and its answer must not get lost. The store
  // keeps such newer statuses when the list arrives.
  api.onStatusChanged((status) => {
    store.getState().applyAgentSessionStatus(status);
  });
  const { statuses } = await api.listStatuses({});
  store.getState().loadAgentSessionStatuses(statuses);
}
