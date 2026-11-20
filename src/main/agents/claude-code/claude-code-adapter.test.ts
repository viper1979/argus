import { describe, expect, it } from 'vitest';
import { createClaudeCodeAdapter } from './claude-code-adapter';
import { claudeHookSettingsSchema, type ClaudeHookSettings } from './claude-hook-settings';

/** Port of the example in concept 5.3. */
const HOOK_SERVER_PORT = 51234;

/**
 * Events that support HTTP hooks (ADR 0003); SessionStart is not among them. A deliberate copy of
 * CLAUDE_HTTP_HOOK_EVENTS: as independent oracle it catches an event dropped from the code list.
 */
const HTTP_HOOK_EVENTS = [
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PermissionRequest',
  'Stop',
  'StopFailure',
  'SubagentStart',
  'SubagentStop',
  'SessionEnd',
] as const;

/**
 * Builds the hook settings and validates them like the core does before writing.
 * @returns The typed settings; throws if the schema rejects them.
 */
function buildValidatedHookSettings(): ClaudeHookSettings {
  return claudeHookSettingsSchema.parse(
    createClaudeCodeAdapter().buildHookSettings(HOOK_SERVER_PORT),
  );
}

describe('createClaudeCodeAdapter', () => {
  it('buildHookSettings_WithPort_PassesItsStrictSchema', () => {
    // Arrange
    const adapter = createClaudeCodeAdapter();

    // Act
    const result = adapter.hookSettingsSchema.safeParse(
      adapter.buildHookSettings(HOOK_SERVER_PORT),
    );

    // Assert: an invalid PreToolUse or PermissionRequest hook would disable the whole file
    expect(result.success).toBe(true);
  });

  it('buildHookSettings_WithPort_PostsEveryHttpEventToHookServer', () => {
    // Arrange
    // Expected handler from concept 5.3: port as number in the url, token and session via headers.
    const expectedGroups = [
      {
        hooks: [
          {
            type: 'http',
            url: 'http://127.0.0.1:51234/hooks/claude-code',
            timeout: 2,
            headers: {
              'X-Argus-Token': '$ARGUS_TOKEN',
              'X-Argus-Session': '$ARGUS_SESSION_ID',
            },
            allowedEnvVars: ['ARGUS_TOKEN', 'ARGUS_SESSION_ID'],
          },
        ],
      },
    ];

    // Act
    const settings = buildValidatedHookSettings();

    // Assert
    for (const eventName of HTTP_HOOK_EVENTS) {
      expect(settings.hooks[eventName], eventName).toEqual(expectedGroups);
    }
  });

  it('buildHookSettings_WithPort_ForwardsSessionStartPerCurlCommand', () => {
    // Arrange
    // SessionStart supports no HTTP hooks; curl.exe passes the payload from stdin on unchanged.
    const expectedCommand =
      "curl.exe -s -m 2 -H 'Content-Type: application/json'" +
      ' -H "X-Argus-Token: $env:ARGUS_TOKEN" -H "X-Argus-Session: $env:ARGUS_SESSION_ID"' +
      " --data-binary '@-' http://127.0.0.1:51234/hooks/claude-code";

    // Act
    const settings = buildValidatedHookSettings();

    // Assert
    expect(settings.hooks.SessionStart).toEqual([
      { hooks: [{ type: 'command', shell: 'powershell', timeout: 3, command: expectedCommand }] },
    ]);
  });
});

/** Hook settings path as Argus writes it below %APPDATA%. */
const HOOK_SETTINGS_PATH = 'C:\\Users\\Viper\\AppData\\Roaming\\Argus\\hooks\\claude-code.json';

/** {@link HOOK_SETTINGS_PATH} as PowerShell literal; contains no ', so nothing is doubled. */
const QUOTED_HOOK_SETTINGS_PATH =
  "'C:\\Users\\Viper\\AppData\\Roaming\\Argus\\hooks\\claude-code.json'";

