import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { startHookServer, reserveClosedPort } from './hook-server.mjs';
import { buildSettings, buildCurlCommandHookGroups, writeSettingsFile } from './settings.mjs';
import { startPowerShellSession, quotePowerShellLiteral, waitFor, delay } from './pty-session.mjs';
import { withTemporaryUserHook } from './user-settings.mjs';

/** Cheap model for all spike runs; the behaviour under test does not depend on the model. */
const MODEL = 'haiku';

/** Upper bound for a normal Claude turn including startup. */
const TURN_TIMEOUT_MS = 120_000;
/** Upper bound for a turn that spawns a subagent. */
const SUBAGENT_TURN_TIMEOUT_MS = 240_000;
/** How long we wait for SessionEnd after an exit action. */
const SESSION_END_TIMEOUT_MS = 15_000;
/** Hook timeout (seconds) used in the "hanging server" latency variant. */
const HANGING_HOOK_TIMEOUT_SECONDS = 3;

/** Prompt with every character class the issue asks about: quotes, `$`, umlauts, plus a few extra. */
export const SPECIAL_CHARACTER_PROMPT =
  'Antworte nur mit OK. Test: "doppelt" \'einfach\' $HOME $env:PATH ${x} äöüÄÖÜß € `backtick` 100% & | < > ; # @(1)';

/** Prompt whose answer contains a marker that does not appear in the prompt itself. */
const MARKER_PROMPT =
  'Antworte ausschließlich mit dem Ergebnis von 17*3, direkt gefolgt von den Buchstaben XYZ, ohne Leerzeichen.';
const MARKER_ANSWER = '51XYZ';

/**
 * Prepares the run directory, hook server, settings file and PowerShell session for one scenario.
 *
 * @param {object} options
 * @param {string} options.name Scenario name, used for the output folder.
 * @param {string} options.runRoot Root folder for all output of this run.
 * @param {string} options.cwd Working directory for Claude.
 * @param {string} [options.prompt] Start prompt passed as CLI argument.
 * @param {'respond'|'hang'} [options.serverMode]
 * @param {(port: number) => string[]} [options.buildUrls] Hook URLs per handler, given the server port.
 * @param {number} [options.hookPortOverride] Port to put into the URLs instead of the server port.
 * @param {number} [options.timeoutSeconds] Hook timeout.
 * @param {(port: number) => Record<string, object[]>} [options.buildExtraHooks] Additional hook groups per event.
 */
async function startScenario(options) {
  const {
    name, runRoot, cwd, prompt, serverMode = 'respond',
    buildUrls = (port) => [`http://127.0.0.1:${port}/hooks/claude`],
    hookPortOverride, timeoutSeconds, buildExtraHooks = () => ({}),
  } = options;

  const scenarioDir = path.join(runRoot, name);
  fs.mkdirSync(scenarioDir, { recursive: true });

  const server = await startHookServer({ logFile: path.join(scenarioDir, 'events.jsonl'), mode: serverMode });
  const hookPort = hookPortOverride ?? server.port;
  const settingsPath = writeSettingsFile(
    path.join(scenarioDir, 'settings.json'),
    buildSettings({ urls: buildUrls(hookPort), timeoutSeconds, extraHooks: buildExtraHooks(hookPort) }),
  );

  const sessionId = randomUUID();
  const promptArgument = prompt === undefined ? '' : ` ${quotePowerShellLiteral(prompt)}`;
  const script = `claude --model ${MODEL} --settings ${quotePowerShellLiteral(settingsPath)}${promptArgument}`;
  fs.writeFileSync(path.join(scenarioDir, 'command.ps1'), script);

  const session = startPowerShellSession({
    script,
    cwd,
    env: { ARGUS_SESSION_ID: sessionId, ARGUS_HOOK_PORT: String(hookPort), ARGUS_UNLISTED: 'must-not-appear' },
    outputLogFile: path.join(scenarioDir, 'pty-output.log'),
  });

  /**
   * Finds the first recorded event matching name and an optional predicate.
   * @param {string} eventName
   * @param {(event: object) => boolean} [predicate]
   */
  const findEvent = (eventName, predicate = () => true) =>
    server.events.find((event) => event.hookEventName === eventName && predicate(event));

  return { name, scenarioDir, server, session, sessionId, hookPort, settingsPath, findEvent };
}

