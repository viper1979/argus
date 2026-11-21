import type { AgentSessionStatusSnapshot } from '@shared/domain/agent-session';
import { describe, expect, it } from 'vitest';
import { createFakeLogger } from '../../logging/testing/fake-logger';
import { createStatusTracker } from '../../status/status-tracker';
import { createClaudeCodeAdapter } from './claude-code-adapter';
import askUserQuestion from './fixtures/ask-user-question.json';
import interruptAfterTool from './fixtures/interrupt-after-tool.json';
import interruptBeforeOutput from './fixtures/interrupt-before-output.json';
import interruptDuringTool from './fixtures/interrupt-during-tool.json';
import permissionRequest from './fixtures/permission-request.json';
import permissionThenToolFailure from './fixtures/permission-then-tool-failure.json';
import sessionStartClearResume from './fixtures/session-start-clear-resume.json';
import stopFailure from './fixtures/stop-failure.json';
import subagentBackground from './fixtures/subagent-background.json';
import subagentForeground from './fixtures/subagent-foreground.json';
import subagentToolWhileWaiting from './fixtures/subagent-tool-while-waiting.json';

const AGENT_SESSION_ID = '11111111-1111-4111-8111-111111111111';

/** Stands in for the SessionStart that runs recorded before the spike's SessionStart hook lack. */
const SYNTHETIC_SESSION_START = {
  hook_event_name: 'SessionStart',
  session_id: '00000000-0000-4000-8000-000000000001',
  source: 'startup',
};

/** A fixture file: recorded or hand-built hook payloads of one scenario. */
interface HookFixture {
  readonly events: readonly { readonly hook_event_name: string }[];
}

/** A reported change, shortened to what a test compares: status and subagent count. */
type ReportedChange = readonly [AgentSessionStatusSnapshot['status'], number];

/**
 * Plays a fixture through the Claude Code adapter and the status tracker, like the core will.
 * @param fixture The scenario.
 * @returns Every reported change in order.
 */
function replay(fixture: HookFixture): ReportedChange[] {
  const adapter = createClaudeCodeAdapter();
  const reported: ReportedChange[] = [];
  const tracker = createStatusTracker({
    onStatusChanged: ({ status, subagentCount }) => reported.push([status, subagentCount]),
    logger: createFakeLogger(),
  });
  const hasSessionStart = fixture.events.some((event) => event.hook_event_name === 'SessionStart');
  const payloads = hasSessionStart ? fixture.events : [SYNTHETIC_SESSION_START, ...fixture.events];
  for (const payload of payloads) {
    const interpretation = adapter.interpretHookEvent(payload);
    if (!interpretation.ok) {
      throw new Error(`Invalid fixture payload: ${payload.hook_event_name}`);
    }
    if (interpretation.event !== null) {
      tracker.apply(AGENT_SESSION_ID, interpretation.event);
    }
  }
  return reported;
}

describe('Claude Code hook fixtures through adapter and status tracker', () => {
  it.each([
    ['permission-request', permissionRequest],
    ['ask-user-question', askUserQuestion],
    ['permission-then-tool-failure', permissionThenToolFailure],
  ] as const)('replay_%s_WaitsUntilToolFinishedThenReady', (_name, fixture) => {
    // Arrange: hand-built scenarios, see their `source`.

    // Act
    const reported = replay(fixture);

    // Assert
    expect(reported).toEqual([
      ['ready', 0],
      ['working', 0],
      ['waiting', 0],
      ['working', 0],
      ['ready', 0],
    ]);
  });

  it('replay_SubagentToolWhileWaiting_StaysWaiting', () => {
    // Arrange: hand-built; the subagent keeps running while the main agent waits for the user.

    // Act
    const reported = replay(subagentToolWhileWaiting);

    // Assert: the subagent's PostToolUse must not resolve "Wartet" (concept 3, rules 1 and 2).
    expect(reported).toEqual([
      ['ready', 0],
      ['working', 0],
      ['working', 1],
      ['waiting', 1],
    ]);
  });

  it('replay_StopFailure_FailsAndRecoversWithNextPrompt', () => {
    // Arrange: hand-built scenario.

    // Act
    const reported = replay(stopFailure);

    // Assert
    expect(reported).toEqual([
      ['ready', 0],
      ['working', 0],
      ['failed', 0],
      ['working', 0],
      ['ready', 0],
    ]);
  });

  it.each([
    ['subagent-foreground', subagentForeground],
    ['subagent-background', subagentBackground],
  ] as const)('replay_%s_CountsSubagentAcrossStopOfMainAgent', (_name, fixture) => {
    // Arrange: recorded; the main agent stops while its subagent still runs (concept 3, rule 1).

    // Act
    const reported = replay(fixture);

    // Assert: the helper agent's stop without start changes nothing.
    expect(reported).toEqual([
      ['ready', 0],
      ['working', 0],
      ['working', 1], // SubagentStart
      ['ready', 1], // Stop of the main agent, subagent still running
      ['working', 1], // synthetic hand-back
      ['working', 0], // SubagentStop
      ['ready', 0],
      ['ended', 0],
    ]);
  });

  it('replay_SessionStartClearResume_StaysReadyOverClearAndEndsTwice', () => {
    // Arrange: recorded.

    // Act
    const reported = replay(sessionStartClearResume);

    // Assert: clear and the following SessionStart keep "Bereit", so nothing is reported.
    expect(reported).toEqual([
      ['ready', 0],
      ['working', 0],
      ['ready', 0],
      ['ended', 0], // /exit
      ['ready', 0], // --resume
      ['ended', 0],
    ]);
  });

  it.each([
    [
      'interrupt-after-tool',
      interruptAfterTool,
      [
        ['ready', 0],
        ['working', 0],
        ['ready', 0],
        ['working', 0],
        ['ready', 0],
        ['ended', 0],
      ],
    ],
    [
      'interrupt-during-tool',
      interruptDuringTool,
      [
        ['ready', 0],
        ['working', 0],
        ['ready', 0],
        ['ended', 0],
      ],
    ],
    [
      'interrupt-before-output',
      interruptBeforeOutput,
      [
        ['ready', 0],
        ['working', 0],
        ['ready', 0],
        ['ended', 0],
      ],
    ],
  ] as const)('replay_%s_HooksAloneNeverSeeTheInterrupt', (_name, fixture, expected) => {
    // Arrange: recorded; the interrupt itself sends no hook event (ADR 0005), so the hooks alone
    // show "Arbeitet" until the next prompt's Stop. The terminal signals close that gap.

    // Act
    const reported = replay(fixture);

    // Assert
    expect(reported).toEqual(expected);
  });
});
