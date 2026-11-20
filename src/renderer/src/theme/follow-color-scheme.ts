/**
 * The part of `matchMedia('(prefers-color-scheme: dark)')` Argus needs; narrow so tests can
 * replace it.
 */
export interface ColorSchemeQuery {
  /** Whether the dark mode is active right now. */
  readonly matches: boolean;

  /**
   * Starts listening for mode changes.
   * @param type Always `change`.
   * @param listener Called after `matches` changed.
   */
  addEventListener(type: 'change', listener: () => void): void;

  /**
   * Stops listening for mode changes.
   * @param type Always `change`.
   * @param listener The listener passed to {@link addEventListener}.
   */
  removeEventListener(type: 'change', listener: () => void): void;
}

/**
 * Reports whether the renderer is in dark mode, now and on every change. The main process
 * decides (`nativeTheme.themeSource`, #22); the renderer only follows `prefers-color-scheme`.
 * @param query The media query for the dark color scheme.
 * @param onChange Called right away with the current mode and again whenever it changes.
 * @returns Stops following.
 */
export function followColorScheme(
  query: ColorSchemeQuery,
  onChange: (isDark: boolean) => void,
): () => void {
  /** Passes the current mode on; reads `matches` anew, since a change event carries no mode. */
  const reportCurrentMode = (): void => {
    onChange(query.matches);
  };
  reportCurrentMode();
  query.addEventListener('change', reportCurrentMode);
  return () => {
    query.removeEventListener('change', reportCurrentMode);
  };
}
