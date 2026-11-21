import { describe, expect, it } from 'vitest';
import type { AgentSessionStatus } from '@shared/domain/agent-session';
import { applyStatusEvent, type AgentSessionStatusState } from './apply-status-event';

/**
 * Builds a state as the rules would have left it.
 * @param status Current status.
 * @param subagentIds Running subagents.
 * @returns The state.
 */
function stateOf(
  status: AgentSessionStatus,
  subagentIds: readonly string[] = [],
): AgentSessionStatusState {
  return { status, subagentIds: new Set(subagentIds) };
}

/** Events that only change the status, never the subagents. */
type StatusOnlyEventKind =
  | 'prompt-submitted'
  | 'tool-finished'
  | 'input-requested'
  | 'turn-finished'
  | 'turn-failed'
  | 'interrupted';

/**
 * Next status per current status, written down from the diagram in concept 3 and rule 2 as an
 * independent oracle. Every pair the diagram does not list keeps the status ("Diagramm strikt").
 */
const EXPECTED_NEXT_STATUS: Readonly<
  Record<StatusOnlyEventKind, Readonly<Record<AgentSessionStatus, AgentSessionStatus>>>
> = {
  'prompt-submitted': {
    ready: 'working',
    working: 'working',
    waiting: 'working',
    failed: 'working',
    ended: 'ended',
  },
  'tool-finished': {
    ready: 'ready',
    working: 'working',
    waiting: 'working',
    failed: 'failed',
    ended: 'ended',
  },
  'input-requested': {
    ready: 'ready',
    working: 'waiting',
    waiting: 'waiting',
    failed: 'failed',
    ended: 'ended',
  },
  'turn-finished': {
    ready: 'ready',
    working: 'ready',
    waiting: 'ready',
    failed: 'failed',
    ended: 'ended',
  },
  'turn-failed': {
    ready: 'ready',
    working: 'failed',
    waiting: 'waiting',
    failed: 'failed',
    ended: 'ended',
  },
  interrupted: {
    ready: 'ready',
    working: 'ready',
    waiting: 'waiting',
    failed: 'failed',
    ended: 'ended',
  },
};

const STATUS_MATRIX = Object.entries(EXPECTED_NEXT_STATUS).flatMap(([kind, nextByStatus]) =>
  Object.entries(nextByStatus).map(
    ([status, expected]) =>
      [kind as StatusOnlyEventKind, status as AgentSessionStatus, expected] as const,
  ),
);

