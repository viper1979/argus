/**
 * What happened in an agent session, in agent-neutral terms. The agent type adapter translates
 * hook payloads and terminal signals into these events; the status rules (concept 3) only ever
 * see these, never agent-specific payloads.
 */
export type AgentStatusEvent =
  /** A conversation started, was resumed or replaced after a clear; carries its id. */
  | { readonly kind: 'conversation-started'; readonly conversationId: string }
  /**
   * The running conversation reported its id again without a new turn state, e.g. after the
   * context was compacted, possibly in the middle of a turn. Only the id is recorded.
   */
  | { readonly kind: 'conversation-continued'; readonly conversationId: string }
  /** A prompt reached the main agent, typed or synthetic (e.g. a subagent's hand-back). */
  | { readonly kind: 'prompt-submitted' }
  /** A tool of the main agent finished, successfully or not. */
  | { readonly kind: 'tool-finished' }
  /** The main agent needs the user: a permission or a question. */
  | { readonly kind: 'input-requested' }
  /** The main agent finished its turn. */
  | { readonly kind: 'turn-finished' }
  /** The turn ended with an error. */
  | { readonly kind: 'turn-failed' }
  /** The user interrupted the turn (ADR 0005). */
  | { readonly kind: 'interrupted' }
  /** A subagent started; counts until its stop. */
  | { readonly kind: 'subagent-started'; readonly subagentId: string }
  /** A subagent stopped; only known ids count. */
  | { readonly kind: 'subagent-stopped'; readonly subagentId: string }
  /**
   * The conversation was replaced inside the running agent, e.g. by a clear or by switching to
   * another conversation; the agent session lives on, the next conversation start carries the id.
   */
  | { readonly kind: 'conversation-replaced' }
  /** The agent process ended, or the terminal of the agent session did. */
  | { readonly kind: 'session-ended' };
