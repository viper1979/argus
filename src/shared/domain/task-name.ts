import { isValidWindowsFolderName } from './windows-folder-name';

/**
 * Longest cleaned task name. Keeps `<WorktreeRoot>\<project>\<task-name>` and the branch short
 * enough for deep repositories under the Windows path limit and for readable terminal tabs.
 */
export const MAX_TASK_NAME_LENGTH = 50;

/**
 * German letters that are spelled out instead of losing their meaning (`für` → `fuer`).
 * Applied after lower-casing, so only the lower-case forms are needed.
 */
const GERMAN_TRANSLITERATIONS: Readonly<Record<string, string>> = {
  ä: 'ae',
  ö: 'oe',
  ü: 'ue',
  ß: 'ss',
};

/** Accents and other combining marks left over after splitting letters with NFD (`é` → `e` + `´`). */
const COMBINING_MARKS = /\p{M}/gu;

/** Every run of characters outside `a-z0-9` becomes one dash. */
const NON_ALPHANUMERIC_RUN = /[^a-z0-9]+/g;

/** Dashes at the start or end of a name. */
const OUTER_DASHES = /^-+|-+$/g;

/**
 * Turns a task name typed by the user into one that works as folder name and as branch segment:
 * lower-case ASCII words separated by dashes (concept 5.2, step 1).
 * @param input Name as typed, e.g. `Login Refactoring für Prüfstand!`.
 * @returns The cleaned name, e.g. `login-refactoring-fuer-pruefstand`.
 */
export function sanitizeTaskName(input: string): string {
  const transliterated = Array.from(input.toLowerCase(), (character) => {
    return GERMAN_TRANSLITERATIONS[character] ?? character;
  }).join('');
  // German letters are already spelled out, so stripping marks only affects other accents.
  const withoutAccents = transliterated.normalize('NFD').replace(COMBINING_MARKS, '');
  const kebabCase = withoutAccents.replace(NON_ALPHANUMERIC_RUN, '-').replace(OUTER_DASHES, '');
  // Trim dashes again: the cut may land right behind a word separator.
  return kebabCase.slice(0, MAX_TASK_NAME_LENGTH).replace(OUTER_DASHES, '');
}

/** Backslashes at the end of a Windows path, e.g. the one of a drive root `D:\`. */
const TRAILING_BACKSLASHES = /\\+$/;

/** Where a task lives in git and on disk; both derive from the same task name. */
export interface TaskLocation {
  /** E.g. `agent/login`. */
  readonly branch: string;
  /** E.g. `D:\Worktrees\Webshop\login`. */
  readonly worktreePath: string;
}

/**
 * Builds branch and worktree folder of a task in one step, so both always use the same name.
 * @param worktreeRoot Absolute Windows path from the settings.
 * @param project Name (folder below the worktree root) and branch prefix of the project.
 * @param taskName A cleaned task name.
 * @returns Branch and worktree path.
 */
export function buildTaskLocation(
  worktreeRoot: string,
  project: { readonly name: string; readonly branchPrefix: string },
  taskName: string,
): TaskLocation {
  return {
    branch: buildTaskBranch(project.branchPrefix, taskName),
    worktreePath: buildWorktreePath(worktreeRoot, project.name, taskName),
  };
}

/**
 * Builds the folder of a task's worktree: `<WorktreeRoot>\<project>\<task-name>` (concept 5.2).
 * String-based instead of `node:path`, because this module also runs in the renderer.
 * @param worktreeRoot Absolute Windows path from the settings, e.g. `D:\Worktrees` or `D:\`.
 * @param projectName Name of the project; already a valid folder name.
 * @param taskName A free task name from {@link findFreeTaskName}.
 * @returns E.g. `D:\Worktrees\Webshop\login`.
 */
export function buildWorktreePath(
  worktreeRoot: string,
  projectName: string,
  taskName: string,
): string {
  return [worktreeRoot.replace(TRAILING_BACKSLASHES, ''), projectName, taskName].join('\\');
}

/**
 * Builds the branch of a task: `<prefix>/<task-name>` (concept 5.1 and 5.2).
 * @param branchPrefix Single ref segment from the project, e.g. `agent`.
 * @param taskName A free task name from {@link findFreeTaskName}.
 * @returns E.g. `agent/login`.
 */
export function buildTaskBranch(branchPrefix: string, taskName: string): string {
  return `${branchPrefix}/${taskName}`;
}

/** First number appended to a task name that is already taken, as in `login-2`. */
const FIRST_NAME_SUFFIX_NUMBER = 2;

/**
 * Finds a task name nobody uses yet, numbering it if necessary (concept 5.2, step 1).
 * @param baseName A cleaned name from {@link sanitizeTaskName}.
 * @param isTaken Tells whether a candidate is in use, e.g. by a task, a branch or a folder.
 * @returns `baseName`, or `baseName-2`, `baseName-3`, ... if it is taken.
 */
export async function findFreeTaskName(
  baseName: string,
  isTaken: (candidate: string) => Promise<boolean>,
): Promise<string> {
  let candidate = baseName;
  for (let number = FIRST_NAME_SUFFIX_NUMBER; await isUnusable(candidate, isTaken); number++) {
    candidate = appendNumber(baseName, number);
  }
  return candidate;
}

/**
 * Checks whether a candidate cannot be used: Windows reserves some names that pass the cleaning,
 * e.g. `con` or `nul`, and others are already in use.
 * @param candidate Candidate task name.
 * @param isTaken Tells whether a candidate is in use.
 * @returns `true` if the next candidate has to be tried.
 */
async function isUnusable(
  candidate: string,
  isTaken: (candidate: string) => Promise<boolean>,
): Promise<boolean> {
  return !isValidWindowsFolderName(candidate) || (await isTaken(candidate));
}

/**
 * Appends a number to a task name and shortens the name first, so the result still fits into
 * {@link MAX_TASK_NAME_LENGTH}.
 * @param baseName A cleaned task name.
 * @param number The number to append.
 * @returns E.g. `login-2`.
 */
function appendNumber(baseName: string, number: number): string {
  const suffix = `-${number}`;
  const shortenedBase = baseName
    .slice(0, MAX_TASK_NAME_LENGTH - suffix.length)
    .replace(OUTER_DASHES, '');
  return shortenedBase + suffix;
}
