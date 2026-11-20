import type { AgentType } from '@shared/domain/project';

/** Display names of the agent types; only Claude Code exists in the MVP. */
export const AGENT_TYPE_LABELS: Record<AgentType, string> = {
  'claude-code': 'Claude Code',
};
