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

/** Values of the setting "Darstellung" (#22): follow Windows, always light or always dark. */
export const APPEARANCES = ['system', 'light', 'dark'] as const;

/** Light or dark for the whole app, including terminals and native parts (#22). */
const appearanceSchema = z.enum(APPEARANCES, {
  error: 'Die Darstellung muss „System“, „Hell“ oder „Dunkel“ sein.',
});

/** Value of the setting "Darstellung". */
export type Appearance = z.infer<typeof appearanceSchema>;

/** Appearance of a fresh installation and of files written before #22: follow Windows. */
export const DEFAULT_APPEARANCE: Appearance = 'system';

/**
 * Validation of every setting without defaults. The patch schema is built from it, because
 * `settingsSchema.partial()` would fill in the defaults and so reset every field a patch does not
 * mention (verified with zod 4.6.7). A new setting gets one entry here and one in `settingsSchema`.
 */
const settingsFieldSchemas = {
  worktreeRoot: worktreeRootSchema,
  terminalFontFamily: terminalFontFamilySchema,
  terminalFontSize: terminalFontSizeSchema,
  appearance: appearanceSchema,
};

/** Global settings of Argus. Every field has a default, so older `state.json` files stay readable. */
export const settingsSchema = z.object({
  worktreeRoot: settingsFieldSchemas.worktreeRoot.default(null),
  /** Added with #21; missing in older files. */
  terminalFontFamily: settingsFieldSchemas.terminalFontFamily.default(DEFAULT_TERMINAL_FONT_FAMILY),
  /** Added with #21; missing in older files. */
  terminalFontSize: settingsFieldSchemas.terminalFontSize.default(DEFAULT_TERMINAL_FONT_SIZE),
  /** Added with #22; missing in older files. */
  appearance: settingsFieldSchemas.appearance.default(DEFAULT_APPEARANCE),
});

/** Global settings of Argus. */
export type Settings = z.infer<typeof settingsSchema>;

/** Settings of a fresh installation, taken from the defaults of `settingsSchema`. */
export const DEFAULT_SETTINGS: Settings = settingsSchema.parse({});

/** Change of some settings, merged into the stored ones by the main process. */
export const settingsPatchSchema = z.object(settingsFieldSchemas).partial().strict();

/** Change of some settings. */
export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

/**
 * Merges a patch into the stored settings. A field the patch does not mention (missing or
 * `undefined`) keeps its value; `worktreeRoot: null` is a value and clears the root.
 * @param settings The stored settings.
 * @param patch Validated change from the renderer.
 * @returns New settings; the inputs are not modified.
 */
export function applySettingsPatch(settings: Settings, patch: SettingsPatch): Settings {
  const mentionedFields = Object.entries(patch).filter(([, value]) => value !== undefined);
  return { ...settings, ...(Object.fromEntries(mentionedFields) as Partial<Settings>) };
}
