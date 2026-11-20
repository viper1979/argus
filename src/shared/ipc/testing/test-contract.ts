import { z } from 'zod';
import type { IpcContractShape, IpcEventContractShape } from '../contract-types';

/**
 * Contract used only by tests, so they stay independent of the real contract's growth.
 * Shared by the main-process and preload tests.
 */
export const testContract = {
  greeting: {
    greet: {
      request: z.object({ name: z.string().min(1) }),
      response: z.object({ message: z.string() }),
    },
  },
} as const satisfies IpcContractShape;

/** Event contract used only by tests; shares the `greeting` domain with {@link testContract}. */
export const testEventContract = {
  greeting: {
    greeted: z.object({ name: z.string() }),
  },
} as const satisfies IpcEventContractShape;
