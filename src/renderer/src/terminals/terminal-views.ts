import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { DEFAULT_SETTINGS } from '@shared/domain/settings';
import {
  buildTerminalFontFamily,
  toTerminalFont,
  type TerminalFont,
} from '@shared/domain/terminal-font';
import { terminalColorSchemeFor, type TerminalColorScheme } from './terminal-color-schemes';
import { TerminalOutputRouter } from './terminal-output-router';

/**
 * One xterm.js instance per terminal. It lives outside React, so switching tasks or tabs only
 * detaches its host element from the page; the instance keeps receiving output and its content
 * stays (issue #5, "Terminals laufen weiter, der Inhalt bleibt erhalten").
 */
interface TerminalView {
  readonly terminal: Terminal;
  readonly fitAddon: FitAddon;
  /** Element xterm.js renders into; moved between containers, never recreated. */
  readonly hostElement: HTMLDivElement;
  /** xterm.js can be opened only once, and only when its element is part of the page. */
  isOpened: boolean;
}

/** Lines kept per terminal when scrolling back. */
const TERMINAL_SCROLLBACK_LINES = 5000;

const views = new Map<string, TerminalView>();
const outputRouter = new TerminalOutputRouter();

/**
 * Font new terminals are created with. Starts with the defaults and is replaced as soon as the
 * stored settings are loaded, which also updates terminals created before that.
 */
let currentFont: TerminalFont = toTerminalFont(DEFAULT_SETTINGS);

/**
 * Mode assumed until `main.tsx` reports the resolved one, which it does before the first render;
 * so this light default is never visible in dark mode.
 */
const IS_DARK_BEFORE_FIRST_REPORT = false;

/** Color scheme new terminals are created with; replaced on every mode change. */
let currentColorScheme: TerminalColorScheme = terminalColorSchemeFor(IS_DARK_BEFORE_FIRST_REPORT);

/**
 * Applies a color scheme to all terminals, including open and hidden ones (#22). Only colors
 * change, not the cell size, so no terminal needs to be fitted; xterm.js keeps the content.
 * @param colorScheme The scheme of the resolved mode.
 */
export function applyTerminalColorScheme(colorScheme: TerminalColorScheme): void {
  currentColorScheme = colorScheme;
  for (const view of views.values()) {
    view.terminal.options.theme = colorScheme.theme;
    view.terminal.options.minimumContrastRatio = colorScheme.minimumContrastRatio;
  }
}

/**
 * Applies a font to all terminals, including open ones (#21, "Sofortige Wirkung"). xterm.js
 * measures the character size again when the option changes; visible terminals are fitted to
 * their container right away, which sends the new columns and rows to the PTY via `onResize`.
 * Hidden terminals are fitted when they are shown next.
 * @param font The font from the settings.
 */
export function applyTerminalFont(font: TerminalFont): void {
  currentFont = font;
  const fontFamily = buildTerminalFontFamily(font.fontFamily);
  for (const view of views.values()) {
    view.terminal.options.fontFamily = fontFamily;
    view.terminal.options.fontSize = font.fontSize;
    if (view.isOpened && view.hostElement.isConnected) {
      view.fitAddon.fit();
    }
  }
}

/**
 * Hands output from the main process to the xterm.js instance of its terminal, or buffers it
 * until that instance exists.
 * @param terminalId The terminal that produced the output.
 * @param data The output chunk.
 */
export function deliverTerminalOutput(terminalId: string, data: string): void {
  outputRouter.deliver(terminalId, data);
}

/**
 * Creates the xterm.js instance of a freshly opened terminal and wires input and size to main.
 * @param terminalId Id the main process returned for the terminal.
 * @returns `false` if the terminal has already ended (its shell exited before the reply to
 *   `terminal.open` arrived); then nothing is created and the terminal must not get a tab.
 */
export function createTerminalView(terminalId: string): boolean {
  if (outputRouter.hasEnded(terminalId)) {
    return false;
  }
  const terminal = new Terminal({
    fontFamily: buildTerminalFontFamily(currentFont.fontFamily),
    fontSize: currentFont.fontSize,
    theme: currentColorScheme.theme,
    minimumContrastRatio: currentColorScheme.minimumContrastRatio,
    scrollback: TERMINAL_SCROLLBACK_LINES,
    cursorBlink: true,
  });
  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);

  terminal.onData((data) => {
    window.argus.terminal.write({ terminalId, data }).catch((error: unknown) => {
      console.error('Could not send input to terminal', error);
    });
  });
  terminal.onResize(({ cols, rows }) => {
    window.argus.terminal.resize({ terminalId, cols, rows }).catch((error: unknown) => {
      console.error('Could not resize terminal', error);
    });
  });

  const hostElement = document.createElement('div');
  hostElement.className = 'h-full w-full';
  views.set(terminalId, { terminal, fitAddon, hostElement, isOpened: false });
  // xterm.js accepts output before it is opened, so nothing between spawn and display is lost.
  outputRouter.attach(terminalId, (data) => {
    terminal.write(data);
  });
  return true;
}

/**
 * Shows a terminal inside a container and keeps its size in sync with the container.
 * @param terminalId The terminal.
 * @param container Element of the task view that should show it.
 * @returns Detaches the terminal again without ending it.
 */
export function attachTerminalView(terminalId: string, container: HTMLElement): () => void {
  const view = views.get(terminalId);
  if (!view) {
    return () => undefined;
  }

  container.appendChild(view.hostElement);
  if (!view.isOpened) {
    view.terminal.open(view.hostElement);
    view.isOpened = true;
  }
  view.fitAddon.fit();
  view.terminal.focus();

  const resizeObserver = new ResizeObserver(() => {
    view.fitAddon.fit();
  });
  resizeObserver.observe(container);

  return () => {
    resizeObserver.disconnect();
    view.hostElement.remove();
  };
}

/**
 * Discards the xterm.js instance of a terminal whose process ended or whose tab was closed, and
 * remembers that it ended. Safe to call more than once, and before the instance exists.
 * @param terminalId The terminal.
 */
export function disposeTerminalView(terminalId: string): void {
  outputRouter.forget(terminalId);
  const view = views.get(terminalId);
  if (view) {
    views.delete(terminalId);
    view.terminal.dispose();
    view.hostElement.remove();
  }
}
