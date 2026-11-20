import { describe, expect, it } from 'vitest';
import { settingsSchema } from './settings';

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
});
