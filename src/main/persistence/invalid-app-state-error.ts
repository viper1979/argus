/** Raised when Argus is about to save a state that the next start could not read back. */
export class InvalidAppStateError extends Error {
  /**
   * @param issues One `path: message` entry per schema violation; never contains values.
   */
  constructor(readonly issues: readonly string[]) {
    super(`Refusing to save an invalid state: ${issues.join('; ')}`);
    this.name = 'InvalidAppStateError';
  }
}
