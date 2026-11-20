import { useEffect, useState } from 'react';
import { INVALID_BRANCH_NAME_MESSAGE, isValidBranchName } from '@shared/domain/git-ref-name';
import type { Project } from '@shared/domain/project';
import type { CreateTaskRequest, CreateTaskResult } from '@shared/domain/task';
import { buildTaskLocation, sanitizeTaskName } from '@shared/domain/task-name';
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

/** German message per reason why a task could not be created. */
const CREATE_FAILURE_MESSAGES: Record<Extract<CreateTaskResult, { ok: false }>['reason'], string> =
  {
    'project-not-found': 'Das Projekt existiert nicht mehr. Bitte den Dialog schließen.',
    'worktree-root-missing': 'Bitte zuerst in den Einstellungen einen WorktreeRoot festlegen.',
    'invalid-task-name': 'Der Name braucht mindestens einen Buchstaben oder eine Ziffer.',
    'prefix-branch-exists':
      'Im Repository gibt es bereits einen Branch, der wie der Branch-Präfix heißt. Bitte in den Projekt-Einstellungen einen anderen Branch-Präfix wählen.',
    'fetch-failed':
      'Der Basis-Branch konnte nicht von origin geholt werden. Bitte die Netzwerkverbindung prüfen und es erneut versuchen.',
    'base-branch-unknown': 'Den Basis-Branch gibt es weder auf origin noch lokal.',
    'branch-exists':
      'Der Branch wurde gerade von außerhalb angelegt. Bitte es erneut versuchen, Argus wählt dann einen freien Namen.',
    'path-exists':
      'Der Worktree-Ordner wurde gerade von außerhalb angelegt. Bitte es erneut versuchen, Argus wählt dann einen freien Namen.',
    'worktree-failed': 'Git konnte den Worktree nicht anlegen. Details stehen im Log.',
    'git-unavailable':
      'Git wurde nicht gefunden. Bitte Git for Windows installieren und Argus neu starten.',
  };

/** Shown when creating fails for a technical reason; details are in the log. */
const UNEXPECTED_CREATE_ERROR_MESSAGE = 'Der Task konnte nicht angelegt werden.';

interface CreateTaskDialogProps {
  /** Project the task is created in; the dialog is closed while this is `null`. */
  readonly project: Project | null;
  /** Creates the task and reports whether that worked. */
  readonly onCreate: (request: CreateTaskRequest) => Promise<CreateTaskResult>;
  /** Called when the dialog should close, after creating or on cancel. */
  readonly onClose: () => void;
  /** Opens the global settings, e.g. to set the missing worktree root. */
  readonly onOpenSettings: () => void;
}

/** Creates a task with its own worktree and branch (concept 5.2). */
export function CreateTaskDialog(props: CreateTaskDialogProps): React.JSX.Element {
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
          <DialogTitle>Task anlegen</DialogTitle>
          <DialogDescription>Projekt {project?.name}</DialogDescription>
        </DialogHeader>
        {/* Keyed by id so the form starts empty and with the project's defaults every time. */}
        {project && <CreateTaskForm key={project.id} {...props} project={project} />}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Loads the worktree root, which decides whether a task can be created at all.
 * @returns The worktree root, `null` if none is set, or `undefined` while loading.
 */
function useWorktreeRoot(): string | null | undefined {
  const [worktreeRoot, setWorktreeRoot] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let isCancelled = false;
    window.argus.settings
      .get({})
      .then((settings) => {
        if (!isCancelled) {
          setWorktreeRoot(settings.worktreeRoot);
        }
      })
      .catch((error: unknown) => {
        // Treat as "not set": main rejects the creation anyway if the root is missing.
        console.error('Could not load settings', error);
        if (!isCancelled) {
          setWorktreeRoot(null);
        }
      });
    return () => {
      isCancelled = true;
    };
  }, []);

  return worktreeRoot;
}

