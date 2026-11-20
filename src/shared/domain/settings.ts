import { z } from 'zod';

/**
 * Absolute Windows path: drive letter with backslash (`D:\...`) or UNC (`\\server\share...`).
 * A regex instead of `node:path`, because this schema also runs in the renderer without Node.
 */
const ABSOLUTE_WINDOWS_PATH = /^(?:[A-Za-z]:\\|\\\\[^\\]+\\[^\\]+)/;

/** Terminal font family before it became configurable (#21): the Windows Terminal default. */
export const DEFAULT_TERMINAL_FONT_FAMILY = 'Cascadia Mono';

/** Terminal font size in pixels before it became configurable (#21). */
export const DEFAULT_TERMINAL_FONT_SIZE = 13;

/** Longest font family name Argus accepts; real names are far shorter. */
export const MAX_TERMINAL_FONT_FAMILY_LENGTH = 100;

/**
 * Exactly one font family name. Argus puts it in double quotes inside a CSS font-family list
 * (`"<name>", monospace`), so quotes, backslashes (CSS escapes), commas (a second family) and
 * semicolons must not occur; control characters (\p{Cc}) are never part of a font name.
 */
const SINGLE_FONT_FAMILY_NAME = /^[^"',;\\\p{Cc}]+$/u;

/** Smallest terminal font size; below it the text is unreadable. */
export const MIN_TERMINAL_FONT_SIZE = 8;

/** Largest terminal font size; above it a terminal has too few columns to be usable. */
export const MAX_TERMINAL_FONT_SIZE = 32;

/** One message for every invalid size (no number, fraction, out of range); UI texts are German. */
const INVALID_FONT_SIZE_MESSAGE = `Die Schriftgröße muss eine ganze Zahl von ${String(MIN_TERMINAL_FONT_SIZE)} bis ${String(MAX_TERMINAL_FONT_SIZE)} sein.`;

/** Folder under which task worktrees are created; `null` until the user picks one. */
const worktreeRootSchema = z
  .string()
  .regex(ABSOLUTE_WINDOWS_PATH, 'Der WorktreeRoot muss ein absoluter Pfad sein')
  .nullable();

/** One font family name for all terminals (#21). */
const terminalFontFamilySchema = z
  .string()
  .trim()
  .min(1, 'Die Terminal-Schrift darf nicht leer sein.')
  .max(
    MAX_TERMINAL_FONT_FAMILY_LENGTH,
    `Die Terminal-Schrift darf höchstens ${String(MAX_TERMINAL_FONT_FAMILY_LENGTH)} Zeichen lang sein.`,
  )
  .regex(
    SINGLE_FONT_FAMILY_NAME,
    'Bitte genau einen Schriftnamen eingeben, ohne Anführungszeichen, Komma, Semikolon oder Backslash.',
  );

/** Font size of all terminals in pixels (#21). */
const terminalFontSizeSchema = z
  // NaN and Infinity (e.g. an empty field) fail the type check itself; without its own message
  // zod would show its English default (verified with zod 4.6.7).
  .number({ error: INVALID_FONT_SIZE_MESSAGE })
  .int(INVALID_FONT_SIZE_MESSAGE)
  .min(MIN_TERMINAL_FONT_SIZE, INVALID_FONT_SIZE_MESSAGE)
  .max(MAX_TERMINAL_FONT_SIZE, INVALID_FONT_SIZE_MESSAGE);

/** Global settings of Argus. */
export const settingsSchema = z.object({
  worktreeRoot: worktreeRootSchema,
  /** Added with #21; missing in older files. */
  terminalFontFamily: terminalFontFamilySchema.default(DEFAULT_TERMINAL_FONT_FAMILY),
  /** Added with #21; missing in older files. */
  terminalFontSize: terminalFontSizeSchema.default(DEFAULT_TERMINAL_FONT_SIZE),
});

/** Global settings of Argus. */
export type Settings = z.infer<typeof settingsSchema>;

/** Settings of a fresh installation: no worktree root yet, the default terminal font. */
export const DEFAULT_SETTINGS: Settings = {
  worktreeRoot: null,
  terminalFontFamily: DEFAULT_TERMINAL_FONT_FAMILY,
  terminalFontSize: DEFAULT_TERMINAL_FONT_SIZE,
};

/**
 * Change of some settings, merged into the stored ones by the main process. Built from the field
 * schemas without defaults: `settingsSchema.partial()` would fill in the defaults and so reset
 * every field the patch does not mention (verified with zod 4.6.7).
 */
export const settingsPatchSchema = z
  .object({
    worktreeRoot: worktreeRootSchema,
    terminalFontFamily: terminalFontFamilySchema,
    terminalFontSize: terminalFontSizeSchema,
  })
  .partial()
  .strict();

/** Change of some settings. */
export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

/**
 * Merges a patch into the stored settings. A field the patch does not mention keeps its value;
 * `worktreeRoot: null` is a value and clears the root, so `??` must not be used for it.
 * @param settings The stored settings.
 * @param patch Validated change from the renderer.
 * @returns New settings; the inputs are not modified.
 */
export function applySettingsPatch(settings: Settings, patch: SettingsPatch): Settings {
  return {
    worktreeRoot: patch.worktreeRoot === undefined ? settings.worktreeRoot : patch.worktreeRoot,
    terminalFontFamily: patch.terminalFontFamily ?? settings.terminalFontFamily,
    terminalFontSize: patch.terminalFontSize ?? settings.terminalFontSize,
  };
}
