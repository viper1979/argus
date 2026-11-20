/** Receives the output of one terminal, in production `Terminal.write` of its xterm.js instance. */
export type TerminalOutputSink = (data: string) => void;

/**
 * Routes terminal output from the main process to the xterm.js instance of each terminal.
 * Output can arrive before the renderer knows the terminal (it may overtake the reply to
 * `terminal.open`), so output for an unknown terminal is buffered until it is attached.
 */
export class TerminalOutputRouter {
  private readonly sinks = new Map<string, TerminalOutputSink>();
  private readonly pendingOutput = new Map<string, string[]>();
  /** Ended terminals; late output for them is dropped instead of buffered forever. */
  private readonly forgottenTerminals = new Set<string>();

  /** Number of terminals with buffered output, i.e. not attached yet. */
  get bufferedTerminalCount(): number {
    return this.pendingOutput.size;
  }

  /**
   * Passes output on to the attached sink, or buffers it.
   * @param terminalId The terminal that produced the output.
   * @param data The output chunk.
   */
  deliver(terminalId: string, data: string): void {
    if (this.forgottenTerminals.has(terminalId)) {
      return;
    }
    const sink = this.sinks.get(terminalId);
    if (sink) {
      sink(data);
      return;
    }
    const buffered = this.pendingOutput.get(terminalId) ?? [];
    buffered.push(data);
    this.pendingOutput.set(terminalId, buffered);
  }

  /**
   * Connects a terminal to its sink and replays what arrived before.
   * @param terminalId The terminal.
   * @param sink Receives all output from now on, starting with the buffered output.
   */
  attach(terminalId: string, sink: TerminalOutputSink): void {
    for (const data of this.pendingOutput.get(terminalId) ?? []) {
      sink(data);
    }
    this.pendingOutput.delete(terminalId);
    this.sinks.set(terminalId, sink);
  }

  /**
   * Tells whether a terminal has already ended, e.g. because its shell exited before the reply
   * to `terminal.open` arrived; such a terminal must not get a tab.
   * @param terminalId The terminal.
   * @returns `true` once {@link forget} was called for it.
   */
  hasEnded(terminalId: string): boolean {
    return this.forgottenTerminals.has(terminalId);
  }

  /**
   * Disconnects a terminal whose tab was closed or whose process ended.
   * @param terminalId The terminal; its buffered output is dropped.
   */
  forget(terminalId: string): void {
    this.sinks.delete(terminalId);
    this.pendingOutput.delete(terminalId);
    this.forgottenTerminals.add(terminalId);
  }
}
