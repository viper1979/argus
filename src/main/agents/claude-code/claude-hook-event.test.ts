import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { AgentStatusEvent } from '../../status/agent-status-event';
import { createClaudeCodeAdapter } from './claude-code-adapter';
import askUserQuestion from './fixtures/ask-user-question.json';
import permissionRequest from './fixtures/permission-request.json';
import permissionThenToolFailure from './fixtures/permission-then-tool-failure.json';
import sessionStartClearResume from './fixtures/session-start-clear-resume.json';
import stopFailure from './fixtures/stop-failure.json';
import subagentForeground from './fixtures/subagent-foreground.json';

/** Folder of all fixture files, recorded and hand-built. */
const FIXTURES_DIRECTORY = new URL('./fixtures/', import.meta.url);

/** Every fixture file name, so a new fixture is checked without touching this test. */
const ALL_FIXTURE_FILES = readdirSync(FIXTURES_DIRECTORY).filter((name) => name.endsWith('.json'));

/** A fixture file: recorded or hand-built hook payloads of one scenario. */
interface HookFixture {
  readonly events: readonly unknown[];
}

/** What a test expects per payload: the event kind, `null` for irrelevant, or `invalid`. */
type ExpectedOutcome = AgentStatusEvent['kind'] | null | 'invalid';

/**
 * Interprets every payload of a fixture like the core would, in order.
 * @param fixture The scenario.
 * @returns Per payload the event kind, `null` for irrelevant payloads, or `invalid`.
 */
function interpretFixture(fixture: HookFixture): ExpectedOutcome[] {
  const adapter = createClaudeCodeAdapter();
  return fixture.events.map((payload) => {
    const interpretation = adapter.interpretHookEvent(payload);
    if (!interpretation.ok) {
      return 'invalid';
    }
    return interpretation.event?.kind ?? null;
  });
}

