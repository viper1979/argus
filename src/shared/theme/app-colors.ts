/** Page colors of one resolved mode, as hex. */
export interface AppModeColors {
  readonly background: string;
  readonly foreground: string;
}

/**
 * Page colors of Argus per resolved mode, as hex. Must match `--background` and `--foreground`
 * in `renderer/src/styles.css` (light: `oklch(1 0 0)` / `oklch(0.145 0 0)`, dark:
 * `oklch(0.145 0 0)` / `oklch(0.985 0 0)`). The main window paints the background before the
 * renderer has loaded, so a dark start does not flash white; the terminals use both, so they
 * blend into the page (#22).
 */
export const APP_COLORS: { readonly light: AppModeColors; readonly dark: AppModeColors } = {
  light: { background: '#ffffff', foreground: '#0a0a0a' },
  dark: { background: '#0a0a0a', foreground: '#fafafa' },
};
