import { randomBytes, randomUUID } from 'node:crypto';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ipcContract, ipcEventContract } from '@shared/ipc/contract';
import { APP_COLORS } from '@shared/theme/app-colors';
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, type OpenDialogOptions } from 'electron';
import { createAgentSessionService } from './agents/agent-session-service';
import { AGENT_TYPE_ADAPTERS } from './agents/agent-type-registry';
import { createGitClient } from './git/git-client';
import { startHookServer } from './hooks/hook-server';
import { startAgentHooks } from './hooks/start-agent-hooks';
import { createProcessGitRunner } from './git/process-git-runner';
import { createIpcEventEmitter } from './ipc/create-ipc-event-emitter';
import { createIpcHandlers } from './ipc/ipc-handlers';
import { registerIpcHandlers } from './ipc/register-ipc-handlers';
import { createConsoleLogger } from './logging/console-logger';
import type { Logger } from './logging/logger';
import { createAppStateHolder } from './persistence/app-state-holder';
import { createStateStore } from './persistence/state-store';
import { createProjectService } from './projects/project-service';
import { createSettingsService } from './settings/settings-service';
import { createTaskService } from './tasks/task-service';
import { createNodePtySpawner } from './terminals/node-pty-spawner';
import { closeTerminalsBeforeQuit } from './terminals/close-terminals-before-quit';
import { createTerminalService } from './terminals/terminal-service';

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
 * Background the window paints before and around the renderer, matching the resolved mode.
 * @returns The page background of the light or dark mode.
 */
function resolveWindowBackgroundColor(): string {
  return nativeTheme.shouldUseDarkColors ? APP_COLORS.dark.background : APP_COLORS.light.background;
}

/**
 * Creates the main window. The renderer gets no Node access and reaches the main process
 * only through the typed preload API. Expects the stored appearance to be applied already.
 */
function createMainWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: MAIN_WINDOW_WIDTH,
    height: MAIN_WINDOW_HEIGHT,
    minWidth: MAIN_WINDOW_MIN_WIDTH,
    minHeight: MAIN_WINDOW_MIN_HEIGHT,
    show: false,
    // Without it a dark start shows a white window until the renderer has painted (#22).
    backgroundColor: resolveWindowBackgroundColor(),
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

  /**
   * Repaints the window background after Windows switched modes or the setting changed, e.g. for
   * areas uncovered while resizing before the renderer has painted them.
   */
  const updateBackgroundColor = (): void => {
    mainWindow.setBackgroundColor(resolveWindowBackgroundColor());
  };
  nativeTheme.on('updated', updateBackgroundColor);
  mainWindow.on('closed', () => {
    nativeTheme.off('updated', updateBackgroundColor);
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

/** Folder in userData for the hook settings files, `%APPDATA%\Argus\hooks` (concept 5.3). */
const HOOKS_DIRECTORY_NAME = 'hooks';

/** Random bytes of the hook token; 256 bits, hex-encoded for the header. */
const HOOK_TOKEN_BYTES = 32;

/**
 * Writes a hook settings file, creating `%APPDATA%\Argus\hooks` on first use.
 * @param path Absolute file path.
 * @param content File content.
 */
async function writeHookSettingsFile(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, 'utf8');
}

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

/**
 * Creates a check whether a file or folder exists, e.g. a worktree folder created outside Argus.
 * @param logger Receives access errors other than "does not exist".
 * @returns The check.
 */
function createPathExists(logger: Logger): (path: string) => Promise<boolean> {
  return async (path) => {
    try {
      await access(path);
      return true;
    } catch (error: unknown) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return false;
      }
      // E.g. EACCES: something is there, but Argus may not use it, so treat it as taken.
      logger.warn('Could not check whether a path exists; treating it as taken', { path, error });
      return true;
    }
  };
}

/** Wires services and IPC and opens the main window once Electron is ready. */
async function startApp(): Promise<void> {
  // userData is %APPDATA%\Argus because of productName (concept, section 4).
  const stateStore = createStateStore({
    filePath: join(app.getPath('userData'), STATE_FILE_NAME),
    logger: createConsoleLogger('state'),
    now: () => new Date(),
  });
  const stateHolder = createAppStateHolder(stateStore);
  const settingsService = createSettingsService({
    stateHolder,
    // Drives native parts (folder dialog, title bar, scrollbars) and, through
    // `prefers-color-scheme`, the renderer; "system" follows Windows live.
    applyAppearance: (appearance) => {
      nativeTheme.themeSource = appearance;
    },
    logger: createConsoleLogger('settings'),
  });
  const gitClient = createGitClient(createProcessGitRunner());
  const projectService = createProjectService({ gitClient, stateHolder, generateId: randomUUID });
  const taskService = createTaskService({
    gitClient,
    stateHolder,
    generateId: randomUUID,
    pathExists: createPathExists(createConsoleLogger('fs')),
    logger: createConsoleLogger('tasks'),
  });

  const ipcEvents = createIpcEventEmitter(
    ipcEventContract,
    () => mainWindowReference?.webContents ?? null,
  );

  // Before the window: the hook settings file must carry the port of this app start before any
  // agent session can be started (concept 5.3). A failure is logged and only blocks agent
  // sessions, not the app.
  const hookLogger = createConsoleLogger('hooks');
  const agentHooks = await startAgentHooks({
    adapters: Object.values(AGENT_TYPE_ADAPTERS),
    hooksDirectory: join(app.getPath('userData'), HOOKS_DIRECTORY_NAME),
    startHookServer,
    writeFile: writeHookSettingsFile,
    generateToken: () => randomBytes(HOOK_TOKEN_BYTES).toString('hex'),
    onHookEvent: ({ agentType, agentSessionId, body }) => {
      // Only logged until #8 interprets the events. Never the body: it holds prompts and
      // tool output.
      hookLogger.info('Hook event received', {
        agentType,
        agentSessionId,
        bodyLength: body.length,
      });
    },
    logger: hookLogger,
  });

  const terminalLogger = createConsoleLogger('terminals');
  const terminalService = createTerminalService({
    spawnPty: createNodePtySpawner(),
    stateHolder,
    processEnv: process.env,
    generateId: randomUUID,
    events: {
      output: (terminalId, data) => {
        ipcEvents.terminal.output({ terminalId, data });
      },
      exit: (terminalId, exitCode) => {
        // Frees the task for a new agent session if this was its terminal. Only called once a
        // terminal ran, which needs IPC, so agentSessionService is initialised by then.
        agentSessionService.handleTerminalExit(terminalId);
        ipcEvents.terminal.exit({ terminalId, exitCode });
      },
    },
    logger: terminalLogger,
  });
  const agentSessionService = createAgentSessionService({
    stateHolder,
    terminalService,
    adapters: AGENT_TYPE_ADAPTERS,
    hooks: agentHooks,
    generateId: randomUUID,
    logger: createConsoleLogger('agent-sessions'),
  });
  closeTerminalsBeforeQuit(
    {
      onBeforeQuit: (listener) => {
        app.on('before-quit', listener);
      },
      quit: () => {
        app.quit();
      },
    },
    terminalService,
    terminalLogger,
  );

  registerIpcHandlers({
    ipcMain,
    contract: ipcContract,
    handlers: createIpcHandlers({
      projectService,
      taskService,
      terminalService,
      agentSessionService,
      settingsService,
      pickFolder,
    }),
    logger: createConsoleLogger('ipc'),
    allowedRendererUrl: resolveRendererUrl(),
  });

  // Before the window exists, so its first frame already has the right background.
  await settingsService.applyStoredAppearance();
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
