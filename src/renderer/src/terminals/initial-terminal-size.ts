/**
 * Size a PTY starts with. The real size is only known once xterm.js is on the page; it is sent
 * right after the first display.
 */
export const INITIAL_TERMINAL_SIZE = { cols: 120, rows: 30 };