describe('ClaudeCodeAdapter.interpretHookEvent', () => {
  it('interpretHookEvent_AskUserQuestionScenario_RequestsInputOnPreToolUse', () => {
    // Arrange
    const fixture: HookFixture = askUserQuestion;

    // Act
    const outcomes = interpretFixture(fixture);

    // Assert: AskUserQuestion arrives as PreToolUse, but means "Wartet" (concept 3, rule 3).
    expect(outcomes).toEqual([
      'conversation-started',
      'prompt-submitted',
      'input-requested',
      'tool-finished',
      'turn-finished',
    ]);
  });

  it('interpretHookEvent_ToolFailureScenario_FinishesToolOnFailure', () => {
    // Arrange
    const fixture: HookFixture = permissionThenToolFailure;

    // Act
    const outcomes = interpretFixture(fixture);

    // Assert: a failed tool resolves "Wartet" like a successful one (concept 3, rule 2).
    expect(outcomes).toEqual([
      'conversation-started',
      'prompt-submitted',
      null,
      'input-requested',
      'tool-finished',
      'turn-finished',
    ]);
  });

  it('interpretHookEvent_StopFailureScenario_FailsTurn', () => {
    // Arrange
    const fixture: HookFixture = stopFailure;

    // Act
    const outcomes = interpretFixture(fixture);

    // Assert
    expect(outcomes).toEqual([
      'conversation-started',
      'prompt-submitted',
      'turn-failed',
      'prompt-submitted',
      'turn-finished',
    ]);
  });

  it('interpretHookEvent_SubagentScenario_CountsSubagentsAndIgnoresTheirEvents', () => {
    // Arrange
    const fixture: HookFixture = subagentForeground;

    // Act
    const outcomes = interpretFixture(fixture);

    // Assert: tool events of the subagent carry agent_id and never touch the status (rule 1).
    expect(outcomes).toEqual([
      'prompt-submitted',
      null, // PreToolUse(Agent) of the main agent
      'subagent-started',
      'tool-finished', // PostToolUse(Agent) of the main agent
      'turn-finished', // the main agent stops while the subagent still runs
      'subagent-stopped', // internal helper agent, never started
      null, // PreToolUse(Glob) of the subagent
      null, // PostToolUse(Glob) of the subagent
      null, // PreToolUse(SubagentHandback) of the subagent
      null, // PostToolUse(SubagentHandback) of the subagent
      'prompt-submitted', // synthetic hand-back
      'subagent-stopped',
      'turn-finished',
      'session-ended',
    ]);
  });

  it('interpretHookEvent_SubagentStartAndStop_CarryTheAgentId', () => {
    // Arrange
    const adapter = createClaudeCodeAdapter();
    const subagentId = 'a0000000000000001';

    // Act
    const started = adapter.interpretHookEvent({
      hook_event_name: 'SubagentStart',
      agent_id: subagentId,
      agent_type: 'general-purpose',
    });
    const stopped = adapter.interpretHookEvent({
      hook_event_name: 'SubagentStop',
      agent_id: subagentId,
      agent_type: 'general-purpose',
    });

    // Assert
    expect(started).toEqual({ ok: true, event: { kind: 'subagent-started', subagentId } });
    expect(stopped).toEqual({ ok: true, event: { kind: 'subagent-stopped', subagentId } });
  });

  it('interpretHookEvent_SessionStartClearResumeScenario_ReplacesConversationOnClear', () => {
    // Arrange
    const fixture: HookFixture = sessionStartClearResume;

    // Act
    const outcomes = interpretFixture(fixture);

    // Assert: a clear does not end the agent session (concept 3, rule 6).
    expect(outcomes).toEqual([
      'conversation-started', // startup
      'prompt-submitted',
      'turn-finished',
      'conversation-replaced', // SessionEnd reason clear
      'conversation-started', // clear, new session_id
      'session-ended', // prompt_input_exit
      'conversation-started', // resume
      'session-ended',
    ]);
  });

  it('interpretHookEvent_SessionStartClearResumeScenario_ReportsEachConversationId', () => {
    // Arrange
    const adapter = createClaudeCodeAdapter();
    const fixture: HookFixture = sessionStartClearResume;

    // Act
    const conversationIds = fixture.events
      .map((payload) => adapter.interpretHookEvent(payload))
      .flatMap((interpretation) =>
        interpretation.ok && interpretation.event?.kind === 'conversation-started'
          ? [interpretation.event.conversationId]
          : [],
      );

    // Assert: the clear brings a new id, resume brings back the first one.
    expect(conversationIds).toEqual([
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002',
      '00000000-0000-4000-8000-000000000001',
    ]);
  });

  it.each(['startup', 'resume', 'clear', 'fork'])(
    'interpretHookEvent_SessionStartWithSource%s_StartsConversation',
    (source) => {
      // Arrange
      const adapter = createClaudeCodeAdapter();

      // Act
      const interpretation = adapter.interpretHookEvent({
        hook_event_name: 'SessionStart',
        session_id: 'conversation-1',
        source,
      });

      // Assert
      expect(interpretation).toEqual({
        ok: true,
        event: { kind: 'conversation-started', conversationId: 'conversation-1' },
      });
    },
  );

  it.each(['compact', 'some-future-source'])(
    'interpretHookEvent_SessionStartWithSource%s_ContinuesConversation',
    (source) => {
      // Arrange: a compaction may happen in the middle of a turn; it must not show "Bereit".
      const adapter = createClaudeCodeAdapter();

      // Act
      const interpretation = adapter.interpretHookEvent({
        hook_event_name: 'SessionStart',
        session_id: 'conversation-1',
        source,
      });

      // Assert
      expect(interpretation).toEqual({
        ok: true,
        event: { kind: 'conversation-continued', conversationId: 'conversation-1' },
      });
    },
  );

  it.each([
    ['clear', 'conversation-replaced'],
    ['resume', 'conversation-replaced'],
    ['logout', 'session-ended'],
    ['prompt_input_exit', 'session-ended'],
    ['other', 'session-ended'],
  ] as const)('interpretHookEvent_SessionEndWithReason%s_LeadsTo%s', (reason, expectedKind) => {
    // Arrange
    const adapter = createClaudeCodeAdapter();

    // Act
    const interpretation = adapter.interpretHookEvent({ hook_event_name: 'SessionEnd', reason });

    // Assert
    expect(interpretation).toEqual({ ok: true, event: { kind: expectedKind } });
  });

  it('interpretHookEvent_PermissionRequestScenario_RequestsInputUntilToolFinished', () => {
    // Arrange
    const fixture: HookFixture = permissionRequest;

    // Act
    const outcomes = interpretFixture(fixture);

    // Assert: PreToolUse of an ordinary tool is irrelevant; the permission request means "Wartet".
    expect(outcomes).toEqual([
      'conversation-started',
      'prompt-submitted',
      null,
      'input-requested',
      'tool-finished',
      'turn-finished',
    ]);
  });

  it.each(ALL_FIXTURE_FILES)('interpretHookEvent_EveryPayloadOf%s_IsValid', (fileName) => {
    // Arrange
    const fixture = JSON.parse(
      readFileSync(new URL(fileName, FIXTURES_DIRECTORY), 'utf8'),
    ) as HookFixture;

    // Act
    const outcomes = interpretFixture(fixture);

    // Assert
    expect(outcomes).not.toContain('invalid');
  });

  it('interpretHookEvent_IrrelevantEvent_IsValidWithoutEvent', () => {
    // Arrange: Argus does not subscribe to Notification, but must not fail on it either.
    const adapter = createClaudeCodeAdapter();

    // Act
    const interpretation = adapter.interpretHookEvent({
      hook_event_name: 'Notification',
      notification_type: 'idle_prompt',
    });

    // Assert
    expect(interpretation).toEqual({ ok: true, event: null });
  });

  it.each([null, 'text', 42, [], {}])(
    'interpretHookEvent_PayloadWithoutEventName%j_IsInvalid',
    (payload) => {
      // Arrange
      const adapter = createClaudeCodeAdapter();

      // Act
      const interpretation = adapter.interpretHookEvent(payload);

      // Assert
      expect(interpretation).toMatchObject({ ok: false, eventName: null });
    },
  );

  it('interpretHookEvent_SessionStartWithoutSessionId_NamesOnlyEventAndPath', () => {
    // Arrange: payloads carry prompts and tool output; none of it may reach the log.
    const adapter = createClaudeCodeAdapter();

    // Act
    const interpretation = adapter.interpretHookEvent({
      hook_event_name: 'SessionStart',
      source: 'startup',
      prompt: 'secret prompt',
    });

    // Assert
    expect(interpretation).toEqual({
      ok: false,
      eventName: 'SessionStart',
      invalidPaths: ['session_id'],
    });
  });

  it.each([
    ['SubagentStart', { agent_id: 42 }, ['agent_id']],
    ['SubagentStop', {}, ['agent_id']],
    ['PreToolUse', {}, ['tool_name']],
    ['SessionEnd', {}, ['reason']],
    ['SessionStart', { session_id: 'conversation-1' }, ['source']],
  ] as const)('interpretHookEvent_%sWithInvalidField_IsInvalid', (eventName, fields, paths) => {
    // Arrange
    const adapter = createClaudeCodeAdapter();

    // Act
    const interpretation = adapter.interpretHookEvent({ hook_event_name: eventName, ...fields });

    // Assert
    expect(interpretation).toEqual({ ok: false, eventName, invalidPaths: paths });
  });

  it('interpretHookEvent_ToolEventOfSubagent_IsIgnoredEvenIfAskUserQuestion', () => {
    // Arrange: only the main agent's question means "Wartet" for the agent session.
    const adapter = createClaudeCodeAdapter();

    // Act
    const interpretation = adapter.interpretHookEvent({
      hook_event_name: 'PreToolUse',
      agent_id: 'a0000000000000001',
      tool_name: 'AskUserQuestion',
    });

    // Assert
    expect(interpretation).toEqual({ ok: true, event: null });
  });
});
