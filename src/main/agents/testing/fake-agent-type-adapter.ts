import { z } from 'zod';
import type { AgentTypeAdapter } from '../agent-type-adapter';

/**
 * Agent type adapter for core tests: its outputs are trivial and recognisable, so tests check
 * what the core does with them, not what Claude needs.
 * @param overrides Behaviour to replace, e.g. a throwing `buildHookSettings`.
 * @returns The adapter.
 */
export function createFakeAgentTypeAdapter(
  overrides: Partial<AgentTypeAdapter> = {},
): AgentTypeAdapter {
  return {
    agentType: 'claude-code',
    hookSettingsSchema: z.object({ fakeHookPort: z.number() }).strict(),
    buildHookSettings: (port) => ({ fakeHookPort: port }),
    buildStartCommand: ({ hookSettingsPath, startPrompt }) =>
      `fake-agent ${hookSettingsPath} ${startPrompt ?? '<none>'}`,
    shouldRemoveInheritedVariable: () => false,
    interpretHookEvent: () => ({ ok: true, event: null }),
    createTerminalSignalInterpreter: () => ({ interpret: () => null }),
    ...overrides,
  };
}
