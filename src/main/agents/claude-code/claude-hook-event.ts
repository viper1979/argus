import { z } from 'zod';
import type { AgentStatusEvent } from '../../status/agent-status-event';
import type { HookEventInterpretation } from '../agent-type-adapter';

/**
 * Fields every payload must have to be routed. Payloads are loose: Claude adds fields with new
 * versions, and Argus only requires what it reads.
 */
const hookEnvelopeSchema = z.looseObject({
  hook_event_name: z.string().min(1),
  /**
   * Only events of subagents carry it, never those of the main agent (ADR 0003). Only its
   * presence matters here; its type is checked by the event's own schema, so an invalid value
   * still reports the event name.
   */
  agent_id: z.unknown().optional(),
});

/** Id of a subagent; its start and stop are the only subagent events that count. */
const subagentSchema = z.looseObject({ agent_id: z.string().min(1) });

/** Events about subagents themselves; every other event with `agent_id` is ignored. */
const SUBAGENT_LIFECYCLE_EVENTS: readonly string[] = ['SubagentStart', 'SubagentStop'];

/** Claude's tool for questions to the user; it arrives as PreToolUse but means "Wartet". */
const ASK_USER_QUESTION_TOOL = 'AskUserQuestion';

/**
 * SessionStart sources after which Claude waits for a prompt ("Bereit"). Others, like "compact"
 * or values of newer versions, keep the status (hooks reference, checked 2026-11-21).
 */
const CONVERSATION_START_SOURCES: readonly string[] = ['startup', 'resume', 'clear', 'fork'];

/**
 * SessionEnd reasons after which Claude goes on with another conversation (`/clear`, `/resume`);
 * every other reason, e.g. "prompt_input_exit" or "logout", ends the agent session.
 */
const CONVERSATION_REPLACING_END_REASONS: readonly string[] = ['clear', 'resume'];

/** Id of the conversation (glossary: Konversations-ID). */
const conversationIdSchema = z.string().min(1);

/**
 * How each relevant hook event is validated and translated. Events missing here (e.g.
 * Notification) are valid but irrelevant.
 */
const HOOK_EVENT_RULES: Readonly<
  Record<string, { schema: z.ZodType; toStatusEvent: (payload: never) => AgentStatusEvent | null }>
> = {
  SessionStart: rule(
    z.looseObject({ session_id: conversationIdSchema, source: z.string() }),
    (payload) => ({
      // Anything else, e.g. "compact", may happen mid-turn: then only the id is recorded.
      kind: CONVERSATION_START_SOURCES.includes(payload.source)
        ? 'conversation-started'
        : 'conversation-continued',
      conversationId: payload.session_id,
    }),
  ),
  UserPromptSubmit: rule(z.looseObject({}), () => ({ kind: 'prompt-submitted' })),
  // Any other tool start is irrelevant; it does not even lift "Wartet" (concept 3, rule 2).
  PreToolUse: rule(z.looseObject({ tool_name: z.string() }), (payload) =>
    payload.tool_name === ASK_USER_QUESTION_TOOL ? { kind: 'input-requested' } : null,
  ),
  PermissionRequest: rule(z.looseObject({}), () => ({ kind: 'input-requested' })),
  PostToolUse: rule(z.looseObject({}), () => ({ kind: 'tool-finished' })),
  PostToolUseFailure: rule(z.looseObject({}), () => ({ kind: 'tool-finished' })),
  Stop: rule(z.looseObject({}), () => ({ kind: 'turn-finished' })),
  // Runs instead of Stop when the turn ends due to an API error.
  StopFailure: rule(z.looseObject({}), () => ({ kind: 'turn-failed' })),
  SubagentStart: rule(subagentSchema, (payload) => ({
    kind: 'subagent-started',
    subagentId: payload.agent_id,
  })),
  SubagentStop: rule(subagentSchema, (payload) => ({
    kind: 'subagent-stopped',
    subagentId: payload.agent_id,
  })),
  SessionEnd: rule(z.looseObject({ reason: z.string() }), (payload) => ({
    kind: CONVERSATION_REPLACING_END_REASONS.includes(payload.reason)
      ? 'conversation-replaced'
      : 'session-ended',
  })),
};

/**
 * Pairs a schema with its translation, so the translation gets the schema's output type.
 * @param schema Validates the payload of one hook event.
 * @param toStatusEvent Translates the validated payload.
 * @returns The rule.
 */
function rule<Schema extends z.ZodType>(
  schema: Schema,
  toStatusEvent: (payload: z.infer<Schema>) => AgentStatusEvent | null,
): { schema: Schema; toStatusEvent: (payload: never) => AgentStatusEvent | null } {
  return { schema, toStatusEvent };
}

/**
 * Translates one Claude Code hook payload into an agent status event (concept 3).
 * @param payload Parsed JSON body of the hook request, not yet validated.
 * @returns The event, `null` for an irrelevant payload, or why it is invalid.
 */
export function interpretClaudeHookEvent(payload: unknown): HookEventInterpretation {
  const envelope = hookEnvelopeSchema.safeParse(payload);
  if (!envelope.success) {
    return { ok: false, eventName: null, invalidPaths: toPaths(envelope.error) };
  }
  const eventName = envelope.data.hook_event_name;
  const eventRule = HOOK_EVENT_RULES[eventName];
  if (eventRule === undefined) {
    return { ok: true, event: null };
  }
  // Subagents never change the status of the agent session (concept 3, rule 1).
  const isFromSubagent = envelope.data.agent_id !== undefined;
  if (isFromSubagent && !SUBAGENT_LIFECYCLE_EVENTS.includes(eventName)) {
    return { ok: true, event: null };
  }
  const parsed = eventRule.schema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, eventName, invalidPaths: toPaths(parsed.error) };
  }
  return { ok: true, event: eventRule.toStatusEvent(parsed.data as never) };
}

/**
 * Lists the paths of the invalid fields, without their values: payloads carry prompts and
 * tool output, which must never reach the log.
 * @param error The validation error.
 * @returns E.g. `["session_id"]`.
 */
function toPaths(error: z.ZodError): string[] {
  return error.issues.map((issue) => issue.path.join('.'));
}
