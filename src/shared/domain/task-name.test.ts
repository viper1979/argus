import { describe, expect, it } from 'vitest';
import {
  buildTaskBranch,
  buildTaskLocation,
  buildWorktreePath,
  findFreeTaskName,
  sanitizeTaskName,
} from './task-name';

/**
 * Builds a check that treats a fixed set of names as taken.
 * @param takenNames Names that are already used.
 * @returns A check usable by {@link findFreeTaskName}.
 */
function takenAmong(...takenNames: string[]): (candidate: string) => Promise<boolean> {
  return (candidate) => Promise.resolve(takenNames.includes(candidate));
}

describe('sanitizeTaskName', () => {
  it('sanitizeTaskName_WithSpacesUmlautsAndPunctuation_ReturnsAsciiKebabCase', () => {
    // Arrange
    const input = 'Login Refactoring für Prüfstand!';

    // Act
    const taskName = sanitizeTaskName(input);

    // Assert
    expect(taskName).toBe('login-refactoring-fuer-pruefstand');
  });

  it('sanitizeTaskName_WithAccentedLetters_KeepsBaseLetter', () => {
    // Arrange
    const input = 'Café Señor Façade';

    // Act
    const taskName = sanitizeTaskName(input);

    // Assert
    expect(taskName).toBe('cafe-senor-facade');
  });

  it('sanitizeTaskName_WithVeryLongInput_CutsToMaximumLengthWithoutTrailingDash', () => {
    // Arrange
    // 49 letters, a space and more letters: the cut at 50 characters lands right after the dash.
    const input = `${'a'.repeat(49)} bbbbbbbbbb`;

    // Act
    const taskName = sanitizeTaskName(input);

    // Assert
    expect(taskName).toBe('a'.repeat(49));
  });

  it.each([
    ['only punctuation', '!!! ???'],
    ['only spaces', '   '],
    ['empty', ''],
  ])('sanitizeTaskName_WithoutUsableCharacters_ReturnsEmptyString (%s)', (_reason, input) => {
    // Arrange
    // The input comes from the test table.

    // Act
    const taskName = sanitizeTaskName(input);

    // Assert
    expect(taskName).toBe('');
  });
});

describe('findFreeTaskName', () => {
  it('findFreeTaskName_WhenNameIsFree_ReturnsItUnchanged', async () => {
    // Arrange
    const isTaken = takenAmong('payment');

    // Act
    const taskName = await findFreeTaskName('login', isTaken);

    // Assert
    expect(taskName).toBe('login');
  });

  it('findFreeTaskName_WhenNameAndFirstNumberAreTaken_AppendsNextFreeNumber', async () => {
    // Arrange
    const isTaken = takenAmong('login', 'login-2');

    // Act
    const taskName = await findFreeTaskName('login', isTaken);

    // Assert
    expect(taskName).toBe('login-3');
  });

  it('findFreeTaskName_WithReservedWindowsDeviceName_AppendsNumber', async () => {
    // Arrange
    // `con` passes the cleaning, but Windows cannot create a folder with that name.
    const isTaken = takenAmong();

    // Act
    const taskName = await findFreeTaskName('con', isTaken);

    // Assert
    expect(taskName).toBe('con-2');
  });

  it('findFreeTaskName_WithTakenNameOfMaximumLength_KeepsMaximumLength', async () => {
    // Arrange
    const longName = 'a'.repeat(50);
    const isTaken = takenAmong(longName);

    // Act
    const taskName = await findFreeTaskName(longName, isTaken);

    // Assert
    expect(taskName).toBe(`${'a'.repeat(48)}-2`);
  });
});

describe('buildWorktreePath', () => {
  it.each([
    ['folder', 'D:\\Worktrees', 'D:\\Worktrees\\Webshop\\login'],
    ['folder with trailing backslash', 'D:\\Worktrees\\', 'D:\\Worktrees\\Webshop\\login'],
    ['drive root', 'D:\\', 'D:\\Webshop\\login'],
    ['network share', '\\\\nas\\dev', '\\\\nas\\dev\\Webshop\\login'],
  ])(
    'buildWorktreePath_WithWorktreeRoot_PlacesTaskBelowProjectFolder (%s)',
    (_reason, worktreeRoot, expectedPath) => {
      // Arrange
      // Worktree root and expected path come from the test table.

      // Act
      const worktreePath = buildWorktreePath(worktreeRoot, 'Webshop', 'login');

      // Assert
      expect(worktreePath).toBe(expectedPath);
    },
  );
});

describe('buildTaskLocation', () => {
  it('buildTaskLocation_ForProjectAndTaskName_ReturnsBranchAndWorktreePath', () => {
    // Arrange
    const project = { name: 'Webshop', branchPrefix: 'agent' };

    // Act
    const location = buildTaskLocation('D:\\Worktrees', project, 'login');

    // Assert
    expect(location).toEqual({
      branch: 'agent/login',
      worktreePath: 'D:\\Worktrees\\Webshop\\login',
    });
  });
});

describe('buildTaskBranch', () => {
  it('buildTaskBranch_WithPrefixAndTaskName_JoinsThemWithSlash', () => {
    // Arrange
    const branchPrefix = 'agent';

    // Act
    const branch = buildTaskBranch(branchPrefix, 'login-refactoring');

    // Assert
    expect(branch).toBe('agent/login-refactoring');
  });
});
