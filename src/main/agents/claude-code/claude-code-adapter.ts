import { buildHookUrl, HOOK_SESSION_HEADER, HOOK_TOKEN_HEADER } from '../../hooks/hook-server';
import { quotePowerShellLiteral } from '../../terminals/powershell';
import {
  AGENT_SESSION_ID_VARIABLE,
  AGENT_SESSION_TOKEN_VARIABLE,
} from '../agent-session-environment';
import type { AgentTypeAdapter } from '../agent-type-adapter';
import {
  CLAUDE_HTTP_HOOK_EVENTS,
  claudeHookSettingsSchema,
  MAX_HOOK_TIMEOUT_SECONDS,
} from './claude-hook-settings';

/** Agent type id; also the last path segment of the hook url. */
const AGENT_TYPE = 'claude-code';

/** The Claude Code CLI, found through PATH of the user's PowerShell. */
const CLAUDE_EXECUTABLE = 'claude';

/** Marks the end of the CLI options; everything after it is a positional argument. */
const END_OF_OPTIONS = '--';

/** Prefix of the variables Claude Code reads or sets; compared in upper case. */
const CLAUDE_VARIABLE_PREFIX = 'CLAUDE';

/** Set by Claude Code in every process it starts; marks a surrounding Claude session. */
const SESSION_MARKER_VARIABLE = 'CLAUDECODE';

/** Timeout of the HTTP hooks; small, so an unresponsive server barely delays Claude (ADR 0003). */
const HTTP_HOOK_TIMEOUT_SECONDS = 2;

/** curl gives up after this many seconds, below the command hook timeout. */
const CURL_MAX_TIME_SECONDS = 2;

/** Timeout of the SessionStart command hook; the upper bound, so curl gets its 2 s plus startup. */
const COMMAND_HOOK_TIMEOUT_SECONDS = MAX_HOOK_TIMEOUT_SECONDS;

/**
 * Creates the adapter for Claude Code, the first agent type (issue #7).
 * @returns The adapter.
 */
export function createClaudeCodeAdapter(): AgentTypeAdapter {
  return {
    agentType: AGENT_TYPE,
    hookSettingsSchema: claudeHookSettingsSchema,
    buildStartCommand: ({ hookSettingsPath, startPrompt }) => {
      const command = `${CLAUDE_EXECUTABLE} --settings ${quotePowerShellLiteral(hookSettingsPath)}`;
      // A prompt of only whitespace counts as none (concept 5.3); the text itself stays untrimmed.
      if (startPrompt === null || startPrompt.trim() === '') {
        return command;
      }
      // Claude takes the prompt as positional argument; single quotes keep $, `, " literal.
      // "--" ends the options, otherwise a prompt like "-x …" fails as unknown option (#7 smoke).
      return `${command} ${END_OF_OPTIONS} ${quotePowerShellLiteral(startPrompt)}`;
    },
    shouldRemoveInheritedVariable: (name, inheritedEnvironment) => {
      // Only when Argus itself runs inside a Claude session (development): then every CLAUDE*
      // variable may be a session marker, and new Claude versions add new ones (ADR 0003).
      // Otherwise they are the user's own settings, e.g. CLAUDE_CONFIG_DIR, and must stay.
      const isInsideClaudeSession = Object.keys(inheritedEnvironment).some(
        (storedName) => storedName.toUpperCase() === SESSION_MARKER_VARIABLE,
      );
      return isInsideClaudeSession && name.toUpperCase().startsWith(CLAUDE_VARIABLE_PREFIX);
    },
    buildHookSettings: (port) => {
      const hookUrl = buildHookUrl(port, AGENT_TYPE);
      const httpGroups = [
        {
          hooks: [
            {
              type: 'http' as const,
              url: hookUrl,
              timeout: HTTP_HOOK_TIMEOUT_SECONDS,
              // Claude resolves `$VAR` in headers, but only for variables in allowedEnvVars.
              headers: {
                [HOOK_TOKEN_HEADER]: `$${AGENT_SESSION_TOKEN_VARIABLE}`,
                [HOOK_SESSION_HEADER]: `$${AGENT_SESSION_ID_VARIABLE}`,
              },
              allowedEnvVars: [AGENT_SESSION_TOKEN_VARIABLE, AGENT_SESSION_ID_VARIABLE],
            },
          ] as const,
        },
      ];
      // The command runs in Windows PowerShell, hence `$env:`; `@-` sends stdin unchanged.
      const curlCommand =
        `curl.exe -s -m ${String(CURL_MAX_TIME_SECONDS)} -H 'Content-Type: application/json'` +
        ` -H "${HOOK_TOKEN_HEADER}: $env:${AGENT_SESSION_TOKEN_VARIABLE}"` +
        ` -H "${HOOK_SESSION_HEADER}: $env:${AGENT_SESSION_ID_VARIABLE}"` +
        ` --data-binary '@-' ${hookUrl}`;

      return {
        hooks: {
          ...Object.fromEntries(
            CLAUDE_HTTP_HOOK_EVENTS.map((eventName) => [eventName, httpGroups]),
          ),
          SessionStart: [
            {
              hooks: [
                {
                  type: 'command',
                  shell: 'powershell',
                  timeout: COMMAND_HOOK_TIMEOUT_SECONDS,
                  command: curlCommand,
                },
              ],
            },
          ],
        },
      };
    },
  };
}
