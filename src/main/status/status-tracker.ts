import type { AgentSessionStatus, AgentSessionStatusSnapshot } from '@shared/domain/agent-session';
import type { Logger } from '../logging/logger';
import type { AgentStatusEvent } from './agent-status-event';
import { applyStatusEvent, type AgentSessionStatusState } from './apply-status-event';

/** Holds the status of every agent session and reports changes (concept 4, StatusTracker). */
export interface StatusTracker {
  /**
   * Applies what happened in an agent session; reports the new status if it changed.
   * @param agentSessionId The agent session the event belongs to.
   * @param event What happened.
   */
  apply(agentSessionId: string, event: AgentStatusEvent): void;

  /**
   * Lists the current status of every agent session that has one, e.g. for a renderer that
   * (re)loads and missed earlier changes.
   * @returns One snapshot per agent session, in order of their first status.
   */
  getStatuses(): AgentSessionStatusSnapshot[];

  /**
   * Reads the current status of one agent session, e.g. for rules on terminal signals.
   * @param agentSessionId The agent session.
   * @returns Its status, or `null` before its first conversation started.
   */
  getStatus(agentSessionId: string): AgentSessionStatus | null;
}

/** Collaborators of the status tracker. */
export interface StatusTrackerOptions {
  /** Receives every change of status or subagent count. */
  readonly onStatusChanged: (snapshot: AgentSessionStatusSnapshot) => void;
  readonly logger: Logger;
}

/**
 * Creates the status tracker.
 * @param options Receiver of changes and logger.
 * @returns The tracker.
 */
export function createStatusTracker(options: StatusTrackerOptions): StatusTracker {
  const { onStatusChanged, logger } = options;
  /** State per agent session id; missing until its first conversation started. */
  const stateByAgentSession = new Map<string, AgentSessionStatusState>();

  return {
    apply: (agentSessionId, event) => {
      const previous = stateByAgentSession.get(agentSessionId) ?? null;
      const next = applyStatusEvent(previous, event);
      if (next === null) {
        return;
      }
      stateByAgentSession.set(agentSessionId, next);
      const previousStatus = previous?.status ?? null;
      if (previousStatus !== next.status) {
        // Only ids and statuses: event details may hint at prompts or tools.
        logger.info('Agent session status changed', {
          agentSessionId,
          from: previousStatus,
          to: next.status,
        });
      }
      // Reported only if what the sidebar shows changed, not on every applied event.
      const nextSnapshot = toSnapshot(agentSessionId, next);
      if (previous !== null && isSameSnapshot(toSnapshot(agentSessionId, previous), nextSnapshot)) {
        return;
      }
      onStatusChanged(nextSnapshot);
    },
    getStatuses: () =>
      [...stateByAgentSession].map(([agentSessionId, state]) => toSnapshot(agentSessionId, state)),
    getStatus: (agentSessionId) => stateByAgentSession.get(agentSessionId)?.status ?? null,
  };
}

/**
 * Tells whether two snapshots of the same agent session show the same.
 * @param left One snapshot.
 * @param right The other snapshot.
 * @returns `true` if status and subagent count are equal.
 */
function isSameSnapshot(
  left: AgentSessionStatusSnapshot,
  right: AgentSessionStatusSnapshot,
): boolean {
  return left.status === right.status && left.subagentCount === right.subagentCount;
}

/**
 * Reduces a state to what the sidebar shows.
 * @param agentSessionId The agent session.
 * @param state Its state.
 * @returns The snapshot.
 */
function toSnapshot(
  agentSessionId: string,
  state: AgentSessionStatusState,
): AgentSessionStatusSnapshot {
  return { agentSessionId, status: state.status, subagentCount: state.subagentIds.size };
}
