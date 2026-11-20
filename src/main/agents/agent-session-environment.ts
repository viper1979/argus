/**
 * Environment variables Argus sets in the terminal of every agent session. Owned by the core;
 * adapters reference them, e.g. to send them back as hook headers (ADR 0003).
 */

/** Secret of this app start; the hook server rejects requests without it. */
export const AGENT_SESSION_TOKEN_VARIABLE = 'ARGUS_TOKEN';

/** Id of the agent session, so the hook server can map events to it. */
export const AGENT_SESSION_ID_VARIABLE = 'ARGUS_SESSION_ID';
