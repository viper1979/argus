import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { toTerminalFont } from '@shared/domain/terminal-font';
import { App } from './app';
import { startTerminalEventListening } from './terminals/terminal-events';
import { applyTerminalFont } from './terminals/terminal-views';
import './styles.css';

// Subscribe before anything renders, so no terminal output can arrive unheard.
startTerminalEventListening();

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
