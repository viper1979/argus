import type { TerminalSignalInterpreter } from '../agent-type-adapter';

/**
 * Glyphs Claude Code puts in front of the terminal title (OSC 0, ADR 0005). If Claude changes
 * them, the interrupt detection fails silently; the glyph test pins them.
 */
export const CLAUDE_TITLE_GLYPHS = {
  /** Claude waits for input: after a finished or interrupted turn. */
  idle: '✳',
  /** Claude works; alternates about every second, also while a tool runs. */
  working: ['◐', '◑'],
} as const;

/** Key presses that may interrupt a turn: Escape, Escape as Kitty CSI-u, Ctrl+C. */
export const CLAUDE_INTERRUPT_KEYS: readonly string[] = ['\x1b', '\x1b[27u', '\x03'];

/** How long after the key press the idle title still counts as interrupt (ADR 0005: 24–77 ms). */
export const CLAUDE_INTERRUPT_WINDOW_MS = 5000;

/**
 * Creates the interrupt detection for one Claude Code agent session (ADR 0005).
 * @param now Clock in milliseconds.
 * @returns The interpreter.
 */
export function createClaudeTerminalInterruptInterpreter(
  now: () => number,
): TerminalSignalInterpreter {
  /** When the last interrupt key was pressed during a running turn; `null` if none counts. */
  let interruptKeyPressedAt: number | null = null;

  return {
    interpret: (signal, currentStatus) => {
      if (signal.kind === 'input') {
        // Exact match: arrow keys and other sequences also start with ESC, but never interrupt.
        // Only while working: in a permission prompt or question Claude already shows the idle
        // title, so the title cannot confirm an Escape there (#8 smoke).
        if (currentStatus === 'working' && CLAUDE_INTERRUPT_KEYS.includes(signal.data)) {
          interruptKeyPressedAt = now();
        }
        return null;
      }
      // Spinner and other titles keep the key press: a spinner tick may precede the idle title.
      if (interruptKeyPressedAt === null || !signal.title.startsWith(CLAUDE_TITLE_GLYPHS.idle)) {
        return null;
      }
      const isInsideWindow = now() - interruptKeyPressedAt <= CLAUDE_INTERRUPT_WINDOW_MS;
      // Used up either way: a later idle title is the normal turn end, which Stop reports.
      interruptKeyPressedAt = null;
      return isInsideWindow ? { kind: 'interrupted' } : null;
    },
  };
}
