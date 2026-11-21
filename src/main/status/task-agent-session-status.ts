import type {
  AgentSessionStatusSnapshot,
  TaskAgentSessionStatus,
} from '@shared/domain/agent-session';

/** Knows the task of every agent session, e.g. the agent session service. */
export interface AgentSessionTaskLookup {
  /**
   * Finds the task of an agent session.
   * @param agentSessionId The agent session.
   * @returns The task id, or `null` if the agent session is unknown.
   */
  findTaskId(agentSessionId: string): string | null;
}

/**
 * Adds the task to a snapshot, since the renderer shows statuses per task.
 * @param snapshot Status of one agent session.
 * @param taskLookup Knows the task of every agent session.
 * @returns The snapshot with its task, or `null` if the agent session is unknown.
 */
export function toTaskAgentSessionStatus(
  snapshot: AgentSessionStatusSnapshot,
  taskLookup: AgentSessionTaskLookup,
): TaskAgentSessionStatus | null {
  const taskId = taskLookup.findTaskId(snapshot.agentSessionId);
  return taskId === null ? null : { ...snapshot, taskId };
}
