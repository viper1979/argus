import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ipcContract } from '@shared/ipc/contract';
import { app, BrowserWindow, ipcMain } from 'electron';
import { createIpcHandlers } from './ipc/ipc-handlers';
import { registerIpcHandlers } from './ipc/register-ipc-handlers';
import { createConsoleLogger } from './logging/console-logger';

const MAIN_WINDOW_WIDTH = 1280;
const MAIN_WINDOW_HEIGHT = 800;
const MAIN_WINDOW_MIN_WIDTH = 900;
const MAIN_WINDOW_MIN_HEIGHT = 600;

/** Build output locations relative to the bundled main script (`out/main/index.js`). */
const PRELOAD_SCRIPT_PATH = join(__dirname, '../preload/index.js');
const RENDERER_HTML_PATH = join(__dirname, '../renderer/index.html');

/** Set by electron-vite in dev mode; points to the Vite dev server of the renderer. */
const RENDERER_DEV_SERVER_URL = process.env['ELECTRON_RENDERER_URL'];

/**
 * Determines where the renderer is loaded from. Used both for loading the window and for
 * validating IPC senders, so the two can never disagree.
 * @returns The Vite dev server URL in an unpackaged dev run, otherwise the built `index.html`.
 */
function resolveRendererUrl(): URL {
  if (!app.isPackaged && RENDERER_DEV_SERVER_URL) {
    return new URL(RENDERER_DEV_SERVER_URL);
  }
  // pathToFileURL turns the Windows path (D:\...) into a proper file:///D:/... URL.
  return pathToFileURL(RENDERER_HTML_PATH);
}

/**
 * Creates the main window. The renderer gets no Node access and reaches the main process
 * only through the typed preload API.
 */
function createMainWindow(): void {
  const mainWindow = new BrowserWindow({
    width: MAIN_WINDOW_WIDTH,
    height: MAIN_WINDOW_HEIGHT,
    minWidth: MAIN_WINDOW_MIN_WIDTH,
    minHeight: MAIN_WINDOW_MIN_HEIGHT,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: PRELOAD_SCRIPT_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // The renderer must never open windows or navigate away from the app.
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => {
    event.preventDefault();
  });

  void mainWindow.loadURL(resolveRendererUrl().href);
}

/** Exit code when the app cannot start, e.g. because an IPC handler is missing. */
const STARTUP_FAILURE_EXIT_CODE = 1;

/** Wires IPC and opens the main window once Electron is ready. */
function startApp(): void {
  registerIpcHandlers({
    ipcMain,
    contract: ipcContract,
    handlers: createIpcHandlers(),
    logger: createConsoleLogger('ipc'),
    allowedRendererUrl: resolveRendererUrl(),
  });

  createMainWindow();
}

app
  .whenReady()
  .then(startApp)
  .catch((error: unknown) => {
    // Without a window, `window-all-closed` never fires: exit explicitly instead of
    // leaving an invisible process behind.
    createConsoleLogger('main').error('Argus failed to start', { error });
    app.exit(STARTUP_FAILURE_EXIT_CODE);
  });

// Windows only (ADR 0002): closing the last window ends the app.
app.on('window-all-closed', () => {
  app.quit();
});
