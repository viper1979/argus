import { mkdir, open, readFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Logger } from '../logging/logger';
import { summarizeZodIssues } from '../validation/summarize-zod-issues';
import { appStateSchema, createEmptyAppState, type AppState } from './app-state';
import { InvalidAppStateError } from './invalid-app-state-error';
import { renameWithRetry, type RenameRetryOptions } from './rename-with-retry';

/** Reads and writes the persisted state of Argus. */
export interface StateStore {
  /**
   * Reads the state from disk.
   * @returns The stored state, or an empty state if there is none yet.
   */
  load(): Promise<AppState>;

  /**
   * Writes the state atomically: a crash while saving never leaves a half-written file.
   * @param state The complete state to persist.
   */
  save(state: AppState): Promise<void>;
}

/** Everything the store needs; `now` makes backup names deterministic in tests. */
export interface StateStoreOptions {
  readonly filePath: string;
  readonly logger: Logger;
  readonly now: () => Date;
}

/** Suffix of the file a new state is written to before it replaces `state.json`. */
const TEMPORARY_FILE_SUFFIX = '.tmp';

/**
 * Retries for replacing `state.json` while a virus scanner or indexer holds it: up to
 * 15 attempts over roughly 1.5 s, since scanners can keep a fresh file open for a second.
 */
const RENAME_RETRY: RenameRetryOptions = { maxAttempts: 15, delayMilliseconds: 100 };

/** Inserted between the file name and the timestamp of a corrupt file's backup. */
const CORRUPT_BACKUP_INFIX = '.corrupt-';

/** Indentation of the written JSON, so that the file stays readable for humans. */
const JSON_INDENTATION = 2;

/**
 * Creates a store for `state.json`.
 * @param options File location, logger and clock.
 * @returns The store.
 */
export function createStateStore(options: StateStoreOptions): StateStore {
  const { filePath, logger, now } = options;

  return {
    load: async () => {
      const content = await readFileIfExists(filePath);
      if (content === null) {
        return createEmptyAppState();
      }

      const state = parseAppState(content);
      if (state === null) {
        await backUpCorruptFile(filePath, now(), logger);
        return createEmptyAppState();
      }
      return state;
    },

    save: async (state) => {
      // Never write what the next start would reject: load() would move the whole file aside.
      const validation = appStateSchema.safeParse(state);
      if (!validation.success) {
        throw new InvalidAppStateError(summarizeZodIssues(validation.error));
      }
      const temporaryFilePath = filePath + TEMPORARY_FILE_SUFFIX;
      await mkdir(dirname(filePath), { recursive: true });
      await writeDurably(temporaryFilePath, JSON.stringify(state, null, JSON_INDENTATION));
      // rename replaces the target in one step, so readers see either the old or the new file.
      await renameWithRetry(rename, temporaryFilePath, filePath, RENAME_RETRY);
    },
  };
}

/**
 * Writes a file and flushes it to disk before returning. Without the flush, a crash right after
 * the following rename could leave an empty `state.json`, which would then be moved aside as
 * corrupt and all projects would be gone.
 * @param filePath Path of the file to write.
 * @param content Text content.
 */
async function writeDurably(filePath: string, content: string): Promise<void> {
  const file = await open(filePath, 'w');
  try {
    await file.writeFile(content, 'utf8');
    await file.sync();
  } catch (writeError: unknown) {
    // Close without letting a second failure hide the original write error.
    await file.close().catch(() => undefined);
    throw writeError;
  }
  await file.close();
}

/**
 * Parses the content of `state.json`.
 * @param content Raw file content.
 * @returns The state, or `null` if the content is no JSON or does not match the schema.
 */
function parseAppState(content: string): AppState | null {
  let rawState: unknown;
  try {
    rawState = JSON.parse(content);
  } catch (error: unknown) {
    if (error instanceof SyntaxError) {
      return null;
    }
    throw error;
  }
  const result = appStateSchema.safeParse(rawState);
  return result.success ? result.data : null;
}

/**
 * Moves an unreadable state file aside so that Argus can start empty without losing it.
 * @param filePath Path of the corrupt `state.json`.
 * @param timestamp Moment of the backup, part of the backup name.
 * @param logger Receives a warning with both paths.
 */
async function backUpCorruptFile(filePath: string, timestamp: Date, logger: Logger): Promise<void> {
  // Colons from the ISO format are not allowed in Windows file names.
  const fileSafeTimestamp = timestamp.toISOString().replace(/[:.]/g, '-');
  const backupPath = `${filePath}${CORRUPT_BACKUP_INFIX}${fileSafeTimestamp}`;
  await renameWithRetry(rename, filePath, backupPath, RENAME_RETRY);
  logger.warn('Unreadable state.json moved aside, starting with an empty state', {
    filePath,
    backupPath,
  });
}

/**
 * Reads a text file.
 * @param filePath Path of the file.
 * @returns The content, or `null` if the file does not exist.
 */
async function readFileIfExists(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error: unknown) {
    if (isFileNotFoundError(error)) {
      return null;
    }
    throw error;
  }
}

/**
 * Checks whether a file system error means that the file does not exist.
 * @param error The caught error.
 * @returns `true` for `ENOENT`.
 */
function isFileNotFoundError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