/** Claude's title glyph while idle; while working it shows a spinner (◐ ◑ ◒ ◓ ...). */
const CLAUDE_IDLE_TITLE_GLYPH = '✳';

/**
 * Measures how long after `since` the terminal title first switched to Claude's idle glyph.
 *
 * @param {{ titles: { at: number, title: string }[] }} session
 * @param {number} since Timestamp of the key press.
 * @returns {{ msToIdleTitle: number | null, titlesAfter: string[] }}
 */
function measureIdleTitleAfter(session, since) {
  const titlesAfter = session.titles.filter((entry) => entry.at >= since);
  const idleTitle = titlesAfter.find((entry) => entry.title.trimStart().startsWith(CLAUDE_IDLE_TITLE_GLYPH));
  return {
    msToIdleTitle: idleTitle ? idleTitle.at - since : null,
    titlesAfter: titlesAfter.slice(0, 5).map((entry) => entry.title),
  };
}

/**
 * Stops the PTY and server and writes a summary with a relative timeline.
 *
 * @param {Awaited<ReturnType<typeof startScenario>>} context
 * @param {object} findings Scenario-specific findings to store next to the timeline.
 */
async function finishScenario(context, findings) {
  context.session.kill();
  await delay(500);
  await context.server.close();

  const timeline = context.server.events.map((event) => ({
    t: event.receivedAt - context.session.startedAt,
    event: event.hookEventName,
    url: event.url,
    agentId: event.body.agent_id,
    agentType: event.body.agent_type,
    tool: event.body.tool_name,
    reason: event.body.reason,
  }));
  const titleTimeline = context.session.titles.map((entry) => ({
    t: entry.at - context.session.startedAt,
    title: entry.title,
  }));
  const summary = { scenario: context.name, sessionId: context.sessionId, findings, timeline, titleTimeline };
  fs.writeFileSync(path.join(context.scenarioDir, 'summary.json'), JSON.stringify(summary, null, 2));
  return summary;
}

/**
 * Scenario `basic`: special-character prompt, URL/header interpolation, `/exit`.
 * Two handlers per event: one literal URL (control), one with `$ARGUS_HOOK_PORT` and
 * `$ARGUS_SESSION_ID` in the URL. If interpolation in `url` fails, only the control arrives.
 */
async function runBasic(runOptions) {
  const context = await startScenario({
    ...runOptions,
    name: 'basic',
    prompt: SPECIAL_CHARACTER_PROMPT,
    // `$VAR` as port makes the URL invalid (verified in a first run: "Invalid URL", and the
    // whole settings file was ignored). So interpolation is tested in the query string only.
    buildUrls: (port) => [
      `http://127.0.0.1:${port}/hooks/literal`,
      `http://127.0.0.1:${port}/hooks/interpolated?plain=$ARGUS_SESSION_ID&braced=\${ARGUS_SESSION_ID}`,
    ],
  });
  const stop = await waitFor(() => context.findEvent('Stop'), TURN_TIMEOUT_MS);
  await context.session.typeLine('/exit');
  const sessionEnd = await waitFor(() => context.findEvent('SessionEnd'), SESSION_END_TIMEOUT_MS);

  const promptEvent = context.findEvent('UserPromptSubmit');
  const literalEvent = context.server.events.find((event) => event.url.startsWith('/hooks/literal'));
  const interpolatedEvents = context.server.events.filter((event) => event.url.startsWith('/hooks/interpolated'));
  return finishScenario(context, {
    gotStop: Boolean(stop),
    sessionEndAfterExit: sessionEnd?.body.reason ?? null,
    promptReceived: promptEvent?.body.prompt ?? null,
    promptMatches: promptEvent?.body.prompt === SPECIAL_CHARACTER_PROMPT,
    headersOnLiteralUrl: literalEvent?.headers ?? null,
    expectedSessionId: context.sessionId,
    interpolatedUrlEventCount: interpolatedEvents.length,
    interpolatedUrlSample: interpolatedEvents[0]?.url ?? null,
    hasAgentIdOnMainEvents: context.server.events.some((event) => event.body.agent_id),
  });
}

