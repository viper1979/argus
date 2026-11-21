import type { AgentSessionStatusSnapshot } from '@shared/domain/agent-session';
import { describe, expect, it, vi } from 'vitest';
import { createFakeLogger } from '../logging/testing/fake-logger';
import { createStatusTracker } from './status-tracker';

const AGENT_SESSION_ID = '11111111-1111-4111-8111-111111111111';

/**
 * Creates a tracker that records every reported change.
 * @returns The tracker and the reported snapshots in order.
 */
function createRecordingTracker(): {
  tracker: ReturnType<typeof createStatusTracker>;
  reported: AgentSessionStatusSnapshot[];
} {
  const reported: AgentSessionStatusSnapshot[] = [];
  const tracker = createStatusTracker({
    onStatusChanged: (snapshot) => reported.push(snapshot),
    logger: createFakeLogger(),
  });
  return { tracker, reported };
}

describe('createStatusTracker', () => {
  it('apply_ConversationStartedForNewAgentSession_ReportsReady', () => {
    // Arrange
    const { tracker, reported } = createRecordingTracker();

    // Act
    tracker.apply(AGENT_SESSION_ID, {
      kind: 'conversation-started',
      conversationId: 'conversation-1',
    });

    // Assert
    expect(reported).toEqual([
      { agentSessionId: AGENT_SESSION_ID, status: 'ready', subagentCount: 0 },
    ]);
  });

  it('apply_SecondPromptWhileWorking_ReportsNothingNew', () => {
    // Arrange
    const { tracker, reported } = createRecordingTracker();
    tracker.apply(AGENT_SESSION_ID, { kind: 'conversation-started', conversationId: 'c-1' });
    tracker.apply(AGENT_SESSION_ID, { kind: 'prompt-submitted' });

    // Act: e.g. the synthetic hand-back of a subagent while the main agent still works.
    tracker.apply(AGENT_SESSION_ID, { kind: 'prompt-submitted' });

    // Assert
    expect(reported.map((snapshot) => snapshot.status)).toEqual(['ready', 'working']);
  });

  it('getStatuses_TwoAgentSessions_ReturnsCurrentSnapshotOfEach', () => {
    // Arrange
    const otherAgentSessionId = '22222222-2222-4222-8222-222222222222';
    const { tracker } = createRecordingTracker();
    tracker.apply(AGENT_SESSION_ID, { kind: 'conversation-started', conversationId: 'c-1' });
    tracker.apply(AGENT_SESSION_ID, { kind: 'prompt-submitted' });
    tracker.apply(AGENT_SESSION_ID, { kind: 'subagent-started', subagentId: 'subagent-1' });
    tracker.apply(otherAgentSessionId, { kind: 'conversation-started', conversationId: 'c-2' });

    // Act
    const statuses = tracker.getStatuses();

    // Assert
    expect(statuses).toEqual([
      { agentSessionId: AGENT_SESSION_ID, status: 'working', subagentCount: 1 },
      { agentSessionId: otherAgentSessionId, status: 'ready', subagentCount: 0 },
    ]);
  });

  it('apply_StatusChanges_LogsOnlyStatusChangesWithoutEventDetails', () => {
    // Arrange
    const logInfo = vi.fn();
    const tracker = createStatusTracker({
      onStatusChanged: () => undefined,
      logger: createFakeLogger({ info: logInfo }),
    });

    // Act
    tracker.apply(AGENT_SESSION_ID, { kind: 'conversation-started', conversationId: 'c-1' });
    tracker.apply(AGENT_SESSION_ID, { kind: 'prompt-submitted' });
    tracker.apply(AGENT_SESSION_ID, { kind: 'subagent-started', subagentId: 'subagent-1' });

    // Assert: the subagent only changed the count, not the status.
    expect(logInfo.mock.calls).toEqual([
      [
        'Agent session status changed',
        { agentSessionId: AGENT_SESSION_ID, from: null, to: 'ready' },
      ],
      [
        'Agent session status changed',
        { agentSessionId: AGENT_SESSION_ID, from: 'ready', to: 'working' },
      ],
    ]);
  });

  it('getStatus_AfterPrompt_ReturnsWorking', () => {
    // Arrange
    const { tracker } = createRecordingTracker();
    tracker.apply(AGENT_SESSION_ID, { kind: 'conversation-started', conversationId: 'c-1' });
    tracker.apply(AGENT_SESSION_ID, { kind: 'prompt-submitted' });

    // Act
    const status = tracker.getStatus(AGENT_SESSION_ID);

    // Assert
    expect(status).toBe('working');
  });

  it('getStatus_BeforeFirstConversation_ReturnsNull', () => {
    // Arrange: a prompt before SessionStart sets no status (no status before the first start)
    const { tracker } = createRecordingTracker();
    tracker.apply(AGENT_SESSION_ID, { kind: 'prompt-submitted' });

    // Act
    const status = tracker.getStatus(AGENT_SESSION_ID);

    // Assert
    expect(status).toBeNull();
  });
});
