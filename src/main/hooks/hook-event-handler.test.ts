import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { AgentSessionService } from '../agents/agent-session-service';
import type { AgentTypeAdapter } from '../agents/agent-type-adapter';
import { createFakeAgentTypeAdapter } from '../agents/testing/fake-agent-type-adapter';
import type { Logger } from '../logging/logger';
import { createFakeLogger } from '../logging/testing/fake-logger';
import type { StatusTracker } from '../status/status-tracker';
import { createHookEventHandler } from './hook-event-handler';
import type { HookEvent } from './hook-server';

const AGENT_SESSION_ID = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const TASK_ID = '3c9e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a';
/** Header value of an agent session Argus did not start in this app run. */
const UNKNOWN_AGENT_SESSION_ID = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

/** Prompt text that must never reach the log. */
const SECRET_PROMPT = 'geheimer Prompt';

/**
 * Fake interpretation by event name, so the tests check what the core does with the outcome,
 * not Claude's payload format.
 * @param payload The parsed body.
 * @returns The outcome the test scenario needs.
 */
const interpretByName: AgentTypeAdapter['interpretHookEvent'] = (payload) => {
  const { name } = payload as { name: string };
  switch (name) {
    case 'start':
      return { ok: true, event: { kind: 'conversation-started', conversationId: 'conv-1' } };
    case 'compact':
      return { ok: true, event: { kind: 'conversation-continued', conversationId: 'conv-2' } };
    case 'prompt':
      return { ok: true, event: { kind: 'prompt-submitted' } };
    case 'broken':
      return { ok: false, eventName: 'Stop', invalidPaths: ['session_id'] };
    default:
      return { ok: true, event: null };
  }
};

/**
 * Builds a hook event as the hook server delivers it.
 * @param payload The JSON body.
 * @param agentSessionId Header value; `null` if missing.
 * @returns The event.
 */
function hookEvent(payload: unknown, agentSessionId: string | null = AGENT_SESSION_ID): HookEvent {
  return { agentType: 'claude-code', agentSessionId, body: JSON.stringify(payload) };
}

