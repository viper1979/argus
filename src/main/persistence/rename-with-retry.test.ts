import { describe, expect, it, vi } from 'vitest';
import { renameWithRetry } from './rename-with-retry';

/**
 * Builds a file system error like Node.js raises it.
 * @param code Error code, e.g. `EPERM`.
 * @returns The error.
 */
function fileSystemError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`${code}: rename failed`), { code });
}

/** Retry settings without waiting, so the tests stay fast and deterministic. */
const NO_DELAY = { maxAttempts: 5, delayMilliseconds: 0 };

describe('renameWithRetry', () => {
  it('renameWithRetry_WhenTargetIsBrieflyLocked_RetriesUntilItSucceeds', async () => {
    // Arrange
    const rename = vi
      .fn<(from: string, to: string) => Promise<void>>()
      .mockRejectedValueOnce(fileSystemError('EPERM'))
      .mockRejectedValueOnce(fileSystemError('EBUSY'))
      .mockResolvedValueOnce(undefined);

    // Act
    await renameWithRetry(rename, 'state.json.tmp', 'state.json', NO_DELAY);

    // Assert
    expect(rename).toHaveBeenCalledTimes(3);
  });

  it('renameWithRetry_WhenTargetStaysLocked_RejectsAfterMaxAttempts', async () => {
    // Arrange
    const rename = vi
      .fn<(from: string, to: string) => Promise<void>>()
      .mockRejectedValue(fileSystemError('EACCES'));

    // Act
    const renaming = renameWithRetry(rename, 'state.json.tmp', 'state.json', NO_DELAY);

    // Assert
    await expect(renaming).rejects.toMatchObject({ code: 'EACCES' });
    expect(rename).toHaveBeenCalledTimes(NO_DELAY.maxAttempts);
  });

  it('renameWithRetry_WithErrorThatIsNoLock_RejectsWithoutRetry', async () => {
    // Arrange
    const rename = vi
      .fn<(from: string, to: string) => Promise<void>>()
      .mockRejectedValue(fileSystemError('ENOENT'));

    // Act
    const renaming = renameWithRetry(rename, 'state.json.tmp', 'state.json', NO_DELAY);

    // Assert
    await expect(renaming).rejects.toMatchObject({ code: 'ENOENT' });
    expect(rename).toHaveBeenCalledTimes(1);
  });
});
