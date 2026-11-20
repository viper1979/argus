import { settingsPatchSchema } from '@shared/domain/settings';
import type { TerminalFont } from '@shared/domain/terminal-font';

/** Font family and size as typed in the settings dialog, before validation. */
export interface FontDraft {
  readonly fontFamily: string;
  /** Raw text of the number field; may be empty or no number at all. */
  readonly fontSize: string;
}

/** Validation message per field; a missing key means the field is valid. */
export interface FontFieldErrors {
  readonly fontFamily?: string;
  readonly fontSize?: string;
}

/** Outcome of validating the typed font. */
export type FontDraftValidation =
  | { readonly ok: true; readonly font: TerminalFont }
  | { readonly ok: false; readonly errors: FontFieldErrors };

/**
 * Both font fields as required: the same rules the main process applies to the patch, but without
 * `partial()`, so a successful parse yields both values.
 */
const fontPatchSchema = settingsPatchSchema
  .pick({ terminalFontFamily: true, terminalFontSize: true })
  .required();

/**
 * Validates the typed font with the schema the main process uses, so the messages match.
 * @param draft Font family and size as typed.
 * @returns The validated font, or one message per invalid field (the first zod reports).
 */
export function validateFontDraft(draft: FontDraft): FontDraftValidation {
  const result = fontPatchSchema.safeParse({
    terminalFontFamily: draft.fontFamily,
    // An empty field must not become 0 (`Number('')`); NaN fails with the size message instead.
    terminalFontSize: draft.fontSize.trim() === '' ? Number.NaN : Number(draft.fontSize),
  });
  if (result.success) {
    return {
      ok: true,
      font: {
        fontFamily: result.data.terminalFontFamily,
        fontSize: result.data.terminalFontSize,
      },
    };
  }

  let fontFamilyError: string | undefined;
  let fontSizeError: string | undefined;
  for (const issue of result.error.issues) {
    // Keep the first message per field; later ones describe the same input.
    if (issue.path[0] === 'terminalFontFamily') {
      fontFamilyError ??= issue.message;
    } else if (issue.path[0] === 'terminalFontSize') {
      fontSizeError ??= issue.message;
    }
  }
  return {
    ok: false,
    errors: {
      ...(fontFamilyError === undefined ? {} : { fontFamily: fontFamilyError }),
      ...(fontSizeError === undefined ? {} : { fontSize: fontSizeError }),
    },
  };
}
