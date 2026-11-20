import { z } from 'zod';

/**
 * Upper bound for every hook timeout in seconds. A hook server that does not answer delays
 * `UserPromptSubmit` and `SessionEnd` by the full timeout (ADR 0003).
 */
export const MAX_HOOK_TIMEOUT_SECONDS = 3;

/** Events Claude Code sends as HTTP hooks to Argus (ADR 0003). */
export const CLAUDE_HTTP_HOOK_EVENTS = [
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

/** Event that supports no HTTP hooks and is therefore forwarded by a `curl.exe` command hook. */
export const CLAUDE_COMMAND_HOOK_EVENT = 'SessionStart';

const hookTimeoutSchema = z.number().int().min(1).max(MAX_HOOK_TIMEOUT_SECONDS);

/** One HTTP hook; posts the payload directly to the hook server. */
const httpHookSchema = z
  .object({
    type: z.literal('http'),
    // The port must be a literal number: Claude does not resolve `$VAR` in the url (ADR 0003).
    url: z.string().regex(/^http:\/\/127\.0\.0\.1:\d{1,5}\/hooks\/[a-z-]+$/),
    timeout: hookTimeoutSchema,
    headers: z.record(z.string(), z.string()),
    allowedEnvVars: z.array(z.string().min(1)),
  })
  .strict();

/** The command hook for SessionStart; runs `curl.exe` in Windows PowerShell. */
const commandHookSchema = z
  .object({
    type: z.literal('command'),
    shell: z.literal('powershell'),
    timeout: hookTimeoutSchema,
    command: z.string().min(1),
  })
  .strict();

/**
 * A matcher group as Claude expects it. One handler per group, so the schema stays as narrow as
 * the file Argus actually writes.
 * @param handlerSchema Schema of the single handler in the group.
 * @returns Schema of an event's list of groups.
 */
function hookGroupsSchema<THandler extends z.ZodType>(handlerSchema: THandler) {
  return z.tuple([z.object({ hooks: z.tuple([handlerSchema]) }).strict()]);
}

/** An event Claude Code sends as HTTP hook. */
export type ClaudeHttpHookEvent = (typeof CLAUDE_HTTP_HOOK_EVENTS)[number];

const httpHookGroupsSchema = hookGroupsSchema(httpHookSchema);

// Object.fromEntries loses the key type; the keys are exactly CLAUDE_HTTP_HOOK_EVENTS.
const httpHookEventsShape = Object.fromEntries(
  CLAUDE_HTTP_HOOK_EVENTS.map((eventName) => [eventName, httpHookGroupsSchema]),
) as Record<ClaudeHttpHookEvent, typeof httpHookGroupsSchema>;

/**
 * Hook settings file passed to `claude --settings`. Strict on purpose: one invalid `PreToolUse`
 * or `PermissionRequest` hook makes Claude ignore the whole file (ADR 0003).
 */
export const claudeHookSettingsSchema = z
  .object({
    hooks: z
      .object({
        ...httpHookEventsShape,
        [CLAUDE_COMMAND_HOOK_EVENT]: hookGroupsSchema(commandHookSchema),
      })
      .strict(),
  })
  .strict();

/** Content of the hook settings file for Claude Code. */
export type ClaudeHookSettings = z.infer<typeof claudeHookSettingsSchema>;
