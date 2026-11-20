import type { Project } from '@shared/domain/project';
import { Button } from '@renderer/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/components/ui/dialog';

interface RemoveProjectDialogProps {
  /** Project to remove; the dialog is closed while this is `null`. */
  readonly project: Project | null;
  readonly onConfirm: (projectId: string) => void;
  readonly onClose: () => void;
}

/** Asks before removing a project and makes clear that nothing on disk is deleted. */
export function RemoveProjectDialog(props: RemoveProjectDialogProps): React.JSX.Element {
  const { project, onConfirm, onClose } = props;

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
          <DialogTitle>Projekt „{project?.name}“ entfernen?</DialogTitle>
          <DialogDescription>
            Das Projekt wird nur aus Argus entfernt. Das Repository unter {project?.repoPath} bleibt
            unverändert, auf der Platte wird nichts gelöscht.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Abbrechen
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              if (project) {
                onConfirm(project.id);
              }
              onClose();
            }}
          >
            Entfernen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
