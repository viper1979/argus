import { z } from 'zod';
import { agentTypeSchema } from './project';
import { terminalSizeSchema } from './terminal';

/**
 * A conversation of an agent type within a task (glossary: Agent-Session). It outlives its
 * process: after it ended it can be resumed and stays the same agent session.
 */
export const agentSessionSchema = z.object({
  id: z.uuid(),
  taskId: z.uuid(),
  agentType: agentTypeSchema,
  /** Id the agent CLI reports for the conversation (e.g. Claude's `session_id`); set from #8 on. */
  conversationId: z.string().min(1).nullable(),
});

/** A conversation of an agent type within a task (glossary: Agent-Session). */
export type AgentSession = z.infer<typeof agentSessionSchema>;

/**
 * Status of an agent session (glossary, concept 3): Arbeitet, Wartet, Bereit, Fehler, Beendet.
 */
export const agentSessionStatusSchema = z.enum(['working', 'waiting', 'ready', 'failed', 'ended']);

/** Status of an agent session (glossary, concept 3). */
export type AgentSessionStatus = z.infer<typeof agentSessionStatusSchema>;

/** What the sidebar shows of one agent session: its status and how many subagents run. */
export const agentSessionStatusSnapshotSchema = z.object({
  agentSessionId: z.uuid(),
  status: agentSessionStatusSchema,
  subagentCount: z.number().int().nonnegative(),
});

/** What the sidebar shows of one agent session. */
export type AgentSessionStatusSnapshot = z.infer<typeof agentSessionStatusSnapshotSchema>;

/** A snapshot with the task it belongs to, since the sidebar lists tasks (concept 6). */
export const taskAgentSessionStatusSchema = agentSessionStatusSnapshotSchema.extend({
  taskId: z.uuid(),
});

/** A snapshot with the task it belongs to. */
export type TaskAgentSessionStatus = z.infer<typeof taskAgentSessionStatusSchema>;

/** Starts an agent session in the first terminal tab of a task. */
export const startAgentSessionRequestSchema = terminalSizeSchema.extend({
  taskId: z.uuid(),
});

/** Starts an agent session in the first terminal tab of a task. */
export type StartAgentSessionRequest = z.infer<typeof startAgentSessionRequestSchema>;

/** Why an agent session could not be started; the renderer maps it to a German message. */
export const startAgentSessionFailureReasonSchema = z.enum([
  'task-not-found',
  /** The task already has a running agent session (at most one per task). */
  'already-running',
  /** Hook server or hook settings file failed at app start; there would be no status. */
  'hooks-unavailable',
  'shell-unavailable',
  /** Argus is quitting and ends all terminals. */
  'app-closing',
]);

/** Outcome of starting an agent session; business failures are results, not exceptions. */
export const startAgentSessionResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), agentSessionId: z.uuid(), terminalId: z.uuid() }),
  z.object({ ok: z.literal(false), reason: startAgentSessionFailureReasonSchema }),
]);

/** Outcome of starting an agent session. */
export type StartAgentSessionResult = z.infer<typeof startAgentSessionResultSchema>;
