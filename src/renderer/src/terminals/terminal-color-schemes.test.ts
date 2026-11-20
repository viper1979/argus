import { describe, expect, it } from 'vitest';
import { terminalColorSchemeFor } from './terminal-color-schemes';

describe('terminalColorSchemeFor', () => {
  it('terminalColorSchemeFor_WhenDark_UsesTheAppColorsOfTheDarkMode', () => {
    // Arrange: hex of --background oklch(0.145 0 0) and --foreground oklch(0.985 0 0) in .dark
    const isDark = true;

    // Act
    const scheme = terminalColorSchemeFor(isDark);

    // Assert
    expect(scheme.theme.background).toBe('#0a0a0a');
    expect(scheme.theme.foreground).toBe('#fafafa');
  });

  it('terminalColorSchemeFor_WhenLight_UsesTheAppColorsOfTheLightMode', () => {
    // Arrange: hex of --background oklch(1 0 0) and --foreground oklch(0.145 0 0) in :root
    const isDark = false;

    // Act
    const scheme = terminalColorSchemeFor(isDark);

    // Assert
    expect(scheme.theme.background).toBe('#ffffff');
    expect(scheme.theme.foreground).toBe('#0a0a0a');
  });

  it.each([
    ['dark', true, '#c50f1f'],
    ['light', false, '#e45649'],
  ])('terminalColorSchemeFor_WhenMode_UsesItsAnsiPalette (%s)', (_mode, isDark, expectedRed) => {
    // Arrange: red of Campbell (dark) and One Half Light (light) in Windows Terminal

    // Act
    const scheme = terminalColorSchemeFor(isDark);

    // Assert
    expect(scheme.theme.red).toBe(expectedRed);
  });

  it.each([
    ['light', false, 4.5],
    ['dark', true, 1],
  ])(
    'terminalColorSchemeFor_WhenMode_SetsMinimumContrastRatio (%s)',
    (_mode, isDark, expectedRatio) => {
      // Arrange: light needs WCAG AA (4.5), or One Half Light's white and yellow vanish on the
      // white page; dark keeps Campbell unchanged (1 turns the adjustment off)

      // Act
      const scheme = terminalColorSchemeFor(isDark);

      // Assert
      expect(scheme.minimumContrastRatio).toBe(expectedRatio);
    },
  );
});
