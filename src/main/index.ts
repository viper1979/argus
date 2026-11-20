import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ipcContract } from '@shared/ipc/contract';
import { app, BrowserWindow, dialog, ipcMain, type OpenDialogOptions } from 'electron';
import { createGitClient } from './git/git-client';
import { createProcessGitRunner } from './git/process-git-runner';
import { createIpcHandlers } from './ipc/ipc-handlers';
import { registerIpcHandlers } from './ipc/register-ipc-handlers';
import { createConsoleLogger } from './logging/console-logger';
import { createAppStateHolder } from './persistence/app-state-holder';
import { createStateStore } from './persistence/state-store';
import { createProjectService } from './projects/project-service';

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
function createMainWindow(): BrowserWindow {
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
  return mainWindow;
}

/** The only window of Argus; dialogs attach to it so they are modal. */
let mainWindowReference: BrowserWindow | null = null;

/** File in the userData folder that holds projects and settings. */
const STATE_FILE_NAME = 'state.json';

/** Exit code when the app cannot start, e.g. because an IPC handler is missing. */
const STARTUP_FAILURE_EXIT_CODE = 1;

/**
 * Shows the native folder picker attached to the main window.
 * @param title Title of the dialog.
 * @returns The picked folder, or `null` if the user cancelled.
 */
async function pickFolder(title: string): Promise<string | null> {
  const options: OpenDialogOptions = { title, properties: ['openDirectory'] };
  // Attach to the main window even if it is not focused, so the dialog is always modal.
  const result = mainWindowReference
    ? await dialog.showOpenDialog(mainWindowReference, options)
    : await dialog.showOpenDialog(options);
  return result.canceled ? null : (result.filePaths[0] ?? null);
}

/** Wires services and IPC and opens the main window once Electron is ready. */
function startApp(): void {
  // userData is %APPDATA%\Argus because of productName (concept, section 4).
  const stateStore = createStateStore({
    filePath: join(app.getPath('userData'), STATE_FILE_NAME),
    logger: createConsoleLogger('state'),
    now: () => new Date(),
  });
  const stateHolder = createAppStateHolder(stateStore);
  const projectService = createProjectService({
    gitClient: createGitClient(createProcessGitRunner()),
    stateHolder,
    generateId: randomUUID,
  });

  registerIpcHandlers({
    ipcMain,
    contract: ipcContract,
    handlers: createIpcHandlers({ projectService, stateHolder, pickFolder }),
    logger: createConsoleLogger('ipc'),
    allowedRendererUrl: resolveRendererUrl(),
  });

  mainWindowReference = createMainWindow();
  mainWindowReference.on('closed', () => {
    mainWindowReference = null;
  });
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
