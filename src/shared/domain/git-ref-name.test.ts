import { describe, expect, it } from 'vitest';
import { isValidBranchName, isValidBranchPrefix } from './git-ref-name';

describe('isValidBranchName', () => {
  it.each(['main', 'master', 'release/2026.11', 'feature/3-projekte', 'agent/login_refactoring'])(
    'isValidBranchName_WithValidName_ReturnsTrue (%s)',
    (branchName) => {
      // Arrange
      // The branch name comes from the test table.

      // Act
      const isValid = isValidBranchName(branchName);

      // Assert
      expect(isValid).toBe(true);
    },
  );

  it.each([
    ['empty', ''],
    ['space', 'my branch'],
    ['double dot', 'release..1'],
    ['tilde', 'main~1'],
    ['caret', 'main^'],
    ['colon', 'a:b'],
    ['question mark', 'a?b'],
    ['asterisk', 'a*b'],
    ['bracket', 'a[b'],
    ['backslash', 'a\\b'],
    ['reflog syntax', 'main@{1}'],
    ['only at sign', '@'],
    ['leading slash', '/main'],
    ['trailing slash', 'main/'],
    ['double slash', 'a//b'],
    ['segment starting with dot', 'a/.hidden'],
    ['ending with .lock', 'main.lock'],
    ['ending with dot', 'main.'],
    ['control character', 'a\tb'],
    ['leading dash, read as git option', '-x'],
    ['segment ending with .lock', 'feature.lock/x'],
    ['HEAD', 'HEAD'],
  ])('isValidBranchName_WithInvalidName_ReturnsFalse (%s)', (_reason, branchName) => {
    // Arrange
    // The branch name comes from the test table.

    // Act
    const isValid = isValidBranchName(branchName);

    // Assert
    expect(isValid).toBe(false);
  });
});

describe('isValidBranchPrefix', () => {
  it('isValidBranchPrefix_WithSingleSegment_ReturnsTrue', () => {
    // Arrange
    const branchPrefix = 'agent';

    // Act
    const isValid = isValidBranchPrefix(branchPrefix);

    // Assert
    expect(isValid).toBe(true);
  });

  it.each([
    ['empty', ''],
    ['contains slash', 'agent/'],
    ['invalid ref characters', 'my agent'],
  ])('isValidBranchPrefix_WithInvalidPrefix_ReturnsFalse (%s)', (_reason, branchPrefix) => {
    // Arrange
    // The prefix comes from the test table.

    // Act
    const isValid = isValidBranchPrefix(branchPrefix);

    // Assert
    expect(isValid).toBe(false);
  });
});
