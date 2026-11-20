import { vi } from 'vitest';
import type { Logger } from '../logger';

/**
 * Logger for tests: every level is a mock, so a change to the Logger interface touches only this
 * file instead of every test.
 * @param overrides Mocks a test wants to inspect, e.g. `{ error: logError }`.
 * @returns The logger.
 */
export function createFakeLogger(overrides: Partial<Logger> = {}): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), ...overrides };
}
