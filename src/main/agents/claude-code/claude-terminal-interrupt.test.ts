import type { AgentSessionStatus } from '@shared/domain/agent-session';
import { describe, expect, it } from 'vitest';
import type { TerminalSignalInterpreter } from '../agent-type-adapter';
import type { TerminalSignal } from '../../terminals/terminal-signal';
import { createClaudeCodeAdapter } from './claude-code-adapter';
import {
  CLAUDE_INTERRUPT_KEYS,
  CLAUDE_INTERRUPT_WINDOW_MS,
  CLAUDE_TITLE_GLYPHS,
} from './claude-terminal-interrupt';

/** Escape as plain byte. */
const ESCAPE = '\x1b';

/** Title Claude sets when idle; spelled with its code point, independent of the constant. */
const IDLE_TITLE = '✳ Claude Code';

/** Title Claude sets while working; first spinner phase. */
const SPINNER_TITLE = '◐ Refactor the parser';

/** Gap between key press and idle title as measured in ADR 0005. */
const MEASURED_DELAY_MS = 77;

/** A test clock that only moves when the test says so. */
interface ManualClock {
  readonly now: () => number;
  advance(milliseconds: number): void;
}

/**
 * Creates a clock.
 * @param startTime Time it starts at; arbitrary unless a test depends on it.
 * @returns The clock.
 */
function createManualClock(startTime = 1_000_000): ManualClock {
  let currentTime = startTime;
  return {
    now: () => currentTime,
    advance: (milliseconds) => {
      currentTime += milliseconds;
    },
  };
}

/**
 * Creates the interpreter like the core does: through the Claude Code adapter.
 * @param clock The test clock.
 * @returns The interpreter of one agent session.
 */
function createInterpreter(clock: ManualClock): TerminalSignalInterpreter {
  return createClaudeCodeAdapter().createTerminalSignalInterpreter(clock.now);
}

/**
 * Builds a key press signal.
 * @param data What the user typed.
 * @returns The signal.
 */
function keyPress(data: string): TerminalSignal {
  return { kind: 'input', data };
}

/**
 * Builds a title signal.
 * @param title The new window title.
 * @returns The signal.
 */
function titleChange(title: string): TerminalSignal {
  return { kind: 'title', title };
}

