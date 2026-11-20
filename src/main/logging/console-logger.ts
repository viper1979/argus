import type { Logger } from './logger';

/**
 * Creates a logger that writes to the main process console with a scope prefix.
 * Placeholder until a file-based log is needed.
 * @param scope Prefix that identifies the emitting module, e.g. `ipc`.
 * @returns Logger writing to stdout/stderr.
 */
export function createConsoleLogger(scope: string): Logger {
  return {
    info: (message, context) => {
      console.info(`[${scope}] ${message}`, context);
    },
    warn: (message, context) => {
      console.warn(`[${scope}] ${message}`, context);
    },
    error: (message, context) => {
      console.error(`[${scope}] ${message}`, context);
    },
  };
}
