/**
 * Raw signal of a terminal, forwarded by the terminal service to whoever launched it (concept 4).
 * Agent-neutral: what a key press or title means is decided by the agent type adapter, e.g. the
 * interrupt detection of ADR 0005. Delivered synchronously, so the receiver's clock dates it.
 */
export type TerminalSignal =
  /** The user typed into the terminal, e.g. Escape or Ctrl+C. */
  | { readonly kind: 'input'; readonly data: string }
  /** The program in the terminal set the window title (OSC 0 or OSC 2). */
  | { readonly kind: 'title'; readonly title: string };