describe('Claude terminal interrupt detection', () => {
  it.each([
    ['Escape', '\x1b'],
    ['KittyEscape', '\x1b[27u'],
    ['CtrlC', '\x03'],
  ])('interpret_%sWhileWorkingThenIdleTitle_ReportsInterrupted', (_name, key) => {
    // Arrange
    const clock = createManualClock();
    const interpreter = createInterpreter(clock);
    interpreter.interpret(keyPress(key), 'working');
    clock.advance(MEASURED_DELAY_MS);

    // Act
    const event = interpreter.interpret(titleChange(IDLE_TITLE), 'working');

    // Assert
    expect(event).toEqual({ kind: 'interrupted' });
  });

  it('interpret_KeyPress_ReportsNothingYet', () => {
    // Arrange: the key alone may only have closed a view (ADR 0005).
    const interpreter = createInterpreter(createManualClock());

    // Act
    const event = interpreter.interpret(keyPress(ESCAPE), 'working');

    // Assert
    expect(event).toBeNull();
  });

  it.each([
    ['ArrowUp', '\x1b[A'],
    ['TwoEscapes', '\x1b\x1b'],
    ['PlainText', 'x'],
    ['Enter', '\r'],
  ])('interpret_IdleTitleAfter%s_ReportsNothing', (_name, data) => {
    // Arrange: arrow keys also start with ESC, but never interrupt.
    const clock = createManualClock();
    const interpreter = createInterpreter(clock);
    interpreter.interpret(keyPress(data), 'working');
    clock.advance(MEASURED_DELAY_MS);

    // Act
    const event = interpreter.interpret(titleChange(IDLE_TITLE), 'working');

    // Assert
    expect(event).toBeNull();
  });

  it.each<AgentSessionStatus | null>(['waiting', 'ready', 'failed', 'ended', null])(
    'interpret_EscapeWhileStatus%sThenIdleTitle_ReportsNothing',
    (status) => {
      // Arrange: only a running turn can be interrupted. While "Wartet", Claude already shows
      // the idle title, so it cannot confirm an Escape (#8 smoke).
      const clock = createManualClock();
      const interpreter = createInterpreter(clock);
      interpreter.interpret(keyPress(ESCAPE), status);
      clock.advance(MEASURED_DELAY_MS);

      // Act
      const event = interpreter.interpret(titleChange(IDLE_TITLE), 'working');

      // Assert
      expect(event).toBeNull();
    },
  );

  it('interpret_IdleTitleWithoutKeyPress_ReportsNothing', () => {
    // Arrange: a normal turn end also shows the idle title, but reports Stop by hook. The clock
    // starts at 0, so no missing key press can pass as one pressed at time 0.
    const interpreter = createInterpreter(createManualClock(0));

    // Act
    const event = interpreter.interpret(titleChange(IDLE_TITLE), 'working');

    // Assert
    expect(event).toBeNull();
  });

  it('interpret_SpinnerTitleAfterEscape_ReportsNothingAndKeepsWaitingForIdle', () => {
    // Arrange: a spinner tick may come before Claude handled the key.
    const clock = createManualClock();
    const interpreter = createInterpreter(clock);
    interpreter.interpret(keyPress(ESCAPE), 'working');
    clock.advance(10);

    // Act
    const spinnerEvent = interpreter.interpret(titleChange(SPINNER_TITLE), 'working');
    clock.advance(MEASURED_DELAY_MS);
    const idleEvent = interpreter.interpret(titleChange(IDLE_TITLE), 'working');

    // Assert
    expect(spinnerEvent).toBeNull();
    expect(idleEvent).toEqual({ kind: 'interrupted' });
  });

  it('interpret_IdleTitleExactlyAtWindowEnd_ReportsInterrupted', () => {
    // Arrange
    const clock = createManualClock();
    const interpreter = createInterpreter(clock);
    interpreter.interpret(keyPress(ESCAPE), 'working');
    clock.advance(CLAUDE_INTERRUPT_WINDOW_MS);

    // Act
    const event = interpreter.interpret(titleChange(IDLE_TITLE), 'working');

    // Assert
    expect(event).toEqual({ kind: 'interrupted' });
  });

  it('interpret_IdleTitleAfterWindow_ReportsNothing', () => {
    // Arrange: a later idle title is the normal turn end, which Stop reports.
    const clock = createManualClock();
    const interpreter = createInterpreter(clock);
    interpreter.interpret(keyPress(ESCAPE), 'working');
    clock.advance(CLAUDE_INTERRUPT_WINDOW_MS + 1);

    // Act
    const event = interpreter.interpret(titleChange(IDLE_TITLE), 'working');

    // Assert
    expect(event).toBeNull();
  });

  it('interpret_SecondIdleTitleAfterInterrupt_ReportsNothing', () => {
    // Arrange: the key press is used up by the first interrupt.
    const clock = createManualClock();
    const interpreter = createInterpreter(clock);
    interpreter.interpret(keyPress(ESCAPE), 'working');
    clock.advance(MEASURED_DELAY_MS);
    interpreter.interpret(titleChange(IDLE_TITLE), 'working');
    clock.advance(MEASURED_DELAY_MS);

    // Act
    const event = interpreter.interpret(titleChange(IDLE_TITLE), 'working');

    // Assert
    expect(event).toBeNull();
  });

  it('interpret_SecondEscapeInsideWindow_RestartsWindow', () => {
    // Arrange: e.g. the first Escape closed a view, the second interrupts.
    const clock = createManualClock();
    const interpreter = createInterpreter(clock);
    interpreter.interpret(keyPress(ESCAPE), 'working');
    clock.advance(CLAUDE_INTERRUPT_WINDOW_MS - 1000);
    interpreter.interpret(keyPress(ESCAPE), 'working');
    clock.advance(2000);

    // Act
    const event = interpreter.interpret(titleChange(IDLE_TITLE), 'working');

    // Assert
    expect(event).toEqual({ kind: 'interrupted' });
  });

  it('interpret_EscapeInOtherAgentSession_DoesNotCountHere', () => {
    // Arrange: each agent session gets its own interpreter.
    const clock = createManualClock();
    const adapter = createClaudeCodeAdapter();
    const interruptedSession = adapter.createTerminalSignalInterpreter(clock.now);
    const otherSession = adapter.createTerminalSignalInterpreter(clock.now);
    interruptedSession.interpret(keyPress(ESCAPE), 'working');
    clock.advance(MEASURED_DELAY_MS);

    // Act
    const event = otherSession.interpret(titleChange(IDLE_TITLE), 'working');

    // Assert
    expect(event).toBeNull();
  });
});

describe('Claude terminal interrupt constants', () => {
  it('CLAUDE_TITLE_GLYPHS_MatchGlyphsMeasuredInAdr0005', () => {
    // Arrange: code points as independent oracle; a changed glyph breaks the detection silently.
    const expected = { idle: '✳', working: ['◐', '◑'] };

    // Act
    const glyphs = CLAUDE_TITLE_GLYPHS;

    // Assert
    expect(glyphs).toEqual(expected);
  });

  it('CLAUDE_INTERRUPT_KEYS_AreEscapeKittyEscapeAndCtrlC', () => {
    // Arrange
    const expected = ['\x1b', '\x1b[27u', '\x03'];

    // Act
    const keys = CLAUDE_INTERRUPT_KEYS;

    // Assert
    expect(keys).toEqual(expected);
  });

  it('CLAUDE_INTERRUPT_WINDOW_MS_IsFiveSeconds', () => {
    // Arrange: far above the measured 24–77 ms, far below a typical turn (ADR 0005).
    const expected = 5000;

    // Act
    const window = CLAUDE_INTERRUPT_WINDOW_MS;

    // Assert
    expect(window).toBe(expected);
  });
});
