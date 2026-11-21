import type { AgentSessionStatus } from '@shared/domain/agent-session';
import type { AgentStatusEvent } from './agent-status-event';

/** Status of one agent session plus the subagents it is waiting for (concept 3, rule 1). */
export interface AgentSessionStatusState {
  readonly status: AgentSessionStatus;
  /** Ids of running subagents; their number is shown in the sidebar. */
  readonly subagentIds: ReadonlySet<string>;
}

/**
 * Applies one event to the status of an agent session (concept 3).
 * @param state Current state; `null` before the first conversation started.
 * @param event What happened.
 * @returns The next state.
 */
export function applyStatusEvent(
  state: AgentSessionStatusState | null,
  event: AgentStatusEvent,
): AgentSessionStatusState | null {
  switch (event.kind) {
    case 'conversation-started':
      return withoutSubagents('ready');
    case 'subagent-started':
      // Subagents never change the status (concept 3, rule 1), only the counter.
      return state === null
        ? state
        : { ...state, subagentIds: new Set([...state.subagentIds, event.subagentId]) };
    case 'subagent-stopped':
      return withoutSubagent(state, event.subagentId);
    case 'conversation-replaced':
      // The agent session lives on with a new conversation (concept 3, rule 6); the
      // SessionStart that follows carries its id.
      return state === null ? state : withoutSubagents('ready');
    case 'session-ended':
      // From every status, also without one: the end of the terminal counts as well, so a
      // crashed agent never stays on "Arbeitet". Its subagents ended with it.
      return state?.status === 'ended' ? state : withoutSubagents('ended');
    case 'prompt-submitted':
      return transition(state, ['ready', 'working', 'waiting', 'failed'], 'working');
    case 'input-requested':
      return transition(state, ['working'], 'waiting');
    case 'tool-finished':
      return transition(state, ['waiting'], 'working');
    case 'turn-finished':
      // Stop also resolves "Wartet" (concept 3, rule 2).
      return transition(state, ['working', 'waiting'], 'ready');
    case 'turn-failed':
      return transition(state, ['working'], 'failed');
    case 'interrupted':
      // Only from "Arbeitet": an interrupt while "Wartet" cannot be detected, so "Wartet" stays
      // until the next prompt (concept 3, rule 4; ADR 0005, addendum).
      return transition(state, ['working'], 'ready');
    default:
      return state;
  }
}

/**
 * Builds a state without running subagents.
 * @param status The status.
 * @returns The new state.
 */
function withoutSubagents(status: AgentSessionStatus): AgentSessionStatusState {
  return { status, subagentIds: new Set() };
}

/**
 * Removes a subagent the state knows. A stop without a start is ignored: an agent may report
 * stops of helpers it never announced, and a plain counter would go negative (concept 3, rule 1).
 * @param state Current state; `null` before the first conversation started.
 * @param subagentId The stopped subagent.
 * @returns The new state, or the unchanged one (same reference) for an unknown id.
 */
function withoutSubagent(
  state: AgentSessionStatusState | null,
  subagentId: string,
): AgentSessionStatusState | null {
  if (state === null || !state.subagentIds.has(subagentId)) {
    return state;
  }
  const subagentIds = new Set(state.subagentIds);
  subagentIds.delete(subagentId);
  return { ...state, subagentIds };
}

/**
 * Changes the status if the diagram allows it from the current one (concept 3); every other
 * event is ignored. Keeps the subagents.
 * @param state Current state; `null` before the first conversation started.
 * @param from Statuses the transition starts from.
 * @param to Status it leads to.
 * @returns The new state, or the unchanged one (same reference) if the transition does not apply.
 */
function transition(
  state: AgentSessionStatusState | null,
  from: readonly AgentSessionStatus[],
  to: AgentSessionStatus,
): AgentSessionStatusState | null {
  if (state === null || !from.includes(state.status)) {
    return state;
  }
  return { ...state, status: to };
}
