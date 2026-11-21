import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { toTerminalFont } from '@shared/domain/terminal-font';
import { startAgentSessionStatusListening } from './agent-sessions/agent-session-status-events';
import { App } from './app';
import { taskViewStore } from './stores/task-view-store';
import { startTerminalEventListening } from './terminals/terminal-events';
import { terminalColorSchemeFor } from './terminals/terminal-color-schemes';
import { applyTerminalColorScheme, applyTerminalFont } from './terminals/terminal-views';
import { followColorScheme } from './theme/follow-color-scheme';
import './styles.css';

// Subscribe before anything renders, so no terminal output can arrive unheard.
startTerminalEventListening();

// Statuses of agent sessions: live changes plus those a reload missed.
startAgentSessionStatusListening(window.argus.agentSession, taskViewStore).catch(
  (error: unknown) => {
    // Live changes still arrive; only statuses from before this load are missing.
    console.error('Could not load agent session statuses', error);
  },
);

/** Media query that reflects the mode the main process resolved (#22). */
const DARK_COLOR_SCHEME_QUERY = '(prefers-color-scheme: dark)';

// Before the first render, so the first frame already uses the right shadcn tokens. Follows for
// the lifetime of the window, which is the lifetime of the renderer.
followColorScheme(window.matchMedia(DARK_COLOR_SCHEME_QUERY), (isDark) => {
  document.documentElement.classList.toggle('dark', isDark);
  applyTerminalColorScheme(terminalColorSchemeFor(isDark));
});

// The stored terminal font; terminals opened before it arrives are updated, too.
window.argus.settings
  .get({})
  .then((settings) => {
    applyTerminalFont(toTerminalFont(settings));
  })
  .catch((error: unknown) => {
    // Terminals keep the default font; the settings dialog shows its own load error.
    console.error('Could not load the terminal font', error);
  });

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root is missing in index.html');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
