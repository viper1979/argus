import { Sidebar } from './components/layout/sidebar';
import { TaskView } from './components/tasks/task-view';
import { useTasks } from './hooks/use-tasks';
import { useTaskView } from './stores/task-view-store';

/** Root layout: sidebar on the left, the selected task on the right. */
export function App(): React.JSX.Element {
  const tasksState = useTasks();
  const selectedTaskId = useTaskView((state) => state.selectedTaskId);
  const selectedTask = tasksState.tasks?.find((task) => task.id === selectedTaskId) ?? null;

  return (
    <div className="flex h-screen bg-background text-foreground">
      <Sidebar tasksState={tasksState} selectedTaskId={selectedTaskId} />
      {selectedTask ? (
        // Keyed per task so local state (e.g. an error) does not carry over; remounting is cheap
        // because terminals live outside React and keep running.
        <TaskView key={selectedTask.id} task={selectedTask} />
      ) : (
        <main className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          Kein Task ausgewählt
        </main>
      )}
    </div>
  );
}
