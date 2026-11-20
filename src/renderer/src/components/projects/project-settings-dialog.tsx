import { useState } from 'react';
import {
  INVALID_BRANCH_NAME_MESSAGE,
  isValidBranchName,
  isValidBranchPrefix,
} from '@shared/domain/git-ref-name';
import type { Project, ProjectSettings, UpdateProjectResult } from '@shared/domain/project';
import { isValidWindowsFolderName } from '@shared/domain/windows-folder-name';
import { FormField } from '@renderer/components/forms/form-field';
import { Button } from '@renderer/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/components/ui/dialog';
import { Input } from '@renderer/components/ui/input';
import { Textarea } from '@renderer/components/ui/textarea';
import { AGENT_TYPE_LABELS } from '@renderer/lib/agent-type-labels';

/** German message per reason why the settings could not be saved. */
const UPDATE_FAILURE_MESSAGES: Record<
  Extract<UpdateProjectResult, { ok: false }>['reason'],
  string
> = {
  'not-found': 'Das Projekt existiert nicht mehr. Bitte den Dialog schließen.',
  'name-taken': 'Ein anderes Projekt hat bereits diesen Namen.',
};

/** Shown when saving fails for a technical reason; details are in the log. */
const UNEXPECTED_SAVE_ERROR_MESSAGE = 'Die Einstellungen konnten nicht gespeichert werden.';

interface ProjectSettingsDialogProps {
  /** Project being edited; the dialog is closed while this is `null`. */
  readonly project: Project | null;
  /** Saves the settings and reports whether that worked. */
  readonly onSave: (projectId: string, settings: ProjectSettings) => Promise<UpdateProjectResult>;
  /** Called when the dialog should close, after saving or on cancel. */
  readonly onClose: () => void;
}

/**
 * Edits the settings of one project: name, main branch, branch prefix, agent type, setup script.
 * Opened right after adding a project so the detected main branch can be checked.
 */
export function ProjectSettingsDialog(props: ProjectSettingsDialogProps): React.JSX.Element {
  const { project, onClose } = props;

  return (
    <Dialog
      open={project !== null}
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Projekt-Einstellungen</DialogTitle>
          <DialogDescription>{project?.repoPath}</DialogDescription>
        </DialogHeader>
        {/* Keyed by id so the form starts from the project's values every time it opens. */}
        {project && <ProjectSettingsForm key={project.id} {...props} project={project} />}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Validates the form values with the same rules as the schema in the main process.
 * @param values Trimmed name, main branch and prefix.
 * @returns A German message per invalid field; fields without entry are valid.
 */
function validateProjectSettings(values: {
  name: string;
  mainBranch: string;
  branchPrefix: string;
}): Partial<Record<'name' | 'mainBranch' | 'branchPrefix', string>> {
  const errors: Partial<Record<'name' | 'mainBranch' | 'branchPrefix', string>> = {};
  if (!isValidWindowsFolderName(values.name)) {
    errors.name =
      'Der Name wird zum Ordnernamen: nicht leer, ohne \\ / : * ? " < > | und nicht mit Punkt oder Leerzeichen am Ende.';
  }
  if (!isValidBranchName(values.mainBranch)) {
    errors.mainBranch = INVALID_BRANCH_NAME_MESSAGE;
  }
  if (!isValidBranchPrefix(values.branchPrefix)) {
    errors.branchPrefix =
      'Ein gültiges Branch-Segment ohne „/“, Leerzeichen und „..“, z. B. „agent“. Daraus wird „agent/<task-name>“.';
  }
  return errors;
}

/** The form inside {@link ProjectSettingsDialog}; holds the unsaved values. */
function ProjectSettingsForm(
  props: ProjectSettingsDialogProps & { readonly project: Project },
): React.JSX.Element {
  const { project, onSave, onClose } = props;
  const [name, setName] = useState(project.name);
  const [mainBranch, setMainBranch] = useState(project.mainBranch);
  const [branchPrefix, setBranchPrefix] = useState(project.branchPrefix);
  const [setupScript, setSetupScript] = useState(project.setupScript ?? '');
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const trimmedValues = {
    name: name.trim(),
    mainBranch: mainBranch.trim(),
    branchPrefix: branchPrefix.trim(),
  };
  const fieldErrors = validateProjectSettings(trimmedValues);
  const hasFieldErrors = Object.keys(fieldErrors).length > 0;

  /** Saves the form; closes the dialog on success, otherwise shows why it failed. */
  async function handleSubmit(event: React.SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setIsSaving(true);
    setSaveError(null);
    try {
      const result = await onSave(project.id, {
        ...trimmedValues,
        defaultAgentType: project.defaultAgentType,
        // An empty script means "no setup", stored as null.
        setupScript: setupScript.trim() === '' ? null : setupScript,
      });
      if (result.ok) {
        onClose();
      } else {
        setSaveError(UPDATE_FAILURE_MESSAGES[result.reason]);
      }
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        handleSubmit(event).catch((error: unknown) => {
          // Rejected requests and handler failures are logged in the main process as well.
          console.error('Could not save project settings', error);
          setSaveError(UNEXPECTED_SAVE_ERROR_MESSAGE);
        });
      }}
    >
      <FormField label="Name" error={fieldErrors.name}>
        {(id) => (
          <Input
            id={id}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
        )}
      </FormField>
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Haupt-Branch" error={fieldErrors.mainBranch}>
          {(id) => (
            <Input
              id={id}
              value={mainBranch}
              onChange={(event) => {
                setMainBranch(event.target.value);
              }}
            />
          )}
        </FormField>
        <FormField label="Branch-Präfix" error={fieldErrors.branchPrefix}>
          {(id) => (
            <Input
              id={id}
              value={branchPrefix}
              onChange={(event) => {
                setBranchPrefix(event.target.value);
              }}
            />
          )}
        </FormField>
      </div>
      <FormField label="Default-Agent-Typ">
        {/* Only one agent type exists in the MVP, so it is shown but not selectable. */}
        {(id) => <Input id={id} value={AGENT_TYPE_LABELS[project.defaultAgentType]} disabled />}
      </FormField>
      <FormField label="Setup-Skript (PowerShell, optional)">
        {(id) => (
          <Textarea
            id={id}
            className="font-mono text-xs"
            rows={4}
            placeholder="z. B. Copy-Item $env:ARGUS_ROOT_PATH\.env .env"
            value={setupScript}
            onChange={(event) => {
              setSetupScript(event.target.value);
            }}
          />
        )}
      </FormField>
      {saveError && (
        <p role="alert" className="text-sm text-destructive">
          {saveError}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Abbrechen
        </Button>
        <Button type="submit" disabled={hasFieldErrors || isSaving}>
          Speichern
        </Button>
      </DialogFooter>
    </form>
  );
}
