import type { AgentSessionStatusSnapshot } from '@shared/domain/agent-session';
import { describe, expect, it } from 'vitest';
import { toTaskAgentSessionStatus, type AgentSessionTaskLookup } from './task-agent-session-status';

const AGENT_SESSION_ID = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const TASK_ID = '3c9e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a';

/** Status of the agent session as the tracker reports it. */
const WAITING_SNAPSHOT: AgentSessionStatusSnapshot = {
  agentSessionId: AGENT_SESSION_ID,
  status: 'waiting',
  subagentCount: 1,
};

describe('toTaskAgentSessionStatus', () => {
  it('toTaskAgentSessionStatus_OfKnownAgentSession_AddsItsTask', () => {
    // Arrange
    const taskLookup: AgentSessionTaskLookup = {
      findTaskId: (agentSessionId) => (agentSessionId === AGENT_SESSION_ID ? TASK_ID : null),
    };

    // Act
    const status = toTaskAgentSessionStatus(WAITING_SNAPSHOT, taskLookup);

    // Assert
    expect(status).toEqual({ ...WAITING_SNAPSHOT, taskId: TASK_ID });
  });

  it('toTaskAgentSessionStatus_OfUnknownAgentSession_ReturnsNull', () => {
    // Arrange
    const taskLookup: AgentSessionTaskLookup = { findTaskId: () => null };

    // Act
    const status = toTaskAgentSessionStatus(WAITING_SNAPSHOT, taskLookup);

    // Assert
    expect(status).toBeNull();
  });
});