/**
 * Scenario `subagent-foreground` / `subagent-background`: does a subagent's hook traffic carry
 * `agent_id`, and in which order do Stop, SubagentStop and the hand-back arrive?
 *
 * @param {object} runOptions
 * @param {boolean} runInBackground
 */
async function runSubagent(runOptions, runInBackground) {
  const context = await startScenario({
    ...runOptions,
    name: runInBackground ? 'subagent-background' : 'subagent-foreground',
    prompt:
      `Starte mit dem Agent-Tool genau einen Subagent (subagent_type general-purpose, run_in_background ${runInBackground}). ` +
      'Der Subagent soll mit dem Glob-Tool alle Dateien im aktuellen Verzeichnis auflisten und die Anzahl melden. ' +
      'Gib danach nur die Anzahl aus.',
  });
  // A background subagent hands back in a second turn, so wait for the Stop that follows SubagentStop.
  const finalStop = await waitFor(() => {
    const subagentStop = context.findEvent('SubagentStop');
    return subagentStop && context.findEvent('Stop', (event) => event.receivedAt > subagentStop.receivedAt);
  }, SUBAGENT_TURN_TIMEOUT_MS);
  const mainStop = context.findEvent('Stop');
  await context.session.typeLine('/exit');
  await waitFor(() => context.findEvent('SessionEnd'), SESSION_END_TIMEOUT_MS);

  const subagentEvents = context.server.events.filter((event) => event.body.agent_id);
  return finishScenario(context, {
    gotMainStop: Boolean(mainStop),
    gotStopAfterSubagentStop: Boolean(finalStop),
    syntheticPrompts: context.server.events
      .filter((event) => event.hookEventName === 'UserPromptSubmit')
      .map((event) => String(event.body.prompt).slice(0, 60)),
    subagentStart: context.findEvent('SubagentStart')?.body ?? null,
    subagentStop: context.findEvent('SubagentStop')?.body ?? null,
    eventsWithAgentId: subagentEvents.map((event) => `${event.hookEventName}:${event.body.tool_name ?? ''}`),
    mainEventsWithoutAgentId: context.server.events
      .filter((event) => !event.body.agent_id)
      .map((event) => `${event.hookEventName}:${event.body.tool_name ?? ''}`),
  });
}

/** Scenario `escape`: interrupt a running turn with Escape, then `/exit`. */
async function runEscape(runOptions) {
  const context = await startScenario({
    ...runOptions,
    name: 'escape',
    prompt: 'Schreibe die Zahlen von 1 bis 400 als ausgeschriebene deutsche Wörter, jede in eine eigene Zeile.',
  });
  await waitFor(() => context.findEvent('UserPromptSubmit'), TURN_TIMEOUT_MS);
  await delay(4000);
  const eventCountBeforeEscape = context.server.events.length;
  const titleBeforeEscape = context.session.titles.at(-1)?.title ?? null;
  const escapePressedAt = Date.now();
  context.session.write('\x1b');
  await delay(10_000);
  const eventsAfterEscape = context.server.events.slice(eventCountBeforeEscape).map((event) => ({
    event: event.hookEventName,
    msAfterEscape: event.receivedAt - escapePressedAt,
  }));
  const titleAfterEscape = measureIdleTitleAfter(context.session, escapePressedAt);

  // A follow-up prompt shows whether the session continues normally after the interrupt.
  await context.session.typeLine('Antworte nur mit OK.');
  const followUpStop = await waitFor(
    () => context.server.events.filter((event) => event.hookEventName === 'Stop').at(-1),
    TURN_TIMEOUT_MS,
  );
  await context.session.typeLine('/exit');
  await waitFor(() => context.findEvent('SessionEnd'), SESSION_END_TIMEOUT_MS);

  return finishScenario(context, {
    stopBeforeEscape: context.server.events.slice(0, eventCountBeforeEscape).some((e) => e.hookEventName === 'Stop'),
    eventsWithin10sAfterEscape: eventsAfterEscape,
    titleBeforeEscape,
    ...titleAfterEscape,
    followUpTurnGotStop: Boolean(followUpStop),
    interruptVisibleInOutput: /Interrupted/i.test(context.session.getPlainOutput()),
  });
}

