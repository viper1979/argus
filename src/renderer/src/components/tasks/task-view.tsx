import { useState } from 'react';
import { Bot, FolderOpen, GitBranch, Plus, SquareTerminal, X } from 'lucide-react';
import type { Task } from '@shared/domain/task';
import { AgentSessionStatusDot } from '@renderer/components/agent-sessions/agent-session-status-dot';
import { TerminalPane } from '@renderer/components/tasks/terminal-pane';
import { Button } from '@renderer/components/ui/button';
import { useTerminals, type OpenTerminalFailureReason } from '@renderer/hooks/use-terminals';
import { cn } from '@renderer/lib/utils';
import {
  useTaskView,
  type AgentSessionStartFailure,
  type TerminalTabKind,
} from '@renderer/stores/task-view-store';

/** German message per reason why a terminal could not be opened. */
const OPEN_TERMINAL_FAILURE_MESSAGES: Record<OpenTerminalFailureReason, string> = {
  'task-not-found': 'Der Task wurde nicht gefunden.',
  'shell-unavailable':
    'Es wurde keine PowerShell gefunden. Argus braucht pwsh oder Windows PowerShell.',
  'app-closing': 'Argus wird gerade beendet.',
};

/** How the tab bar shows each kind of terminal tab. */
const TAB_PRESENTATION: Record<
  TerminalTabKind,
  { readonly icon: typeof SquareTerminal; readonly isClosable: boolean }
> = {
  terminal: { icon: SquareTerminal, isClosable: true },
  // Ends via /exit or `exit` in its PowerShell, not via the tab (concept 5.3, step 5).
  'agent-session': { icon: Bot, isClosable: false },
};

/** German message per reason why the agent session of a new task could not be started. */
const AGENT_SESSION_FAILURE_MESSAGES: Record<AgentSessionStartFailure, string> = {
  'task-not-found': 'Die Agent-Session wurde nicht gestartet: Der Task wurde nicht gefunden.',
  'already-running': 'In diesem Task läuft bereits eine Agent-Session.',
  'hooks-unavailable':
    'Die Agent-Session wurde nicht gestartet: Der Hook-Server ist nicht verfügbar, Argus könnte ihren Status nicht anzeigen. Details stehen im Log.',
  'shell-unavailable':
    'Die Agent-Session wurde nicht gestartet: Es wurde keine PowerShell gefunden. Argus braucht pwsh oder Windows PowerShell.',
  'app-closing': 'Die Agent-Session wurde nicht gestartet: Argus wird gerade beendet.',
  unexpected: 'Die Agent-Session konnte nicht gestartet werden. Details stehen im Log.',
};

/** Shown when opening fails for a technical reason; details are in the log. */
const UNEXPECTED_OPEN_ERROR_MESSAGE = 'Das Terminal konnte nicht geöffnet werden.';

/** Shown when closing fails for a technical reason; details are in the log. */
const UNEXPECTED_CLOSE_ERROR_MESSAGE = 'Das Terminal konnte nicht geschlossen werden.';

interface TaskViewProps {
  /** The task to show. */
  readonly task: Task;
}

/** Main area of a task: header with name, branch and path, terminal tabs, active terminal. */
export function TaskView(props: TaskViewProps): React.JSX.Element {
  const { task } = props;
  const { tabs, activeTerminalId, openTerminal, closeTerminal, activateTerminal } = useTerminals(
    task.id,
  );
  const agentSessionFailure = useTaskView((state) => state.agentSessionFailureByTask[task.id]);
  const agentSessionStatus = useTaskView(
    (state) => state.agentSessionStatusByTask[task.id]?.status,
  );
  const [actionError, setActionError] = useState<string | null>(null);
  const [isOpening, setIsOpening] = useState(false);

  /** Opens a new terminal and shows why, if it could not be opened. */
  async function handleOpenTerminal(): Promise<void> {
    setActionError(null);
    setIsOpening(true);
    try {
      const failureReason = await openTerminal();
      if (failureReason !== null) {
        setActionError(OPEN_TERMINAL_FAILURE_MESSAGES[failureReason]);
      }
    } finally {
      setIsOpening(false);
    }
  }

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <header className="border-b border-border px-4 py-3">
        <h1 className="truncate font-semibold">{task.name}</h1>
        <p className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
          <GitBranch className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate" title={task.branch}>
            {task.branch}
          </span>
        </p>
        <p className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
          <FolderOpen className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate" title={task.worktreePath}>
            {task.worktreePath}
          </span>
        </p>
      </header>
      <div
        role="tablist"
        aria-label="Terminals"
        className="flex items-center gap-1 border-b border-border px-2 py-1"
      >
        {tabs.map((tab) => {
          const isActive = tab.terminalId === activeTerminalId;
          const { icon: TabIcon, isClosable } = TAB_PRESENTATION[tab.kind];
          return (
            <div
              key={tab.terminalId}
              className={cn(
                'flex items-center rounded-md text-sm',
                isActive ? 'bg-accent text-accent-foreground' : 'text-muted-foreground',
              )}
            >
              <button
                type="button"
                role="tab"
                aria-selected={isActive}
                className={cn('flex items-center gap-1.5 py-1 pl-2', isClosable ? 'pr-1' : 'pr-2')}
                onClick={() => {
                  activateTerminal(tab.terminalId);
                }}
              >
                {/* The agent session tab shows its status as in the sidebar (concept 6). */}
                {tab.kind === 'agent-session' && agentSessionStatus ? (
                  <AgentSessionStatusDot status={agentSessionStatus} className="mx-0.5" />
                ) : (
                  <TabIcon className="size-3.5" aria-hidden />
                )}
                {tab.title}
              </button>
              {isClosable && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-5"
                  title={`${tab.title} schließen`}
                  onClick={() => {
                    closeTerminal(tab.terminalId).catch((error: unknown) => {
                      console.error('Could not close terminal', error);
                      setActionError(UNEXPECTED_CLOSE_ERROR_MESSAGE);
                    });
                  }}
                >
                  <X className="size-3" />
                </Button>
              )}
            </div>
          );
        })}
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          title="Neues Terminal"
          disabled={isOpening}
          onClick={() => {
            handleOpenTerminal().catch((error: unknown) => {
              console.error('Could not open terminal', error);
              setActionError(UNEXPECTED_OPEN_ERROR_MESSAGE);
            });
          }}
        >
          <Plus className="size-4" />
        </Button>
      </div>
      {agentSessionFailure && (
        <p
          role="alert"
          className="mx-4 mt-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          {AGENT_SESSION_FAILURE_MESSAGES[agentSessionFailure]}
        </p>
      )}
      {actionError && (
        <p
          role="alert"
          className="mx-4 mt-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          {actionError}
        </p>
      )}
      <div className="min-h-0 flex-1 bg-background p-1">
        {activeTerminalId ? (
          // The key remounts the pane per terminal, so the previous one is detached cleanly.
          <TerminalPane key={activeTerminalId} terminalId={activeTerminalId} />
        ) : (
          <p className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Noch kein Terminal. Mit „+“ ein neues öffnen.
          </p>
        )}
      </div>
    </section>
  );
}
