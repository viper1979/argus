import { useState } from 'react';
import { APPEARANCES, type Appearance, type Settings } from '@shared/domain/settings';
import { Button } from '@renderer/components/ui/button';
import { Label } from '@renderer/components/ui/label';

/** Shown when the appearance cannot be saved; details are in the log. */
const SAVE_ERROR_MESSAGE = 'Die Darstellung konnte nicht gespeichert werden.';

/** UI text per appearance; UI texts are German. */
const APPEARANCE_LABELS: Record<Appearance, string> = {
  system: 'System',
  light: 'Hell',
  dark: 'Dunkel',
};

/** Id that ties the label to the group of buttons for screen readers. */
const LABEL_ID = 'appearance-label';

interface AppearanceSettingsProps {
  /** The stored settings; the pressed button shows their appearance. */
  readonly settings: Settings;
  /**
   * Called with the stored settings after the appearance was saved.
   * @param settings Settings as the main process stored them.
   */
  readonly onSaved: (settings: Settings) => void;
}

/**
 * "Darstellung" in the settings dialog (#22). A click saves right away; the main process then
 * switches the mode and the whole app, including open terminals, follows without a restart.
 */
export function AppearanceSettings(props: AppearanceSettingsProps): React.JSX.Element {
  const { settings, onSaved } = props;
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  /**
   * Saves the chosen appearance.
   * @param appearance The appearance the user clicked.
   */
  async function saveAppearance(appearance: Appearance): Promise<void> {
    setSaveError(null);
    setIsSaving(true);
    try {
      onSaved(await window.argus.settings.update({ appearance }));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="grid gap-2">
      <Label id={LABEL_ID}>Darstellung</Label>
      <p className="text-xs text-muted-foreground">
        „System“ folgt dem hellen oder dunklen Modus von Windows.
      </p>
      <div role="group" aria-labelledby={LABEL_ID} className="flex gap-2">
        {APPEARANCES.map((appearance) => {
          const isSelected = settings.appearance === appearance;
          return (
            <Button
              key={appearance}
              type="button"
              variant={isSelected ? 'default' : 'outline'}
              aria-pressed={isSelected}
              disabled={isSaving}
              onClick={() => {
                if (isSelected) {
                  return;
                }
                saveAppearance(appearance).catch((error: unknown) => {
                  console.error('Could not save the appearance', error);
                  setSaveError(SAVE_ERROR_MESSAGE);
                });
              }}
            >
              {APPEARANCE_LABELS[appearance]}
            </Button>
          );
        })}
      </div>
      {saveError && (
        <p role="alert" className="text-sm text-destructive">
          {saveError}
        </p>
      )}
    </div>
  );
}