/**
 * Scenario `escape-tool`: Escape while a long-running tool call is executing.
 * This is the most realistic interrupt: the agent is busy in a tool, the user cancels.
 */
async function runEscapeDuringTool(runOptions) {
  const context = await startScenario({
    ...runOptions,
    name: 'escape-tool',
    // Claude moves long commands to the background on its own, and blocks plain sleeps as
    // "waiting" — so use a real long-running command and demand foreground explicitly.
    prompt:
      'Führe genau diesen Befehl mit deinem Shell-Tool im Vordergrund aus ' +
      '(run_in_background false, nicht im Hintergrund) und sonst nichts: ping -n 30 127.0.0.1',
  });
  const toolStart = await waitFor(() => context.findEvent('PreToolUse'), TURN_TIMEOUT_MS);
  await delay(3000);
  const toolStillRunningAtEscape = !context.findEvent('PostToolUse') && !context.findEvent('Stop');
  const eventCountBeforeEscape = context.server.events.length;
  const escapePressedAt = Date.now();
  const titleBeforeEscape = context.session.titles.at(-1)?.title ?? null;
  context.session.write('\x1b');
  await delay(10_000);
  const eventsAfterEscape = context.server.events.slice(eventCountBeforeEscape).map((event) => ({
    event: event.hookEventName,
    tool: event.body.tool_name,
    msAfterEscape: event.receivedAt - escapePressedAt,
  }));
  const titleAfterEscape = measureIdleTitleAfter(context.session, escapePressedAt);

  await context.session.typeLine('Antworte nur mit OK.');
  const followUpStop = await waitFor(() => context.findEvent('Stop'), TURN_TIMEOUT_MS);
  await context.session.typeLine('/exit');
  await waitFor(() => context.findEvent('SessionEnd'), SESSION_END_TIMEOUT_MS);

  return finishScenario(context, {
    toolThatWasRunning: toolStart?.body.tool_name ?? null,
    toolStillRunningAtEscape,
    permissionRequested: Boolean(context.findEvent('PermissionRequest')),
    eventsWithin10sAfterEscape: eventsAfterEscape,
    titleBeforeEscape,
    ...titleAfterEscape,
    followUpTurnGotStop: Boolean(followUpStop),
  });
}

/**
 * Scenario `ctrlc`: Ctrl+C while working (interrupt) and then twice while idle (exit).
 */
async function runCtrlC(runOptions) {
  const context = await startScenario({
    ...runOptions,
    name: 'ctrlc',
    prompt: 'Schreibe die Zahlen von 1 bis 400 als ausgeschriebene deutsche Wörter, jede in eine eigene Zeile.',
  });
  await waitFor(() => context.findEvent('UserPromptSubmit'), TURN_TIMEOUT_MS);
  await delay(4000);

  const countBeforeBusyCtrlC = context.server.events.length;
  const titleBeforeBusyCtrlC = context.session.titles.at(-1)?.title ?? null;
  const busyCtrlCAt = Date.now();
  context.session.write('\x03');
  await delay(8000);
  const eventsAfterBusyCtrlC = context.server.events.slice(countBeforeBusyCtrlC).map((event) => ({
    event: event.hookEventName,
    msAfterCtrlC: event.receivedAt - busyCtrlCAt,
  }));
  const titleAfterBusyCtrlC = measureIdleTitleAfter(context.session, busyCtrlCAt);

  const countBeforeIdleCtrlC = context.server.events.length;
  const idleCtrlCAt = Date.now();
  context.session.write('\x03');
  await delay(400);
  context.session.write('\x03');
  const sessionEnd = await waitFor(() => context.findEvent('SessionEnd'), SESSION_END_TIMEOUT_MS);
  const eventsAfterIdleCtrlC = context.server.events.slice(countBeforeIdleCtrlC).map((event) => ({
    event: event.hookEventName,
    reason: event.body.reason,
    msAfterCtrlC: event.receivedAt - idleCtrlCAt,
  }));

  return finishScenario(context, {
    eventsWithin8sAfterBusyCtrlC: eventsAfterBusyCtrlC,
    titleBeforeBusyCtrlC,
    titleAfterBusyCtrlC,
    eventsAfterDoubleIdleCtrlC: eventsAfterIdleCtrlC,
    sessionEndReason: sessionEnd?.body.reason ?? null,
    powershellStillAlive: !context.session.hasExited(),
  });
}

