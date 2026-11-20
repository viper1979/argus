import type { StartAgentSessionResult } from '@shared/domain/agent-session';
import type { Task } from '@shared/domain/task';
import { AGENT_TYPE_LABELS } from '@renderer/lib/agent-type-labels';
import { taskViewStore } from '@renderer/stores/task-view-store';
import { INITIAL_TERMINAL_SIZE } from '@renderer/terminals/initial-terminal-size';
import { createTerminalView } from '@renderer/terminals/terminal-views';

/**
 * Starts the agent session of a freshly created task and shows it as its first terminal tab
 * (concept 5.3). A failure is kept in the task view store, which the task view shows.
 * @param task The task; its agent type names the tab.
 */
export async function startAgentSession(task: Task): Promise<void> {
  const store = taskViewStore.getState();
  let result: StartAgentSessionResult;
  try {
    result = await window.argus.agentSession.start({ taskId: task.id, ...INITIAL_TERMINAL_SIZE });
  } catch (error: unknown) {
    // Whatever failed, the task exists anyway; only its agent session is missing. Details for
    // the log, the task view shows a generic message.
    console.error('Could not start agent session', error);
    store.reportAgentSessionFailure(task.id, 'unexpected');
    return;
  }
  if (!result.ok) {
    store.reportAgentSessionFailure(task.id, result.reason);
    return;
  }
  // A shell that already exited before this reply arrived gets no (dead) tab.
  if (createTerminalView(result.terminalId)) {
    store.addAgentSessionTerminal(task.id, result.terminalId, AGENT_TYPE_LABELS[task.agentType]);
  }
}
