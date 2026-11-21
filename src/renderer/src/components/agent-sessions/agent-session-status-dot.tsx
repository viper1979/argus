import type { AgentSessionStatus } from '@shared/domain/agent-session';
import {
  AGENT_SESSION_STATUS_DOT_CLASSES,
  AGENT_SESSION_STATUS_LABELS,
} from '@renderer/agent-sessions/agent-session-status-display';
import { cn } from '@renderer/lib/utils';

interface AgentSessionStatusDotProps {
  /** Status of the agent session; decides colour and animation (concept 3). */
  readonly status: AgentSessionStatus;
  /** Extra classes, e.g. for spacing. */
  readonly className?: string;
}

/** Coloured dot that shows the status of an agent session; its name is the accessible label. */
export function AgentSessionStatusDot(props: AgentSessionStatusDotProps): React.JSX.Element {
  const { status, className } = props;
  const label = AGENT_SESSION_STATUS_LABELS[status];
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn(
        'inline-block size-2 shrink-0 rounded-full',
        AGENT_SESSION_STATUS_DOT_CLASSES[status],
        className,
      )}
    />
  );
}