/**
 * Scenario `user-hook`: a hook in ~/.claude/settings.json (path /hooks/user) plus the
 * `--settings` hooks (path /hooks/claude). Both paths must receive events.
 */
async function runUserHook(runOptions) {
  // The user hook needs the port before the scenario starts, so we pin the server port up front.
  const userHookPort = await reserveClosedPort();
  const userHookUrl = `http://127.0.0.1:${userHookPort}/hooks/user`;
  return withTemporaryUserHook({ hookUrl: userHookUrl, backupDir: runOptions.runRoot }, async () => {
    const scenarioDir = path.join(runOptions.runRoot, 'user-hook');
    fs.mkdirSync(scenarioDir, { recursive: true });
    const userServer = await startHookServer({ logFile: path.join(scenarioDir, 'user-events.jsonl'), port: userHookPort });
    try {
      const context = await startScenario({ ...runOptions, name: 'user-hook', prompt: 'Antworte nur mit OK.' });
      await waitFor(() => context.findEvent('Stop'), TURN_TIMEOUT_MS);
      await context.session.typeLine('/exit');
      await waitFor(() => context.findEvent('SessionEnd'), SESSION_END_TIMEOUT_MS);
      await delay(1000);

      // Only count user-hook events from the spike session, not from other Claude sessions on this machine.
      const spikeSessionIds = new Set(context.server.events.map((event) => event.body.session_id));
      const userEventsOfSpikeSession = userServer.events.filter((event) => spikeSessionIds.has(event.body.session_id));
      return finishScenario(context, {
        settingsFlagEvents: context.server.events.map((event) => event.hookEventName),
        userHookEventsOfSpikeSession: userEventsOfSpikeSession.map((event) => event.hookEventName),
        userHookEventsFromOtherSessions: userServer.events.length - userEventsOfSpikeSession.length,
      });
    } finally {
      await userServer.close();
    }
  });
}

/**
 * Scenario `latency`: the same marker prompt against a reachable, an unreachable (connection
 * refused) and a hanging hook URL. Measures time from start to the answer and from `/exit` to SessionEnd/shell.
 */
async function runLatency(runOptions) {
  const variants = [
    { variant: 'reachable' },
    { variant: 'refused', hookPortOverride: await reserveClosedPort() },
    { variant: 'hanging', serverMode: 'hang', timeoutSeconds: HANGING_HOOK_TIMEOUT_SECONDS },
  ];
  const results = [];
  for (const { variant, ...variantOptions } of variants) {
    console.log(`  latency variant: ${variant}`);
    const context = await startScenario({ ...runOptions, ...variantOptions, name: `latency-${variant}`, prompt: MARKER_PROMPT });
    const answerSeen = await waitFor(() => context.session.getPlainOutput().includes(MARKER_ANSWER), TURN_TIMEOUT_MS);
    const msToAnswer = answerSeen ? Date.now() - context.session.startedAt : null;

    await delay(2000);
    const exitAt = Date.now();
    const outputLengthAtExit = context.session.getPlainOutput().length;
    await context.session.typeLine('/exit');
    // After Claude exits, PowerShell prints its prompt ("PS <path>>") again.
    const shellBack = await waitFor(
      () => /PS [A-Z]:\\[^\n]*>/.test(context.session.getPlainOutput().slice(outputLengthAtExit)),
      60_000,
    );
    const msExitToShell = shellBack ? Date.now() - exitAt : null;

    results.push(await finishScenario(context, { variant, msToAnswer, msExitToShell, eventCount: context.server.events.length }));
  }
  return results;
}

