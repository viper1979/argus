import { setTimeout as delay } from 'node:timers/promises';

/** How often and how fast a locked rename is retried. */
export interface RenameRetryOptions {
  /** Total number of rename attempts, including the first one. */
  readonly maxAttempts: number;
  /** Pause between two attempts. */
  readonly delayMilliseconds: number;
}

/**
 * Error codes Windows reports when another process (virus scanner, indexer, backup tool)
 * briefly holds the target file open. Such locks usually disappear within milliseconds.
 */
const TRANSIENT_LOCK_ERROR_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);

/**
 * Renames a file and retries while the target is briefly locked by another process.
 * Any other error, and a lock that outlasts all attempts, is passed on unchanged.
 * @param rename The rename operation, e.g. `fs.promises.rename`.
 * @param fromPath Current path.
 * @param toPath New path; replaced if it exists.
 * @param options Number of attempts and pause between them.
 */
export async function renameWithRetry(
  rename: (fromPath: string, toPath: string) => Promise<void>,
  fromPath: string,
  toPath: string,
  options: RenameRetryOptions,
): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await rename(fromPath, toPath);
      return;
    } catch (error: unknown) {
      const isLastAttempt = attempt >= options.maxAttempts;
      if (isLastAttempt || !isTransientLockError(error)) {
        throw error;
      }
      await delay(options.delayMilliseconds);
    }
  }
}

/**
 * Checks whether a file system error means "locked by someone else, try again shortly".
 * @param error The caught error.
 * @returns `true` for the lock error codes Windows uses.
 */
function isTransientLockError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string' &&
    TRANSIENT_LOCK_ERROR_CODES.has(error.code)
  );
}
