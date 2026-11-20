import { z } from 'zod';

/**
 * Absolute Windows path: drive letter with backslash (`D:\...`) or UNC (`\\server\share...`).
 * A regex instead of `node:path`, because this schema also runs in the renderer without Node.
 */
const ABSOLUTE_WINDOWS_PATH = /^(?:[A-Za-z]:\\|\\\\[^\\]+\\[^\\]+)/;

/** Global settings of Argus. */
export const settingsSchema = z.object({
  /** Folder under which task worktrees are created; `null` until the user picks one. */
  worktreeRoot: z
    .string()
    .regex(ABSOLUTE_WINDOWS_PATH, 'Der WorktreeRoot muss ein absoluter Pfad sein')
    .nullable(),
});

/** Global settings of Argus. */
export type Settings = z.infer<typeof settingsSchema>;
