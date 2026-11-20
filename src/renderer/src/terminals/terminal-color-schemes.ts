import type { ITheme } from '@xterm/xterm';
import { APP_COLORS, type AppModeColors } from '@shared/theme/app-colors';

/** Colors of all terminals in one resolved mode. */
export interface TerminalColorScheme {
  /** xterm.js `theme` option. */
  readonly theme: ITheme;
  /**
   * xterm.js `minimumContrastRatio` option: text colors with less contrast against their
   * background are lightened or darkened at render time. 1 turns this off.
   */
  readonly minimumContrastRatio: number;
}

/**
 * WCAG AA for normal text. One Half Light's white (#fafafa) and yellows are nearly invisible on
 * the white page; at this ratio xterm.js darkens them just enough to read.
 */
const LIGHT_MINIMUM_CONTRAST_RATIO = 4.5;

/** Off: Campbell is kept exactly as Windows Terminal shows it. */
const DARK_MINIMUM_CONTRAST_RATIO = 1;

/** Selection overlay; translucent, so the selected text stays readable in both modes. */
const SELECTION_BACKGROUND = {
  light: 'rgba(0, 0, 0, 0.15)',
  dark: 'rgba(255, 255, 255, 0.25)',
} as const;

/** The 16 ANSI colors of "Campbell", the default dark scheme of Windows Terminal. */
const CAMPBELL_ANSI_COLORS: ITheme = {
  black: '#0c0c0c',
  red: '#c50f1f',
  green: '#13a10e',
  yellow: '#c19c00',
  blue: '#0037da',
  magenta: '#881798',
  cyan: '#3a96dd',
  white: '#cccccc',
  brightBlack: '#767676',
  brightRed: '#e74856',
  brightGreen: '#16c60c',
  brightYellow: '#f9f1a5',
  brightBlue: '#3b78ff',
  brightMagenta: '#b4009e',
  brightCyan: '#61d6d6',
  brightWhite: '#f2f2f2',
};

/** The 16 ANSI colors of "One Half Light", a light scheme shipped with Windows Terminal. */
const ONE_HALF_LIGHT_ANSI_COLORS: ITheme = {
  black: '#383a42',
  red: '#e45649',
  green: '#50a14f',
  yellow: '#c18301',
  blue: '#0184bc',
  magenta: '#a626a4',
  cyan: '#0997b3',
  white: '#fafafa',
  brightBlack: '#4f525d',
  brightRed: '#df6c75',
  brightGreen: '#98c379',
  brightYellow: '#e4c07a',
  brightBlue: '#61afef',
  brightMagenta: '#c577dd',
  brightCyan: '#56b5c1',
  brightWhite: '#ffffff',
};

/**
 * Builds the xterm.js theme whose background and text match the page, so a terminal looks like
 * part of the task view instead of a box inside it.
 * @param pageColors Page colors of the mode.
 * @param selectionBackground Selection overlay of the mode.
 * @param ansiColors The 16 ANSI colors of the mode.
 * @returns The xterm.js theme.
 */
function buildTheme(
  pageColors: AppModeColors,
  selectionBackground: string,
  ansiColors: ITheme,
): ITheme {
  return {
    ...ansiColors,
    background: pageColors.background,
    foreground: pageColors.foreground,
    cursor: pageColors.foreground,
    cursorAccent: pageColors.background,
    selectionBackground,
  };
}

/** One xterm.js scheme per resolved mode; shared by all terminals, incl. the agent session (#7). */
const TERMINAL_COLOR_SCHEMES: {
  readonly light: TerminalColorScheme;
  readonly dark: TerminalColorScheme;
} = {
  light: {
    theme: buildTheme(APP_COLORS.light, SELECTION_BACKGROUND.light, ONE_HALF_LIGHT_ANSI_COLORS),
    minimumContrastRatio: LIGHT_MINIMUM_CONTRAST_RATIO,
  },
  dark: {
    theme: buildTheme(APP_COLORS.dark, SELECTION_BACKGROUND.dark, CAMPBELL_ANSI_COLORS),
    minimumContrastRatio: DARK_MINIMUM_CONTRAST_RATIO,
  },
};

/**
 * Picks the terminal scheme of the resolved mode.
 * @param isDark Whether the app is in dark mode.
 * @returns Theme and minimum contrast of the mode.
 */
export function terminalColorSchemeFor(isDark: boolean): TerminalColorScheme {
  return isDark ? TERMINAL_COLOR_SCHEMES.dark : TERMINAL_COLOR_SCHEMES.light;
}
