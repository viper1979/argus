import type { Settings } from './settings';

/**
 * Generic family the terminal falls back to when the configured font is not installed, so the
 * terminal stays readable (#21).
 */
const FALLBACK_FONT_FAMILY = 'monospace';

/** Font of all terminals as configured in the settings (#21). */
export interface TerminalFont {
  /** One font family name, e.g. `CaskaydiaCove Nerd Font`; never a CSS list. */
  readonly fontFamily: string;
  /** Font size in pixels. */
  readonly fontSize: number;
}

/**
 * Takes the terminal font out of the settings.
 * @param settings The stored settings.
 * @returns Font family name and size.
 */
export function toTerminalFont(settings: Settings): TerminalFont {
  return { fontFamily: settings.terminalFontFamily, fontSize: settings.terminalFontSize };
}

/**
 * Builds the CSS font-family list for xterm.js from the configured font family name.
 * @param fontFamily One font family name as validated by `settingsSchema`; it contains no quotes,
 *   backslashes or commas, so wrapping it in double quotes needs no escaping.
 * @returns E.g. `"CaskaydiaCove Nerd Font", monospace`. Quoting keeps names with digits or
 *   several words valid CSS.
 */
export function buildTerminalFontFamily(fontFamily: string): string {
  return `"${fontFamily}", ${FALLBACK_FONT_FAMILY}`;
}
