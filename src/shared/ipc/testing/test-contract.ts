import { z } from 'zod';
import type { IpcContractShape } from '../contract-types';

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
