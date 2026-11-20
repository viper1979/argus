import { describe, expect, it } from 'vitest';
import { isValidWindowsFolderName } from './windows-folder-name';

describe('isValidWindowsFolderName', () => {
  it.each(['Webshop', 'Home Server', 'argus.v2', 'Prüfstand', 'CONSOLE'])(
    'isValidWindowsFolderName_WithValidName_ReturnsTrue (%s)',
    (folderName) => {
      // Arrange
      // The folder name comes from the test table.

      // Act
      const isValid = isValidWindowsFolderName(folderName);

      // Assert
      expect(isValid).toBe(true);
    },
  );

  it.each([
    ['empty', ''],
    ['backslash', 'a\\b'],
    ['slash', 'a/b'],
    ['colon', 'C:'],
    ['asterisk', 'a*'],
    ['question mark', 'a?'],
    ['quote', 'a"b'],
    ['angle brackets', '<a>'],
    ['pipe', 'a|b'],
    ['control character', 'a\tb'],
    ['trailing dot', 'webshop.'],
    ['trailing space', 'webshop '],
    ['reserved device name', 'CON'],
    ['reserved device name in lower case', 'nul'],
    ['reserved device name with number', 'COM1'],
    ['reserved device name with extension', 'LPT9.txt'],
    ['only dots', '..'],
    ['console input device', 'CONIN$'],
    ['console output device', 'conout$'],
    ['device name with superscript digit', 'COM¹'],
  ])('isValidWindowsFolderName_WithInvalidName_ReturnsFalse (%s)', (_reason, folderName) => {
    // Arrange
    // The folder name comes from the test table.

    // Act
    const isValid = isValidWindowsFolderName(folderName);

    // Assert
    expect(isValid).toBe(false);
  });
});
