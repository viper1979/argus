import { describe, expect, it } from 'vitest';
import { buildTerminalFontFamily } from './terminal-font';

describe('buildTerminalFontFamily', () => {
  it.each([
    ['Cascadia Mono', '"Cascadia Mono", monospace'],
    ['CaskaydiaCove Nerd Font Mono 2', '"CaskaydiaCove Nerd Font Mono 2", monospace'],
    ['Consolas', '"Consolas", monospace'],
  ])(
    'buildTerminalFontFamily_WithFamilyName_QuotesItAndAppendsMonospace (%s)',
    (name, expected) => {
      // Arrange: name as validated by settingsSchema

      // Act
      const fontFamily = buildTerminalFontFamily(name);

      // Assert
      expect(fontFamily).toBe(expected);
    },
  );
});