describe('applyStatusEvent', () => {
  it.each(STATUS_MATRIX)('applyStatusEvent_%sWhile%s_LeadsTo%s', (kind, status, expected) => {
    // Arrange
    const current = stateOf(status);

    // Act
    const next = applyStatusEvent(current, { kind });

    // Assert
    expect(next?.status).toBe(expected);
  });

  it.each(Object.keys(EXPECTED_NEXT_STATUS) as StatusOnlyEventKind[])(
    'applyStatusEvent_%sWithoutStatus_StaysWithoutStatus',
    (kind) => {
      // Arrange: no SessionStart arrived yet, so there is no status to change.
      const noStatusYet = null;

      // Act
      const next = applyStatusEvent(noStatusYet, { kind });

      // Assert
      expect(next).toBeNull();
    },
  );

  it('applyStatusEvent_TurnFinishedWhileSubagentRuns_SetsReadyAndKeepsSubagent', () => {
    // Arrange: subagents run asynchronously; the main agent stops while one still runs.
    const working = stateOf('working', ['subagent-1']);

    // Act
    const next = applyStatusEvent(working, { kind: 'turn-finished' });

    // Assert
    expect(next).toEqual(stateOf('ready', ['subagent-1']));
  });

  it('applyStatusEvent_PromptSubmittedWhileReady_SetsWorking', () => {
    // Arrange
    const ready = stateOf('ready');

    // Act
    const next = applyStatusEvent(ready, { kind: 'prompt-submitted' });

    // Assert
    expect(next).toEqual(stateOf('working'));
  });

  it('applyStatusEvent_PromptSubmittedWhileEnded_StaysEnded', () => {
    // Arrange
    const ended = stateOf('ended');

    // Act
    const next = applyStatusEvent(ended, { kind: 'prompt-submitted' });

    // Assert
    expect(next).toBe(ended);
  });

  it('applyStatusEvent_InputRequestedWhileWorking_SetsWaiting', () => {
    // Arrange
    const working = stateOf('working');

    // Act
    const next = applyStatusEvent(working, { kind: 'input-requested' });

    // Assert
    expect(next).toEqual(stateOf('waiting'));
  });

  it('applyStatusEvent_ToolFinishedWhileWaiting_SetsWorking', () => {
    // Arrange
    const waiting = stateOf('waiting');

    // Act
    const next = applyStatusEvent(waiting, { kind: 'tool-finished' });

    // Assert
    expect(next).toEqual(stateOf('working'));
  });

  it.each(['working', 'waiting'] as const)(
    'applyStatusEvent_TurnFinishedWhile%s_SetsReady',
    (status) => {
      // Arrange
      const current = stateOf(status);

      // Act
      const next = applyStatusEvent(current, { kind: 'turn-finished' });

      // Assert
      expect(next).toEqual(stateOf('ready'));
    },
  );

  it('applyStatusEvent_TurnFailedWhileWorking_SetsFailed', () => {
    // Arrange
    const working = stateOf('working');

    // Act
    const next = applyStatusEvent(working, { kind: 'turn-failed' });

    // Assert
    expect(next).toEqual(stateOf('failed'));
  });

  it.each(['failed', 'waiting'] as const)(
    'applyStatusEvent_PromptSubmittedWhile%s_SetsWorking',
    (status) => {
      // Arrange
      const current = stateOf(status);

      // Act
      const next = applyStatusEvent(current, { kind: 'prompt-submitted' });

      // Assert
      expect(next).toEqual(stateOf('working'));
    },
  );

  it('applyStatusEvent_InterruptedWhileWorking_SetsReady', () => {
    // Arrange
    const working = stateOf('working');

    // Act
    const next = applyStatusEvent(working, { kind: 'interrupted' });

    // Assert
    expect(next).toEqual(stateOf('ready'));
  });

  it('applyStatusEvent_InterruptedWhileWaiting_StaysWaiting', () => {
    // Arrange
    const waiting = stateOf('waiting');

    // Act
    const next = applyStatusEvent(waiting, { kind: 'interrupted' });

    // Assert
    expect(next).toBe(waiting);
  });

  it.each(['ready', 'working', 'waiting', 'failed'] as const)(
    'applyStatusEvent_SessionEndedWhile%s_SetsEndedAndClearsSubagents',
    (status) => {
      // Arrange
      const current = stateOf(status, ['subagent-1']);

      // Act
      const next = applyStatusEvent(current, { kind: 'session-ended' });

      // Assert
      expect(next).toEqual(stateOf('ended'));
    },
  );

  it('applyStatusEvent_SessionEndedWithoutStatus_SetsEnded', () => {
    // Arrange
    const noStatusYet = null;

    // Act
    const next = applyStatusEvent(noStatusYet, { kind: 'session-ended' });

    // Assert
    expect(next).toEqual(stateOf('ended'));
  });

  it('applyStatusEvent_ConversationContinuedWhileWorking_LeavesStateUnchanged', () => {
    // Arrange: e.g. an automatic compaction in the middle of a turn.
    const working = stateOf('working', ['subagent-1']);

    // Act
    const next = applyStatusEvent(working, {
      kind: 'conversation-continued',
      conversationId: 'conversation-1',
    });

    // Assert
    expect(next).toBe(working);
  });

  it('applyStatusEvent_ConversationReplacedWhileWorking_SetsReadyAndClearsSubagents', () => {
    // Arrange
    const working = stateOf('working', ['subagent-1']);

    // Act
    const next = applyStatusEvent(working, { kind: 'conversation-replaced' });

    // Assert
    expect(next).toEqual(stateOf('ready'));
  });

  it('applyStatusEvent_ConversationStartedWhileEnded_SetsReady', () => {
    // Arrange
    const ended = stateOf('ended');

    // Act
    const next = applyStatusEvent(ended, {
      kind: 'conversation-started',
      conversationId: 'conversation-2',
    });

    // Assert
    expect(next).toEqual(stateOf('ready'));
  });

  it('applyStatusEvent_SubagentStartedWhileWorking_AddsSubagentAndKeepsStatus', () => {
    // Arrange
    const working = stateOf('working', ['subagent-1']);

    // Act
    const next = applyStatusEvent(working, { kind: 'subagent-started', subagentId: 'subagent-2' });

    // Assert
    expect(next).toEqual(stateOf('working', ['subagent-1', 'subagent-2']));
  });

  it('applyStatusEvent_SubagentStoppedKnownId_RemovesSubagentAndKeepsStatus', () => {
    // Arrange
    const ready = stateOf('ready', ['subagent-1', 'subagent-2']);

    // Act
    const next = applyStatusEvent(ready, { kind: 'subagent-stopped', subagentId: 'subagent-1' });

    // Assert
    expect(next).toEqual(stateOf('ready', ['subagent-2']));
  });

  it('applyStatusEvent_SubagentStoppedUnknownId_LeavesStateUnchanged', () => {
    // Arrange: Claude's internal helper agents stop without ever starting (concept 3, rule 1).
    const ready = stateOf('ready', ['subagent-1']);

    // Act
    const next = applyStatusEvent(ready, { kind: 'subagent-stopped', subagentId: 'helper' });

    // Assert
    expect(next).toBe(ready);
  });

  it('applyStatusEvent_ConversationStartedWithoutStatus_SetsReadyWithoutSubagents', () => {
    // Arrange
    const noStatusYet = null;

    // Act
    const next = applyStatusEvent(noStatusYet, {
      kind: 'conversation-started',
      conversationId: 'conversation-1',
    });

    // Assert
    expect(next).toEqual({ status: 'ready', subagentIds: new Set() });
  });
});
