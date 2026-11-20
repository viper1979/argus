import { describe, expect, it } from 'vitest';
import { createClaudeCodeAdapter } from './claude-code-adapter';
import { claudeHookSettingsSchema, type ClaudeHookSettings } from './claude-hook-settings';

/**
 * A valid file as the adapter builds it; each test breaks exactly one rule. Cloned, so tests
 * cannot affect each other.
 * @returns A fresh, valid hook settings object.
 */
function buildValidSettings(): ClaudeHookSettings {
  return structuredClone(
    claudeHookSettingsSchema.parse(createClaudeCodeAdapter().buildHookSettings(HOOK_SERVER_PORT)),
  );
}

/** Any valid port; the schema only checks that it is a literal number in the url. */
const HOOK_SERVER_PORT = 51234;

describe('claudeHookSettingsSchema', () => {
  it('safeParse_WithTimeoutAboveThreeSeconds_Rejects', () => {
    // Arrange: a hook server that hangs would delay every prompt by the full timeout
    const settings = buildValidSettings();
    settings.hooks.Stop[0].hooks[0].timeout = 4;

    // Act
    const result = claudeHookSettingsSchema.safeParse(settings);

    // Assert
    expect(result.success).toBe(false);
  });

  it('safeParse_WithVariableAsPortInUrl_Rejects', () => {
    // Arrange: Claude does not resolve $VAR in the url (ADR 0003)
    const settings = buildValidSettings();
    settings.hooks.PreToolUse[0].hooks[0].url = 'http://127.0.0.1:$ARGUS_PORT/hooks/claude-code';

    // Act
    const result = claudeHookSettingsSchema.safeParse(settings);

    // Assert
    expect(result.success).toBe(false);
  });

  it('safeParse_WithHttpHookForSessionStart_Rejects', () => {
    // Arrange: Claude silently ignores HTTP hooks on SessionStart
    const settings = buildValidSettings();
    const httpHandler = settings.hooks.Stop[0].hooks[0];

    // Act
    const result = claudeHookSettingsSchema.safeParse({
      hooks: { ...settings.hooks, SessionStart: [{ hooks: [httpHandler] }] },
    });

    // Assert
    expect(result.success).toBe(false);
  });

  it('safeParse_WithMissingEvent_Rejects', () => {
    // Arrange: without PermissionRequest Argus would never see "Wartet"
    const hooksWithoutPermissionRequest = Object.fromEntries(
      Object.entries(buildValidSettings().hooks).filter(
        ([eventName]) => eventName !== 'PermissionRequest',
      ),
    );

    // Act
    const result = claudeHookSettingsSchema.safeParse({ hooks: hooksWithoutPermissionRequest });

    // Assert
    expect(result.success).toBe(false);
  });

  it('safeParse_WithUnknownHandlerField_Rejects', () => {
    // Arrange: an unexpected field can make Claude discard the whole file (ADR 0003)
    const settings = buildValidSettings();

    // Act
    const result = claudeHookSettingsSchema.safeParse({
      hooks: {
        ...settings.hooks,
        PermissionRequest: [
          { hooks: [{ ...settings.hooks.PermissionRequest[0].hooks[0], async: true }] },
        ],
      },
    });

    // Assert
    expect(result.success).toBe(false);
  });
});
