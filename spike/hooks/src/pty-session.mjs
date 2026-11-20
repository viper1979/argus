import fs from 'node:fs';
import pty from 'node-pty';

/** Interval for polling conditions inside `waitFor`. */
const POLL_INTERVAL_MS = 100;

/** Matches ANSI CSI/OSC escape sequences so the TUI output can be searched as plain text. */
// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b[@-_]/g;

/**
 * Escapes a value for use inside a PowerShell single-quoted string.
 * In single quotes only `'` is special; it is escaped by doubling it.
 *
 * @param {string} value
 * @returns {string}
 */
export function quotePowerShellLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

/**
 * Encodes a PowerShell script for `-EncodedCommand` (Base64 of UTF-16LE).
 * This keeps quotes, `$` and umlauts away from any command-line parsing.
 *
 * @param {string} script
 * @returns {string}
 */
export function encodePowerShellCommand(script) {
  return Buffer.from(script, 'utf16le').toString('base64');
}

/**
 * Starts `pwsh -NoExit` in a ConPTY, which in turn runs the given PowerShell script.
 * Output is logged raw to `outputLogFile` and kept as ANSI-stripped text for searching.
 *
 * @param {{ script: string, cwd: string, env: Record<string,string>, outputLogFile: string }} options
 */
export function startPowerShellSession({ script, cwd, env, outputLogFile }) {
  const startedAt = Date.now();
  const ptyProcess = pty.spawn(
    'pwsh.exe',
    ['-NoLogo', '-NoProfile', '-NoExit', '-EncodedCommand', encodePowerShellCommand(script)],
    { name: 'xterm-256color', cols: 140, rows: 45, cwd, env: { ...withoutClaudeSessionVariables(process.env), ...env } },
  );

  let plainOutput = '';
  let rawOutput = '';
  let titleScanIndex = 0;
  let hasExited = false;
  const autoAnswers = [];
  /** Terminal titles set via OSC 0/2, with arrival time. Claude shows its activity glyph there. */
  const titles = [];

  ptyProcess.onData((data) => {
    fs.appendFileSync(outputLogFile, data);
    plainOutput += data.replace(ANSI_PATTERN, '');
    rawOutput += data;
    collectTitles();
    answerKnownPrompts();
  });
  ptyProcess.onExit(() => {
    hasExited = true;
  });

  /**
   * Answers blocking dialogs (e.g. the folder trust dialog) once each, so scenarios do not hang.
   */
  function answerKnownPrompts() {
    const trustDialogPattern = /trust this folder|Do you trust/i;
    if (!autoAnswers.includes('trust') && trustDialogPattern.test(plainOutput)) {
      autoAnswers.push('trust');
      setTimeout(() => ptyProcess.write('\r'), 500);
    }
  }

  /**
   * Extracts complete OSC 0/2 title sequences that arrived since the last scan.
   * Scanning the accumulated raw output handles sequences split across data chunks.
   */
  function collectTitles() {
    // OSC 0/2: ESC ] 0|2 ; <title> terminated by BEL or ST (ESC \).
    // eslint-disable-next-line no-control-regex
    const titlePattern = /\x1b\][02];([^\x07\x1b]*)(?:\x07|\x1b\\)/g;
    titlePattern.lastIndex = titleScanIndex;
    let match;
    while ((match = titlePattern.exec(rawOutput)) !== null) {
      titles.push({ at: Date.now(), title: match[1] });
      titleScanIndex = titlePattern.lastIndex;
    }
  }

  return {
    startedAt,
    autoAnswers,
    titles,
    /** @returns {string} ANSI-stripped output so far. */
    getPlainOutput: () => plainOutput,
    /** @returns {boolean} Whether the PowerShell process has exited. */
    hasExited: () => hasExited,
    /**
     * Writes raw input (keys, text) into the PTY.
     * @param {string} data
     */
    write: (data) => ptyProcess.write(data),
    /**
     * Types a line the way a user would: text first, Enter separately,
     * because Claude's TUI treats a single chunk with `\r` as a paste.
     * @param {string} text
     */
    typeLine: async (text) => {
      ptyProcess.write(text);
      await delay(300);
      ptyProcess.write('\r');
    },
    /** Kills the PTY (PowerShell and everything running inside it). */
    kill: () => {
      if (!hasExited) {
        ptyProcess.kill();
      }
    },
  };
}

/**
 * Removes variables a surrounding Claude Code session puts into the environment
 * (`CLAUDECODE`, `CLAUDE_CODE_CHILD_SESSION`, ...). Inherited, they turn the started
 * Claude into a "child session" with different behaviour (e.g. no transcript).
 *
 * @param {NodeJS.ProcessEnv} environment
 * @returns {Record<string, string>}
 */
export function withoutClaudeSessionVariables(environment) {
  // Escape hatch for the counter-check: does an inherited child-session environment break hooks?
  if (environment.SPIKE_KEEP_CLAUDE_ENV === '1') {
    return { ...environment };
  }
  return Object.fromEntries(
    Object.entries(environment).filter(([name]) => !/^CLAUDE(CODE$|_)/i.test(name)),
  );
}

/**
 * Resolves after `ms` milliseconds.
 *
 * @param {number} ms
 * @returns {Promise<void>}
 */
export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Polls `condition` until it returns a truthy value or the timeout expires.
 *
 * @template T
 * @param {() => T} condition
 * @param {number} timeoutMs
 * @returns {Promise<T | undefined>} The truthy value, or undefined on timeout.
 */
export async function waitFor(condition, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = condition();
    if (result) {
      return result;
    }
    await delay(POLL_INTERVAL_MS);
  }
  return undefined;
}
