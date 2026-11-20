/** Raised when the `git` executable cannot be started, e.g. because it is not installed. */
export class GitUnavailableError extends Error {
  /**
   * @param cause The original error of the process start, e.g. with code `ENOENT`.
   */
  constructor(cause: unknown) {
    super('git could not be started; is Git for Windows installed and on the PATH?', { cause });
    this.name = 'GitUnavailableError';
  }
}
