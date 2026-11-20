/** Structured logging sink of the main process. */
export interface Logger {
  /**
   * Logs a normal event worth tracing, e.g. a received hook event.
   * @param message Human-readable description including the affected resource.
   * @param context Structured details; must never contain sensitive payload values.
   */
  info(message: string, context: Record<string, unknown>): void;

  /**
   * Logs an expected problem, e.g. rejected untrusted input.
   * @param message Human-readable description including the affected resource.
   * @param context Structured details; must never contain sensitive payload values.
   */
  warn(message: string, context: Record<string, unknown>): void;

  /**
   * Logs a failure that indicates a bug or an unavailable resource.
   * @param message Human-readable description including the affected resource.
   * @param context Structured details; must never contain sensitive payload values.
   */
  error(message: string, context: Record<string, unknown>): void;
}
