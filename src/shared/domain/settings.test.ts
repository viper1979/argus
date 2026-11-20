import { describe, expect, it } from 'vitest';
import { applySettingsPatch, settingsPatchSchema, settingsSchema, type Settings } from './settings';

describe('applySettingsPatch', () => {
  /** Stored settings with every field off its default, so a reset would show. */
  const storedSettings: Settings = {
    worktreeRoot: 'D:\\Worktrees',
    terminalFontFamily: 'CaskaydiaCove Nerd Font',
    terminalFontSize: 16,
  };

  it('applySettingsPatch_WithFontOnly_KeepsWorktreeRoot', () => {
    // Arrange
    const patch = { terminalFontFamily: 'Consolas', terminalFontSize: 14 };

    // Act
    const result = applySettingsPatch(storedSettings, patch);

    // Assert
    expect(result).toEqual({
      worktreeRoot: 'D:\\Worktrees',
      terminalFontFamily: 'Consolas',
      terminalFontSize: 14,
    });
  });

  it('applySettingsPatch_WithWorktreeRootNull_ClearsIt', () => {
    // Arrange: null is a value, not "not given"
    const patch = { worktreeRoot: null };

    // Act
    const result = applySettingsPatch(storedSettings, patch);

    // Assert
    expect(result).toEqual({ ...storedSettings, worktreeRoot: null });
  });

  it('applySettingsPatch_WithEmptyPatch_ReturnsStoredSettings', () => {
    // Arrange
    const patch = {};

    // Act
    const result = applySettingsPatch(storedSettings, patch);

    // Assert
    expect(result).toEqual(storedSettings);
  });
});

describe('settingsPatchSchema', () => {
  it('settingsPatchSchema_WithOnlyWorktreeRoot_AddsNoOtherFields', () => {
    // Arrange: the dialog changes only the worktree root; a default for the font would silently
    // reset the user's font (zod's partial() fills in defaults)
    const patch = { worktreeRoot: 'D:\\Worktrees' };

    // Act
    const result = settingsPatchSchema.parse(patch);

    // Assert
    expect(result).toEqual({ worktreeRoot: 'D:\\Worktrees' });
  });

  it('settingsPatchSchema_WithInvalidFontSize_Rejects', () => {
    // Arrange
    const patch = { terminalFontSize: 40 };

    // Act
    const result = settingsPatchSchema.safeParse(patch);

    // Assert
    expect(result.success).toBe(false);
  });

  it('settingsPatchSchema_WithUnknownField_Rejects', () => {
    // Arrange
    const patch = { theme: 'dark' };

    // Act
    const result = settingsPatchSchema.safeParse(patch);

    // Assert
    expect(result.success).toBe(false);
  });
});

describe('settingsSchema', () => {
  it.each(['D:\\Worktrees', 'c:\\', '\\\\fileserver\\share\\worktrees'])(
    'settingsSchema_WithAbsoluteWorktreeRoot_Accepts (%s)',
    (worktreeRoot) => {
      // Arrange
      const settings = { worktreeRoot };

      // Act
      const result = settingsSchema.safeParse(settings);

      // Assert
      expect(result.success).toBe(true);
    },
  );

  it.each([
    ['relative path', 'Worktrees'],
    ['drive-relative path', 'D:Worktrees'],
    ['root-relative path', '\\Worktrees'],
    ['forward slashes only', '/home/worktrees'],
    ['empty', ''],
  ])('settingsSchema_WithNonAbsoluteWorktreeRoot_Rejects (%s)', (_reason, worktreeRoot) => {
    // Arrange
    const settings = { worktreeRoot };

    // Act
    const result = settingsSchema.safeParse(settings);

    // Assert
    expect(result.success).toBe(false);
  });

  it.each([8, 13, 32])('settingsSchema_WithFontSizeInRange_Accepts (%s)', (terminalFontSize) => {
    // Arrange
    const settings = { worktreeRoot: null, terminalFontSize };

    // Act
    const result = settingsSchema.safeParse(settings);

    // Assert
    expect(result.success).toBe(true);
  });

  it.each([7, 33, 12.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'settingsSchema_WithInvalidFontSize_ReturnsGermanSizeMessage (%s)',
    (terminalFontSize) => {
      // Arrange
      const settings = { worktreeRoot: null, terminalFontSize };

      // Act
      const result = settingsSchema.safeParse(settings);

      // Assert
      expect(result.error?.issues[0]?.message).toBe(
        'Die Schriftgröße muss eine ganze Zahl von 8 bis 32 sein.',
      );
    },
  );

  it.each([
    ['plain name', 'Consolas', 'Consolas'],
    [
      'name with spaces and digits',
      'CaskaydiaCove Nerd Font Mono 2',
      'CaskaydiaCove Nerd Font Mono 2',
    ],
    ['surrounding whitespace', '  Fira Code ', 'Fira Code'],
    ['umlaut', 'Schrift Grün', 'Schrift Grün'],
  ])('settingsSchema_WithValidFontFamily_AcceptsTrimmed (%s)', (_case, input, expected) => {
    // Arrange
    const settings = { worktreeRoot: null, terminalFontFamily: input };

    // Act
    const result = settingsSchema.safeParse(settings);

    // Assert
    expect(result.data?.terminalFontFamily).toBe(expected);
  });

  it.each([
    ['empty', ''],
    ['only spaces', '   '],
    ['too long', 'A'.repeat(101)],
    ['double quote', 'My "Font"'],
    ['single quote', "My 'Font'"],
    ['comma (a list)', 'Consolas, monospace'],
    ['semicolon', 'Consolas; color: red'],
    ['control character', 'Cons\nolas'],
    ['backslash', 'Cons\\olas'],
  ])('settingsSchema_WithInvalidFontFamily_Rejects (%s)', (_case, terminalFontFamily) => {
    // Arrange
    const settings = { worktreeRoot: null, terminalFontFamily };

    // Act
    const result = settingsSchema.safeParse(settings);

    // Assert
    expect(result.success).toBe(false);
  });

  it('settingsSchema_WithoutTerminalFontFields_DefaultsToCascadiaMonoSize13', () => {
    // Arrange: settings as written before #21
    const settings = { worktreeRoot: null };

    // Act
    const result = settingsSchema.parse(settings);

    // Assert
    expect(result).toEqual({
      worktreeRoot: null,
      terminalFontFamily: 'Cascadia Mono',
      terminalFontSize: 13,
    });
  });
});