/** The form inside {@link CreateTaskDialog}; holds the unsaved values. */
function CreateTaskForm(
  props: CreateTaskDialogProps & { readonly project: Project },
): React.JSX.Element {
  const { project, onCreate, onClose, onOpenSettings } = props;
  const worktreeRoot = useWorktreeRoot();
  const [name, setName] = useState('');
  const [baseBranch, setBaseBranch] = useState(project.mainBranch);
  const [startPrompt, setStartPrompt] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const taskName = sanitizeTaskName(name);
  const trimmedBaseBranch = baseBranch.trim();
  const isBaseBranchValid = isValidBranchName(trimmedBaseBranch);
  const canCreate = typeof worktreeRoot === 'string' && taskName !== '' && isBaseBranchValid;
  // Shows where the task will end up; main may still append a number if the name is taken.
  const previewLocation =
    taskName !== '' && typeof worktreeRoot === 'string'
      ? buildTaskLocation(worktreeRoot, project, taskName)
      : null;

  /** Creates the task; closes the dialog on success, otherwise shows why it failed. */
  async function handleSubmit(event: React.SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setIsCreating(true);
    setCreateError(null);
    try {
      const result = await onCreate({
        projectId: project.id,
        name,
        baseBranch: trimmedBaseBranch,
        // An empty prompt means "start without prompt", stored as null.
        startPrompt: startPrompt.trim() === '' ? null : startPrompt,
        agentType: project.defaultAgentType,
      });
      if (result.ok) {
        onClose();
      } else {
        setCreateError(CREATE_FAILURE_MESSAGES[result.reason]);
      }
    } finally {
      setIsCreating(false);
    }
  }

  if (worktreeRoot === null) {
    return (
      <div className="grid gap-4">
        <p role="alert" className="text-sm">
          {CREATE_FAILURE_MESSAGES['worktree-root-missing']}
        </p>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Abbrechen
          </Button>
          <Button
            type="button"
            onClick={() => {
              onClose();
              onOpenSettings();
            }}
          >
            Einstellungen öffnen
          </Button>
        </DialogFooter>
      </div>
    );
  }

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        handleSubmit(event).catch((error: unknown) => {
          // Rejected requests and handler failures are logged in the main process as well.
          console.error('Could not create task', error);
          setCreateError(UNEXPECTED_CREATE_ERROR_MESSAGE);
        });
      }}
    >
      <FormField
        label="Task-Name"
        error={
          name.trim() !== '' && taskName === ''
            ? CREATE_FAILURE_MESSAGES['invalid-task-name']
            : undefined
        }
      >
        {(id) => (
          <Input
            id={id}
            autoFocus
            placeholder="z. B. Login Refactoring"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
        )}
      </FormField>
      {previewLocation && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <dt>Branch</dt>
          <dd className="truncate font-mono">{previewLocation.branch}</dd>
          <dt>Ordner</dt>
          {/* Long roots are cut off; the tooltip shows the whole path. */}
          <dd className="truncate font-mono" title={previewLocation.worktreePath}>
            {previewLocation.worktreePath}
          </dd>
          <dd className="col-span-2">Ist der Name schon vergeben, hängt Argus eine Nummer an.</dd>
        </dl>
      )}
      <div className="grid grid-cols-2 gap-4">
        <FormField
          label="Basis-Branch"
          error={isBaseBranchValid ? undefined : INVALID_BRANCH_NAME_MESSAGE}
        >
          {(id) => (
            <Input
              id={id}
              value={baseBranch}
              onChange={(event) => {
                setBaseBranch(event.target.value);
              }}
            />
          )}
        </FormField>
        <FormField label="Agent-Typ">
          {/* Only one agent type exists in the MVP, so it is shown but not selectable. */}
          {(id) => <Input id={id} value={AGENT_TYPE_LABELS[project.defaultAgentType]} disabled />}
        </FormField>
      </div>
      <FormField label="Start-Prompt (optional)">
        {(id) => (
          <Textarea
            id={id}
            rows={4}
            value={startPrompt}
            onChange={(event) => {
              setStartPrompt(event.target.value);
            }}
          />
        )}
      </FormField>
      {createError && (
        <p role="alert" className="text-sm text-destructive">
          {createError}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Abbrechen
        </Button>
        <Button type="submit" disabled={!canCreate || isCreating}>
          {isCreating ? 'Wird angelegt …' : 'Anlegen'}
        </Button>
      </DialogFooter>
    </form>
  );
}
