import type { AgentType } from '@shared/domain/project';
import type { AgentSessionService } from '../agents/agent-session-service';
import type { AgentTypeAdapter } from '../agents/agent-type-adapter';
import type { Logger } from '../logging/logger';
import type { StatusTracker } from '../status/status-tracker';
import type { HookEvent } from './hook-server';

/** Collaborators of the hook event handler. */
export interface HookEventHandlerOptions {
  /** The adapter of every agent type; it interprets the payloads of its agent. */
  readonly adapters: Readonly<Record<AgentType, AgentTypeAdapter>>;
  /** Knows the agent sessions of this app run and stores their conversation ids. */
  readonly agentSessionService: Pick<AgentSessionService, 'findTaskId' | 'recordConversationId'>;
  readonly statusTracker: Pick<StatusTracker, 'apply'>;
  readonly logger: Logger;
}

/**
 * Creates the handler for every hook request that passed the hook server's checks (concept 3).
 * Invalid or foreign events are logged and ignored; the body itself is never logged, since it
 * holds prompts and tool output.
 * @param options Adapters, agent sessions, status tracker and logger.
 * @returns The handler; its promise never rejects.
 */
export function createHookEventHandler(
  options: HookEventHandlerOptions,
): (event: HookEvent) => Promise<void> {
  const { adapters, agentSessionService, statusTracker, logger } = options;

  return async ({ agentType, agentSessionId, body }) => {
    // Only ids and names are logged, never the body.
    const context = { agentType, agentSessionId };
    // The header comes from a process outside Argus' control, e.g. an agent of an earlier run.
    if (agentSessionId === null || agentSessionService.findTaskId(agentSessionId) === null) {
      logger.warn('Hook event of unknown agent session ignored', context);
      return;
    }
    const payload = parseJson(body);
    if (payload === INVALID_JSON) {
      logger.warn('Hook payload is not valid JSON', context);
      return;
    }
    const interpretation = adapters[agentType].interpretHookEvent(payload);
    if (!interpretation.ok) {
      logger.warn('Invalid hook payload ignored', {
        ...context,
        eventName: interpretation.eventName,
        invalidPaths: interpretation.invalidPaths,
      });
      return;
    }
    const { event } = interpretation;
    if (event === null) {
      return;
    }
    // Status first: it must not wait for, or depend on, writing state.json.
    statusTracker.apply(agentSessionId, event);
    if (event.kind === 'conversation-started' || event.kind === 'conversation-continued') {
      try {
        await agentSessionService.recordConversationId(agentSessionId, event.conversationId);
      } catch (error: unknown) {
        // Only resuming (#12) needs the id; the agent session itself goes on.
        logger.error('Could not record conversation id', { agentSessionId, error });
      }
    }
  };
}

/** Marks a body that is not valid JSON; `null` is valid JSON and must stay distinguishable. */
const INVALID_JSON = Symbol('invalid-json');

/**
 * Parses a hook body.
 * @param body The raw request body.
 * @returns The parsed value, or {@link INVALID_JSON}.
 */
function parseJson(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch (error: unknown) {
    // Only SyntaxError means "not JSON"; anything else is a bug and must surface.
    if (error instanceof SyntaxError) {
      return INVALID_JSON;
    }
    throw error;
  }
}