describe('ClaudeCodeAdapter.buildStartCommand', () => {
  it('buildStartCommand_WithoutStartPrompt_StartsClaudeWithQuotedHookSettings', () => {
    // Arrange
    const adapter = createClaudeCodeAdapter();

    // Act
    const command = adapter.buildStartCommand({
      hookSettingsPath: HOOK_SETTINGS_PATH,
      startPrompt: null,
    });

    // Assert
    expect(command).toBe(`claude --settings ${QUOTED_HOOK_SETTINGS_PATH}`);
  });

  it('buildStartCommand_WithSpecialCharactersInStartPrompt_PassesThemLiterally', () => {
    // Arrange: characters the spike for ADR 0003 checked; only ' needs escaping (doubled)
    const adapter = createClaudeCodeAdapter();
    const startPrompt = 'Sag "Hallo", it\'s $HOME ${x} `n € ä % & | < >';

    // Act
    const command = adapter.buildStartCommand({
      hookSettingsPath: HOOK_SETTINGS_PATH,
      startPrompt,
    });

    // Assert
    expect(command).toBe(
      `claude --settings ${QUOTED_HOOK_SETTINGS_PATH} --` +
        " 'Sag \"Hallo\", it''s $HOME ${x} `n € ä % & | < >'",
    );
  });

  it('buildStartCommand_WithStartPromptStartingWithDash_EndsOptionsBeforePrompt', () => {
    // Arrange: without "--" Claude fails with "error: unknown option '-x …'" (smoke for #7)
    const adapter = createClaudeCodeAdapter();

    // Act
    const command = adapter.buildStartCommand({
      hookSettingsPath: HOOK_SETTINGS_PATH,
      startPrompt: '-x Antworte nur mit OK.',
    });

    // Assert
    expect(command).toBe(
      `claude --settings ${QUOTED_HOOK_SETTINGS_PATH} -- '-x Antworte nur mit OK.'`,
    );
  });

  it('buildStartCommand_WithBlankStartPrompt_StartsWithoutPrompt', () => {
    // Arrange: the dialog may send whitespace only; Claude must not get a prompt without content
    const adapter = createClaudeCodeAdapter();

    // Act
    const command = adapter.buildStartCommand({
      hookSettingsPath: HOOK_SETTINGS_PATH,
      startPrompt: ' \t\r\n ',
    });

    // Assert
    expect(command).toBe(`claude --settings ${QUOTED_HOOK_SETTINGS_PATH}`);
  });

  it('buildStartCommand_WithApostropheInHookSettingsPath_DoublesIt', () => {
    // Arrange: %APPDATA% contains the Windows user name, which may contain '
    const adapter = createClaudeCodeAdapter();

    // Act
    const command = adapter.buildStartCommand({
      hookSettingsPath: "C:\\Users\\O'Brien\\AppData\\Roaming\\Argus\\hooks\\claude-code.json",
      startPrompt: null,
    });

    // Assert
    expect(command).toBe(
      "claude --settings 'C:\\Users\\O''Brien\\AppData\\Roaming\\Argus\\hooks\\claude-code.json'",
    );
  });
});

describe('ClaudeCodeAdapter.shouldRemoveInheritedVariable', () => {
  /** Environment of an Argus started from a Claude Code session (development). */
  const insideClaudeSession = {
    CLAUDECODE: '1',
    CLAUDE_CODE_CHILD_SESSION: '1',
    CLAUDE_CONFIG_DIR: 'D:\\claude-config',
    PATH: 'C:\\Windows',
  };

  it('shouldRemoveInheritedVariable_InsideClaudeSession_RemovesClaudeVariables', () => {
    // Arrange: inherited, they make the new Claude a child session without transcript (ADR 0003)
    const adapter = createClaudeCodeAdapter();

    // Act
    const removedNames = Object.keys(insideClaudeSession).filter((name) =>
      adapter.shouldRemoveInheritedVariable(name, insideClaudeSession),
    );

    // Assert
    expect(removedNames).toEqual(['CLAUDECODE', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_CONFIG_DIR']);
  });

  it('shouldRemoveInheritedVariable_OutsideClaudeSession_KeepsUserSettings', () => {
    // Arrange: normal start from Windows; the user's own Claude configuration must stay intact
    const adapter = createClaudeCodeAdapter();
    const userEnvironment = {
      CLAUDE_CONFIG_DIR: 'D:\\claude-config',
      CLAUDE_CODE_USE_BEDROCK: '1',
    };

    // Act
    const removedNames = Object.keys(userEnvironment).filter((name) =>
      adapter.shouldRemoveInheritedVariable(name, userEnvironment),
    );

    // Assert
    expect(removedNames).toEqual([]);
  });

  it('shouldRemoveInheritedVariable_WithMixedCaseNames_IgnoresCase', () => {
    // Arrange: Windows variable names are case-insensitive (ADR 0002)
    const adapter = createClaudeCodeAdapter();
    const mixedCaseEnvironment = { ClaudeCode: '1', claude_code_entrypoint: 'cli' };

    // Act
    const removedNames = Object.keys(mixedCaseEnvironment).filter((name) =>
      adapter.shouldRemoveInheritedVariable(name, mixedCaseEnvironment),
    );

    // Assert
    expect(removedNames).toEqual(['ClaudeCode', 'claude_code_entrypoint']);
  });
});
