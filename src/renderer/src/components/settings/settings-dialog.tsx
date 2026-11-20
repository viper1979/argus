import { useEffect, useState } from 'react';
import type { Settings } from '@shared/domain/settings';
import { Button } from '@renderer/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@renderer/components/ui/dialog';
import { Label } from '@renderer/components/ui/label';
import { TerminalFontSettings } from '@renderer/components/settings/terminal-font-settings';

/** Shown when the settings cannot be read; details are in the log. */
const LOAD_ERROR_MESSAGE = 'Die Einstellungen konnten nicht geladen werden.';

/** Shown when the worktree root cannot be saved; details are in the log. */
const SAVE_ERROR_MESSAGE = 'Der WorktreeRoot konnte nicht gespeichert werden.';

interface SettingsDialogProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
}

/** Global settings of Argus: the worktree root and the terminal font. */
export function SettingsDialog(props: SettingsDialogProps): React.JSX.Element {
  const { isOpen, onClose } = props;
  const [settings, setSettings] = useState<Settings | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    window.argus.settings
      .get({})
      .then(setSettings)
      .catch((error: unknown) => {
        console.error('Could not load settings', error);
        setErrorMessage(LOAD_ERROR_MESSAGE);
      });
  }, [isOpen]);

  /** Lets the user pick the worktree root and saves it right away. */
  async function pickWorktreeRoot(): Promise<void> {
    setErrorMessage(null);
    const { folderPath } = await window.argus.dialog.pickFolder({ title: 'WorktreeRoot wählen' });
    if (folderPath === null) {
      return;
    }
    setSettings(await window.argus.settings.update({ worktreeRoot: folderPath }));
  }

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          // Reset here instead of on open: the next opening must not show an old error.
          setErrorMessage(null);
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Einstellungen</DialogTitle>
          <DialogDescription>Gelten für alle Projekte.</DialogDescription>
        </DialogHeader>
        <div className="grid min-w-0 gap-2">
          <Label>WorktreeRoot</Label>
          <p className="text-xs text-muted-foreground">
            Unter diesem Ordner legt Argus die Worktrees der Tasks an, je Projekt ein Unterordner.
          </p>
          <div className="flex min-w-0 items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md border border-border px-3 py-2 text-sm">
              {settings?.worktreeRoot ?? 'Nicht festgelegt'}
            </code>
            <Button
              variant="outline"
              onClick={() => {
                pickWorktreeRoot().catch((error: unknown) => {
                  // E.g. a path the schema rejects; details are logged in the main process too.
                  console.error('Could not change the worktree root', error);
                  setErrorMessage(SAVE_ERROR_MESSAGE);
                });
              }}
            >
              Ordner wählen
            </Button>
          </div>
          {errorMessage && (
            <p role="alert" className="text-sm text-destructive">
              {errorMessage}
            </p>
          )}
        </div>
        {settings && (
          <div className="grid min-w-0 gap-2 border-t border-border pt-4">
            <TerminalFontSettings
              // Remount when the stored font changes, so the inputs never show an outdated draft.
              key={`${settings.terminalFontFamily}|${String(settings.terminalFontSize)}`}
              settings={settings}
              onSaved={setSettings}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
