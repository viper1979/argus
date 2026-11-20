import { describe, expect, it, vi } from 'vitest';
import { followColorScheme, type ColorSchemeQuery } from './follow-color-scheme';

/** Stand-in for `matchMedia('(prefers-color-scheme: dark)')` that a test can switch. */
class FakeColorSchemeQuery implements ColorSchemeQuery {
  private readonly listeners = new Set<() => void>();

  /**
   * @param matches Whether the dark mode is active at the start.
   */
  constructor(public matches: boolean) {}

  /** Remembers a change listener. */
  addEventListener(_type: 'change', listener: () => void): void {
    this.listeners.add(listener);
  }

  /** Forgets a change listener. */
  removeEventListener(_type: 'change', listener: () => void): void {
    this.listeners.delete(listener);
  }

  /**
   * Simulates the main process or Windows switching the mode.
   * @param matches Whether the dark mode is active now.
   */
  switchTo(matches: boolean): void {
    this.matches = matches;
    for (const listener of this.listeners) {
      listener();
    }
  }
}

describe('followColorScheme', () => {
  it('followColorScheme_WhenDarkAtStart_ReportsDarkImmediately', () => {
    // Arrange
    const query = new FakeColorSchemeQuery(true);
    const onChange = vi.fn<(isDark: boolean) => void>();

    // Act
    followColorScheme(query, onChange);

    // Assert
    expect(onChange).toHaveBeenCalledExactlyOnceWith(true);
  });

  it('followColorScheme_WhenSwitchedToLight_ReportsLight', () => {
    // Arrange
    const query = new FakeColorSchemeQuery(true);
    const onChange = vi.fn<(isDark: boolean) => void>();
    followColorScheme(query, onChange);

    // Act
    query.switchTo(false);

    // Assert
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  it('followColorScheme_AfterStopping_ReportsNoFurtherChanges', () => {
    // Arrange
    const query = new FakeColorSchemeQuery(false);
    const onChange = vi.fn<(isDark: boolean) => void>();
    const stopFollowing = followColorScheme(query, onChange);

    // Act
    stopFollowing();
    query.switchTo(true);

    // Assert
    expect(onChange).toHaveBeenCalledExactlyOnceWith(false);
  });
});