/**
 * Scenario `no-prompt`: start without a prompt, idle, `/exit`.
 * The concept relies on SessionStart for "start without prompt → Bereit".
 */
async function runNoPrompt(runOptions) {
  const context = await startScenario({ ...runOptions, name: 'no-prompt' });
  // The input box appearing means Claude is ready; give hooks a moment afterwards.
  await waitFor(() => context.session.getPlainOutput().includes('❯'), TURN_TIMEOUT_MS);
  await delay(8000);
  const eventsWhileIdle = context.server.events.map((event) => event.hookEventName);
  await context.session.typeLine('/exit');
  await waitFor(() => context.findEvent('SessionEnd'), SESSION_END_TIMEOUT_MS);
  return finishScenario(context, {
    eventsWhileIdle,
    gotSessionStart: Boolean(context.findEvent('SessionStart')),
    sessionEndReason: context.findEvent('SessionEnd')?.body.reason ?? null,
  });
}

/**
 * Scenario `session-start`: SessionStart via curl.exe command hooks (HTTP is not supported there).
 * Covers start with prompt, `/clear` and `--resume` in the same PowerShell, like a user would.
 */
async function runSessionStart(runOptions) {
  const context = await startScenario({
    ...runOptions,
    name: 'session-start',
    prompt: 'Antworte nur mit OK.',
    buildExtraHooks: (port) => ({ SessionStart: buildCurlCommandHookGroups(port) }),
  });
  /** @param {string} source */
  const findSessionStart = (source) => context.server.events.filter(
    (event) => event.hookEventName === 'SessionStart' && event.body.source === source,
  );

  await waitFor(() => context.findEvent('Stop'), TURN_TIMEOUT_MS);
  const startupEvents = findSessionStart('startup');
  const firstSessionId = context.findEvent('UserPromptSubmit')?.body.session_id;

  await context.session.typeLine('/clear');
  await waitFor(() => findSessionStart('clear').length > 0, SESSION_END_TIMEOUT_MS);
  await delay(2000);
  await context.session.typeLine('/exit');
  await waitFor(() => context.server.events.filter((event) => event.hookEventName === 'SessionEnd').length >= 2, SESSION_END_TIMEOUT_MS);

  // Resume the first session from the still running PowerShell (-NoExit), like Argus' "Fortsetzen".
  await delay(2000);
  await context.session.typeLine(
    `claude --model haiku --settings ${quotePowerShellLiteral(context.settingsPath)} --resume ${firstSessionId}`,
  );
  await waitFor(() => findSessionStart('resume').length > 0, TURN_TIMEOUT_MS);
  await delay(2000);
  await context.session.typeLine('/exit');
  await delay(3000);

  /** @param {object[]} events */
  const describe = (events) => events.map((event) => ({
    path: event.url,
    msSinceStart: event.receivedAt - context.session.startedAt,
    sessionHeader: event.headers['x-argus-session'] === context.sessionId ? 'ok' : event.headers['x-argus-session'] ?? null,
    sessionId: event.body.session_id,
  }));
  return finishScenario(context, {
    startup: describe(startupEvents),
    clear: describe(findSessionStart('clear')),
    resume: describe(findSessionStart('resume')),
    firstSessionId,
    sessionEndReasons: context.server.events
      .filter((event) => event.hookEventName === 'SessionEnd')
      .map((event) => event.body.reason),
    firstUserPromptSubmitMs: context.findEvent('UserPromptSubmit')
      ? context.findEvent('UserPromptSubmit').receivedAt - context.session.startedAt
      : null,
  });
}

/** All scenarios by name, in recommended execution order. */
export const SCENARIOS = {
  basic: runBasic,
  'no-prompt': runNoPrompt,
  'session-start': runSessionStart,
  'subagent-foreground': (runOptions) => runSubagent(runOptions, false),
  'subagent-background': (runOptions) => runSubagent(runOptions, true),
  escape: runEscape,
  'escape-tool': runEscapeDuringTool,
  ctrlc: runCtrlC,
  'user-hook': runUserHook,
  latency: runLatency,
};
