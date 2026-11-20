import { useState } from 'react';
import { Eye, GitBranch, Pencil, Plus, Settings, Trash2 } from 'lucide-react';
import type { AddProjectResult, Project } from '@shared/domain/project';
import type { Task } from '@shared/domain/task';
import { ProjectSettingsDialog } from '@renderer/components/projects/project-settings-dialog';
import { RemoveProjectDialog } from '@renderer/components/projects/remove-project-dialog';
import { SettingsDialog } from '@renderer/components/settings/settings-dialog';
import { CreateTaskDialog } from '@renderer/components/tasks/create-task-dialog';
import { Button } from '@renderer/components/ui/button';
import { useAppInfo } from '@renderer/hooks/use-app-info';
import { useProjects } from '@renderer/hooks/use-projects';
import type { TasksState } from '@renderer/hooks/use-tasks';
import { cn } from '@renderer/lib/utils';
import { taskViewStore } from '@renderer/stores/task-view-store';

/** German message per reason why a folder could not be added. */
const ADD_PROJECT_FAILURE_MESSAGES: Record<
  Extract<AddProjectResult, { ok: false }>['reason'],
  string
> = {
  'not-a-git-repository': 'Der gewählte Ordner ist kein Git-Repository.',
  'already-registered': 'Dieses Repository ist bereits als Projekt registriert.',
  'git-unavailable':
    'Git wurde nicht gefunden. Bitte Git for Windows installieren und Argus neu starten.',
};

/** Shown when adding fails for a technical reason; details are in the log. */
const UNEXPECTED_ADD_ERROR_MESSAGE = 'Das Projekt konnte nicht hinzugefügt werden.';

/** Shown when removing fails; details are in the log. */
const UNEXPECTED_REMOVE_ERROR_MESSAGE = 'Das Projekt konnte nicht entfernt werden.';

interface ProjectTaskListProps {
  /** Tasks of one project, or `null` while the tasks are loading (as in {@link TasksState}). */
  readonly tasks: Task[] | null;
  /** Task shown in the main area; highlighted in the list. */
  readonly selectedTaskId: string | null;
}

/** The tasks below one project heading; a click opens the task view. */
function ProjectTaskList(props: ProjectTaskListProps): React.JSX.Element | null {
  const { tasks, selectedTaskId } = props;
  if (tasks === null) {
    return null;
  }
  if (tasks.length === 0) {
    return <p className="px-2 text-xs text-muted-foreground">Noch keine Tasks</p>;
  }
  return (
    <ul>
      {tasks.map((task) => (
        <li key={task.id}>
          <button
            type="button"
            aria-current={task.id === selectedTaskId ? 'true' : undefined}
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-sidebar-accent',
              task.id === selectedTaskId && 'bg-sidebar-accent text-sidebar-accent-foreground',
            )}
            title={`${task.branch}\n${task.worktreePath}`}
            onClick={() => {
              taskViewStore.getState().selectTask(task.id);
            }}
          >
            <GitBranch className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="truncate">{task.name}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

interface SidebarProps {
  /** Tasks of all projects and the action to create one; owned by the app root. */
  readonly tasksState: TasksState;
  /** Task shown in the main area. */
  readonly selectedTaskId: string | null;
}

/** Left navigation column: projects as groups with their tasks. */
export function Sidebar(props: SidebarProps): React.JSX.Element {
  const { tasksState, selectedTaskId } = props;
  const { tasks, createTask } = tasksState;
  const appInfo = useAppInfo();
  const { projects, addProject, updateProject, removeProject } = useProjects();
  const [projectForNewTask, setProjectForNewTask] = useState<Project | null>(null);
  const [editedProject, setEditedProject] = useState<Project | null>(null);
  const [projectToRemove, setProjectToRemove] = useState<Project | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  /** Picks a folder, registers it and opens the settings to check the detected values. */
  async function handleAddProject(): Promise<void> {
    setActionError(null);
    const { folderPath } = await window.argus.dialog.pickFolder({ title: 'Repository wählen' });
    if (folderPath === null) {
      return;
    }
    const result = await addProject(folderPath);
    if (result.ok) {
      setEditedProject(result.project);
    } else {
      setActionError(ADD_PROJECT_FAILURE_MESSAGES[result.reason]);
    }
  }

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-sidebar text-sidebar-foreground">
      <header className="flex items-center gap-2 px-4 py-3 font-semibold">
        <Eye className="size-4" aria-hidden />
        <span className="flex-1">Argus</span>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          title="Projekt hinzufügen"
          onClick={() => {
            handleAddProject().catch((error: unknown) => {
              console.error('Could not add project', error);
              setActionError(UNEXPECTED_ADD_ERROR_MESSAGE);
            });
          }}
        >
          <Plus className="size-4" />
        </Button>
      </header>
      {actionError && (
        <p
          role="alert"
          className="mx-4 mb-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          {actionError}
        </p>
      )}
      <nav className="flex-1 overflow-y-auto px-2 py-2 text-sm">
        {projects?.length === 0 && (
          <p className="px-2 text-muted-foreground">Noch keine Projekte</p>
        )}
        {projects?.map((project) => (
          <section key={project.id} className="group mb-2">
            <div className="flex items-center gap-1 px-2 py-1">
              <h2
                className="flex-1 truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                title={project.repoPath}
              >
                {project.name}
              </h2>
              <Button
                variant="ghost"
                size="icon"
                className="size-6"
                title="Task anlegen"
                onClick={() => {
                  setProjectForNewTask(project);
                }}
              >
                <Plus className="size-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-6 opacity-0 group-hover:opacity-100"
                title="Projekt-Einstellungen"
                onClick={() => {
                  setEditedProject(project);
                }}
              >
                <Pencil className="size-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-6 opacity-0 group-hover:opacity-100"
                title="Projekt entfernen"
                onClick={() => {
                  setProjectToRemove(project);
                }}
              >
                <Trash2 className="size-3" />
              </Button>
            </div>
            <ProjectTaskList
              tasks={tasks && tasks.filter((task) => task.projectId === project.id)}
              selectedTaskId={selectedTaskId}
            />
          </section>
        ))}
      </nav>
      <footer className="flex items-center px-4 py-2 text-xs text-muted-foreground">
        <span className="flex-1">{appInfo ? `Version ${appInfo.version}` : ' '}</span>
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          title="Einstellungen"
          onClick={() => {
            setIsSettingsOpen(true);
          }}
        >
          <Settings className="size-3.5" />
        </Button>
      </footer>
      <ProjectSettingsDialog
        project={editedProject}
        onSave={updateProject}
        onClose={() => {
          setEditedProject(null);
        }}
      />
      <RemoveProjectDialog
        project={projectToRemove}
        onConfirm={(projectId) => {
          removeProject(projectId).catch((error: unknown) => {
            console.error('Could not remove project', error);
            setActionError(UNEXPECTED_REMOVE_ERROR_MESSAGE);
          });
        }}
        onClose={() => {
          setProjectToRemove(null);
        }}
      />
      <CreateTaskDialog
        project={projectForNewTask}
        onCreate={createTask}
        onClose={() => {
          setProjectForNewTask(null);
        }}
        onOpenSettings={() => {
          setIsSettingsOpen(true);
        }}
      />
      <SettingsDialog
        isOpen={isSettingsOpen}
        onClose={() => {
          setIsSettingsOpen(false);
        }}
      />
    </aside>
  );
}
