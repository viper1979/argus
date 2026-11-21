import type { AgentSessionStatus } from '@shared/domain/agent-session';

/** German status names of the glossary; UI texts are German. */
export const AGENT_SESSION_STATUS_LABELS: Readonly<Record<AgentSessionStatus, string>> = {
  working: 'Arbeitet',
  waiting: 'Wartet',
  ready: 'Bereit',
  failed: 'Fehler',
  ended: 'Beendet',
};

/**
 * Tailwind classes of the status dot (concept 3): blue and animated, orange, green, red; an
 * ended agent session gets a hollow grey dot, as sketched in concept 6.
 */
export const AGENT_SESSION_STATUS_DOT_CLASSES: Readonly<Record<AgentSessionStatus, string>> = {
  working: 'bg-blue-500 animate-pulse',
  waiting: 'bg-orange-500',
  ready: 'bg-green-600',
  failed: 'bg-red-600',
  ended: 'border border-muted-foreground',
};

/** Separates the parts of the status line, as sketched in concept 6. */
const STATUS_LINE_SEPARATOR = ' · ';

/** Abbreviation after the subagent count ("2 Sub"). */
const SUBAGENT_SUFFIX = 'Sub';

/**
 * Builds the status line below a task in the sidebar, e.g. "Wartet · 2 Sub" (concept 6).
 * @param status Status of the task's agent session.
 * @param subagentCount Running subagents; shown only if there are any.
 * @returns The line.
 */
export function formatAgentSessionStatusLine(
  status: AgentSessionStatus,
  subagentCount: number,
): string {
  const label = AGENT_SESSION_STATUS_LABELS[status];
  if (subagentCount === 0) {
    return label;
  }
  return `${label}${STATUS_LINE_SEPARATOR}${String(subagentCount)} ${SUBAGENT_SUFFIX}`;
}
