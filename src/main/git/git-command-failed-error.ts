/**
 * Raised when a git query that must always succeed in a valid repository fails, e.g. because the
 * repository was moved or is damaged. Distinct from {@link GitUnavailableError}: git ran.
 */
export class GitCommandFailedError extends Error {
  /**
   * @param command Arguments after `git`, for the log.
   * @param exitCode Exit code git ended with.
   * @param gitMessage Error output of git, explaining the failure.
   */
  constructor(
    readonly command: readonly string[],
    readonly exitCode: number,
    readonly gitMessage: string,
  ) {
    super(`git ${command.join(' ')} failed with exit code ${exitCode}: ${gitMessage}`);
    this.name = 'GitCommandFailedError';
  }
}
