import { useState } from 'react';
import type { Settings } from '@shared/domain/settings';
import { toTerminalFont } from '@shared/domain/terminal-font';
import { FormField } from '@renderer/components/forms/form-field';
import { Button } from '@renderer/components/ui/button';
import { Input } from '@renderer/components/ui/input';
import {
  validateFontDraft,
  type FontDraft,
  type FontFieldErrors,
} from '@renderer/components/settings/terminal-font-draft';
import { isFontInstalled } from '@renderer/terminals/font-detection';
import { applyTerminalFont } from '@renderer/terminals/terminal-views';

/** Shown when the font cannot be saved; details are in the log. */
const SAVE_ERROR_MESSAGE = 'Die Terminal-Schrift konnte nicht gespeichert werden.';

interface TerminalFontSettingsProps {
  /** The stored settings the inputs start with. */
  readonly settings: Settings;
  /**
   * Called with the stored settings after the font was saved.
   * @param settings Settings as the main process stored them.
   */
  readonly onSaved: (settings: Settings) => void;
}

/**
 * "Terminal-Schrift" and "Schriftgröße" in the settings dialog, applied with "Übernehmen" (#21).
 * The inputs start from `settings` once; the parent remounts this component (via `key`) when the
 * stored font changes.
 */
export function TerminalFontSettings(props: TerminalFontSettingsProps): React.JSX.Element {
  const { settings, onSaved } = props;
  const storedFont = toTerminalFont(settings);
  const [draft, setDraft] = useState<FontDraft>({
    fontFamily: storedFont.fontFamily,
    fontSize: String(storedFont.fontSize),
  });
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const validation = validateFontDraft(draft);
  const fieldErrors: FontFieldErrors = validation.ok ? {} : validation.errors;
  const isUnchanged =
    validation.ok &&
    validation.font.fontFamily === storedFont.fontFamily &&
    validation.font.fontSize === storedFont.fontSize;
  // Only for a valid name: an invalid one already shows its validation message.
  const isMissingFont = validation.ok && !isFontInstalled(validation.font.fontFamily);

  /** Saves the font and applies it to all terminals. */
  async function handleApply(): Promise<void> {
    if (!validation.ok) {
      return;
    }
    setSaveError(null);
    setIsSaving(true);
    try {
      const storedSettings = await window.argus.settings.update({
        terminalFontFamily: validation.font.fontFamily,
        terminalFontSize: validation.font.fontSize,
      });
      applyTerminalFont(toTerminalFont(storedSettings));
      onSaved(storedSettings);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        handleApply().catch((error: unknown) => {
          console.error('Could not save the terminal font', error);
          setSaveError(SAVE_ERROR_MESSAGE);
        });
      }}
    >
      <div className="grid grid-cols-[minmax(0,1fr)_8rem] gap-3">
        <FormField label="Terminal-Schrift" error={fieldErrors.fontFamily}>
          {(id) => (
            <Input
              id={id}
              value={draft.fontFamily}
              placeholder="z. B. CaskaydiaCove Nerd Font"
              onChange={(event) => {
                setDraft({ ...draft, fontFamily: event.target.value });
              }}
            />
          )}
        </FormField>
        <FormField label="Schriftgröße" error={fieldErrors.fontSize}>
          {(id) => (
            <Input
              id={id}
              type="number"
              inputMode="numeric"
              value={draft.fontSize}
              onChange={(event) => {
                setDraft({ ...draft, fontSize: event.target.value });
              }}
            />
          )}
        </FormField>
      </div>
      {isMissingFont && (
        <p className="text-xs text-muted-foreground">
          Diese Schrift ist nicht installiert. Die Terminals nutzen dann eine Ersatzschrift.
        </p>
      )}
      {saveError && (
        <p role="alert" className="text-sm text-destructive">
          {saveError}
        </p>
      )}
      <div className="flex justify-end">
        <Button type="submit" disabled={!validation.ok || isUnchanged || isSaving}>
          Übernehmen
        </Button>
      </div>
    </form>
  );
}
