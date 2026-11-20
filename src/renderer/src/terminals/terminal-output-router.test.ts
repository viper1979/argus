import { describe, expect, it } from 'vitest';
import { TerminalOutputRouter } from './terminal-output-router';

/** Ids only need to be distinct; real ones are UUIDs. */
const TERMINAL_ID = 'terminal-1';

describe('TerminalOutputRouter', () => {
  it('attach_AfterOutputArrivedEarly_ReplaysBufferedOutputInOrder', () => {
    // Arrange: output can overtake the reply to `terminal.open`
    const router = new TerminalOutputRouter();
    const received: string[] = [];
    router.deliver(TERMINAL_ID, 'PS D:\\');
    router.deliver(TERMINAL_ID, 'Worktrees> ');

    // Act
    router.attach(TERMINAL_ID, (data) => received.push(data));
    router.deliver(TERMINAL_ID, 'dir');

    // Assert
    expect(received).toEqual(['PS D:\\', 'Worktrees> ', 'dir']);
  });

  it('forget_OfAttachedTerminal_StopsDeliveryAndKeepsNoBuffer', () => {
    // Arrange
    const router = new TerminalOutputRouter();
    const received: string[] = [];
    router.attach(TERMINAL_ID, (data) => received.push(data));

    // Act
    router.forget(TERMINAL_ID);
    router.deliver(TERMINAL_ID, 'late output');

    // Assert
    expect(received).toEqual([]);
    expect(router.bufferedTerminalCount).toBe(0);
  });

  it('hasEnded_ForTerminalForgottenBeforeAttach_ReturnsTrue', () => {
    // Arrange: the shell exited before the reply to `terminal.open` reached the renderer
    const router = new TerminalOutputRouter();
    router.deliver(TERMINAL_ID, 'PS> ');
    router.forget(TERMINAL_ID);

    // Act
    const hasEnded = router.hasEnded(TERMINAL_ID);

    // Assert
    expect(hasEnded).toBe(true);
    expect(router.hasEnded('terminal-still-running')).toBe(false);
  });
});
