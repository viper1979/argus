/** A shell could not be started because its executable does not exist (e.g. no `pwsh` installed). */
export class ShellExecutableNotFoundError extends Error {
  /**
   * @param executable The program that was not found.
   * @param cause The original error of the PTY library.
   */
  constructor(
    readonly executable: string,
    cause: unknown,
  ) {
    super(`Shell executable not found: ${executable}`, { cause });
    this.name = 'ShellExecutableNotFoundError';
  }
}
