import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app';
import { startTerminalEventListening } from './terminals/terminal-events';
import './styles.css';

// Subscribe before anything renders, so no terminal output can arrive unheard.
startTerminalEventListening();

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root is missing in index.html');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
