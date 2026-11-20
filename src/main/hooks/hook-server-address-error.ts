/**
 * Raised when the hook server listens but reports no TCP address (e.g. a pipe instead of a port).
 * Then no hook settings file can carry its port, so agent sessions report `hooks-unavailable`.
 */
export class HookServerAddressError extends Error {
  /**
   * @param address What the server reported instead of a TCP address.
   */
  constructor(readonly address: string | null) {
    super(`Hook server has no TCP address after listening (got ${String(address)})`);
    this.name = 'HookServerAddressError';
  }
}
