import { useEffect, useRef } from 'react';
import { attachTerminalView } from '@renderer/terminals/terminal-views';

interface TerminalPaneProps {
  /** The terminal to show; its xterm.js instance outlives this component. */
  readonly terminalId: string;
}

/** Shows the xterm.js instance of one terminal; unmounting only hides it, it keeps running. */
export function TerminalPane(props: TerminalPaneProps): React.JSX.Element {
  const { terminalId } = props;
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return undefined;
    }
    return attachTerminalView(terminalId, container);
  }, [terminalId]);

  return <div ref={containerRef} className="h-full w-full" />;
}
