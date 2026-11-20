import type { AgentType } from '@shared/domain/project';
import type { AgentTypeAdapter } from './agent-type-adapter';
import { createClaudeCodeAdapter } from './claude-code/claude-code-adapter';

/**
 * The adapter of every agent type Argus supports (concept 4). A new agent type, e.g. Codex,
 * docks on here without changes to the core.
 */
export const AGENT_TYPE_ADAPTERS: Readonly<Record<AgentType, AgentTypeAdapter>> = {
  'claude-code': createClaudeCodeAdapter(),
};
