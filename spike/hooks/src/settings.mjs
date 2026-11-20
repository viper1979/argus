import fs from 'node:fs';

/** Events required by ADR 0003, plus a few extra ones that help interpret the results. */
export const HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PermissionRequest',
  'Notification',
  'Stop',
  'StopFailure',
  'SubagentStart',
  'SubagentStop',
  'SessionEnd',
];

/** Environment variables Argus sets on the PTY and that may be interpolated into hooks. */
export const ALLOWED_ENV_VARS = ['ARGUS_SESSION_ID', 'ARGUS_HOOK_PORT'];

/**
 * Builds one HTTP hook handler.
 * The headers deliberately cover `$VAR`, `${VAR}` and a variable that is NOT on the allow list.
 *
 * @param {{ url: string, timeoutSeconds?: number }} options
 * @returns {object}
 */
function buildHttpHandler({ url, timeoutSeconds }) {
  const handler = {
    type: 'http',
    url,
    headers: {
      'X-Argus-Session': '$ARGUS_SESSION_ID',
      'X-Argus-Session-Braced': '${ARGUS_SESSION_ID}',
      'X-Argus-Unlisted': '$ARGUS_UNLISTED',
    },
    allowedEnvVars: ALLOWED_ENV_VARS,
  };
  if (timeoutSeconds !== undefined) {
    handler.timeout = timeoutSeconds;
  }
  return handler;
}

/**
 * Builds the content of the `--settings` file.
 * Each entry in `urls` becomes its own matcher group per event, which lets one run compare
 * a literal URL with an interpolated one (different URLs are not deduplicated by Claude).
 * Separate groups keep one invalid handler from taking its neighbours down.
 * Note: an invalid PreToolUse/PermissionRequest handler still makes Claude ignore the
 * whole settings source, so every URL here must be syntactically valid.
 *
 * @param {{ urls: string[], timeoutSeconds?: number, extraHooks?: Record<string, object[]> }} options
 *   `extraHooks` are appended per event, e.g. command hooks for SessionStart.
 * @returns {object}
 */
export function buildSettings({ urls, timeoutSeconds, extraHooks = {} }) {
  const hooks = {};
  for (const eventName of HOOK_EVENTS) {
    hooks[eventName] = urls.map((url) => ({ hooks: [buildHttpHandler({ url, timeoutSeconds })] }));
  }
  for (const [eventName, groups] of Object.entries(extraHooks)) {
    hooks[eventName] = [...(hooks[eventName] ?? []), ...groups];
  }
  return { hooks };
}

/**
 * Builds command hooks that forward the hook payload (stdin) to the hook server with curl.exe.
 * HTTP hooks are not supported on SessionStart, so this is the only way to receive it.
 * Two variants on different paths: explicit `shell: powershell` and Claude's default shell.
 *
 * @param {number} port
 * @returns {object[]} Matcher groups for one event.
 */
export function buildCurlCommandHookGroups(port) {
  // curl.exe inherits stdin from the hook process directly; `--data-binary @-` sends it unchanged.
  const curlArguments = `-s -m 2 -H 'Content-Type: application/json' --data-binary '@-'`;
  return [
    {
      hooks: [{
        type: 'command',
        shell: 'powershell',
        timeout: 3,
        command: `curl.exe ${curlArguments} -H "X-Argus-Session: $env:ARGUS_SESSION_ID" http://127.0.0.1:${port}/hooks/cmd-powershell`,
      }],
    },
    {
      hooks: [{
        type: 'command',
        timeout: 3,
        // Default shell on Windows is expected to be Git Bash, hence the POSIX variable syntax.
        command: `curl.exe ${curlArguments} -H "X-Argus-Session: $ARGUS_SESSION_ID" http://127.0.0.1:${port}/hooks/cmd-default`,
      }],
    },
  ];
}

/**
 * Writes settings JSON to disk and returns the path.
 *
 * @param {string} filePath
 * @param {object} settings
 * @returns {string}
 */
export function writeSettingsFile(filePath, settings) {
  fs.writeFileSync(filePath, JSON.stringify(settings, null, 2));
  return filePath;
}
