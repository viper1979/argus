import { describe, expect, it } from 'vitest';
import {
  hasBranchNamed,
  isBranchBlocked,
  isValidBranchName,
  isValidBranchPrefix,
} from './git-ref-name';

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

describe('isBranchBlocked', () => {
  it.each([
    ['same name', ['agent/login']],
    ['same name in other case, e.g. a packed ref', ['Agent/Login']],
    ['branch named like a parent segment', ['agent']],
    ['parent segment in other case', ['AGENT']],
    ['branch below the new one', ['agent/login/draft']],
  ])('isBranchBlocked_WhenExistingBranchCollides_ReturnsTrue (%s)', (_reason, existingBranches) => {
    // Arrange
    // Git stores branches as files: on Windows `agent` and `Agent` are the same file, and
    // `agent` cannot be a file and a folder at once.

    // Act
    const isBlocked = isBranchBlocked('agent/login', existingBranches);

    // Assert
    expect(isBlocked).toBe(true);
  });

  it('isBranchBlocked_WithOnlyUnrelatedBranches_ReturnsFalse', () => {
    // Arrange
    // `agent/login-2` and `agent/log` only share a text prefix, not a path segment.
    const existingBranches = ['main', 'agent/login-2', 'agent/log', 'feature/agent/login'];

    // Act
    const isBlocked = isBranchBlocked('agent/login', existingBranches);

    // Assert
    expect(isBlocked).toBe(false);
  });
});

describe('hasBranchNamed', () => {
  it.each([
    ['exact name', ['main', 'agent'], true],
    ['other case, e.g. a packed ref', ['Agent'], true],
    ['only branches below it, the normal case for a prefix', ['agent/login'], false],
  ])(
    'hasBranchNamed_WithExistingBranches_ReportsWhetherOneHasTheName (%s)',
    (_reason, existingBranches, expected) => {
      // Arrange
      // The existing branches come from the test table.

      // Act
      const hasBranch = hasBranchNamed('agent', existingBranches);

      // Assert
      expect(hasBranch).toBe(expected);
    },
  );
});