describe('createHookEventHandler', () => {
  let applyStatus: Mock<StatusTracker['apply']>;
  let recordConversationId: Mock<AgentSessionService['recordConversationId']>;
  let logInfo: Mock<Logger['info']>;
  let logWarn: Mock<Logger['warn']>;
  let logError: Mock<Logger['error']>;
  let handle: (event: HookEvent) => Promise<void>;

  beforeEach(() => {
    applyStatus = vi.fn();
    recordConversationId = vi.fn(() => Promise.resolve());
    logInfo = vi.fn();
    logWarn = vi.fn();
    logError = vi.fn();
    handle = createHookEventHandler({
      adapters: {
        'claude-code': createFakeAgentTypeAdapter({ interpretHookEvent: interpretByName }),
      },
      agentSessionService: {
        findTaskId: (agentSessionId) => (agentSessionId === AGENT_SESSION_ID ? TASK_ID : null),
        recordConversationId,
      },
      statusTracker: { apply: applyStatus },
      logger: createFakeLogger({ info: logInfo, warn: logWarn, error: logError }),
    });
  });

  /**
   * Collects everything that was logged, to check that no payload content leaks.
   * @returns All logged arguments as one string.
   */
  function everythingLogged(): string {
    return JSON.stringify([logInfo.mock.calls, logWarn.mock.calls, logError.mock.calls]);
  }

  it('handle_EventOfKnownAgentSession_AppliesItToTracker', async () => {
    // Act
    await handle(hookEvent({ name: 'prompt', prompt: SECRET_PROMPT }));

    // Assert
    expect(applyStatus).toHaveBeenCalledExactlyOnceWith(AGENT_SESSION_ID, {
      kind: 'prompt-submitted',
    });
    expect(everythingLogged()).not.toContain(SECRET_PROMPT);
  });

  it.each([
    ['Start', 'start', 'conv-1'],
    ['Compact', 'compact', 'conv-2'],
  ])(
    'handle_%sEvent_RecordsConversationIdAndAppliesEvent',
    async (_label, name, conversationId) => {
      // Act
      await handle(hookEvent({ name }));

      // Assert: the id is needed to resume; compact only reports it again
      expect(recordConversationId).toHaveBeenCalledExactlyOnceWith(
        AGENT_SESSION_ID,
        conversationId,
      );
      expect(applyStatus).toHaveBeenCalledOnce();
    },
  );

  it('handle_EventWithoutConversationId_RecordsNothing', async () => {
    // Act
    await handle(hookEvent({ name: 'prompt' }));

    // Assert
    expect(recordConversationId).not.toHaveBeenCalled();
  });

  it('handle_IrrelevantEvent_AppliesNothing', async () => {
    // Act: e.g. Notification
    await handle(hookEvent({ name: 'notification' }));

    // Assert
    expect(applyStatus).not.toHaveBeenCalled();
    expect(logWarn).not.toHaveBeenCalled();
  });

  it.each([
    ['Missing', null],
    ['Unknown', UNKNOWN_AGENT_SESSION_ID],
  ])('handle_%sAgentSessionId_WarnsAndIgnores', async (_label, agentSessionId) => {
    // Act
    await handle(hookEvent({ name: 'start', prompt: SECRET_PROMPT }, agentSessionId));

    // Assert: the header comes from a process outside the control of Argus
    expect(applyStatus).not.toHaveBeenCalled();
    expect(recordConversationId).not.toHaveBeenCalled();
    expect(logWarn).toHaveBeenCalledExactlyOnceWith('Hook event of unknown agent session ignored', {
      agentType: 'claude-code',
      agentSessionId,
    });
    expect(everythingLogged()).not.toContain(SECRET_PROMPT);
  });

  it('handle_BodyNotJson_WarnsAndIgnores', async () => {
    // Arrange
    const event: HookEvent = {
      agentType: 'claude-code',
      agentSessionId: AGENT_SESSION_ID,
      body: `{"prompt": "${SECRET_PROMPT}"`,
    };

    // Act
    await handle(event);

    // Assert
    expect(applyStatus).not.toHaveBeenCalled();
    expect(logWarn).toHaveBeenCalledExactlyOnceWith('Hook payload is not valid JSON', {
      agentType: 'claude-code',
      agentSessionId: AGENT_SESSION_ID,
    });
    expect(everythingLogged()).not.toContain(SECRET_PROMPT);
  });

  it('handle_InvalidPayload_WarnsWithEventNameAndPathsOnly', async () => {
    // Act
    await handle(hookEvent({ name: 'broken', prompt: SECRET_PROMPT }));

    // Assert
    expect(applyStatus).not.toHaveBeenCalled();
    expect(logWarn).toHaveBeenCalledExactlyOnceWith('Invalid hook payload ignored', {
      agentType: 'claude-code',
      agentSessionId: AGENT_SESSION_ID,
      eventName: 'Stop',
      invalidPaths: ['session_id'],
    });
    expect(everythingLogged()).not.toContain(SECRET_PROMPT);
  });

  it('handle_RecordingConversationIdFails_LogsErrorAndStillAppliesStatus', async () => {
    // Arrange: e.g. state.json locked by a virus scanner
    const saveError = new Error('EBUSY: resource busy or locked');
    recordConversationId.mockRejectedValueOnce(saveError);

    // Act
    const handled = handle(hookEvent({ name: 'start' }));

    // Assert: the status does not depend on the file
    await expect(handled).resolves.toBeUndefined();
    expect(applyStatus).toHaveBeenCalledOnce();
    expect(logError).toHaveBeenCalledExactlyOnceWith('Could not record conversation id', {
      agentSessionId: AGENT_SESSION_ID,
      error: saveError,
    });
  });
});
