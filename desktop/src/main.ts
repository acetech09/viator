import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import windowStateKeeper from 'electron-window-state';
import electronUpdater from 'electron-updater';

const { autoUpdater } = electronUpdater;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Port 8642 is fixed, not incidental: it is baked into the SSO callback URL that every
 * user registers with their own EVE developer application. Moving it breaks their login.
 */
const APP_URL = 'http://localhost:8642';
const HEALTH_URL = 'http://127.0.0.1:8642/api/health';
const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

/** `--dev-url=…` points the window at the Vite dev server and skips the embedded server. */
const devUrl = process.argv.find((a) => a.startsWith('--dev-url='))?.split('=')[1];

interface RunningServer {
  close(): Promise<void>;
}

let serverHandle: RunningServer | null = null;
let win: BrowserWindow | null = null;
let shuttingDown = false;

if (!app.requestSingleInstanceLock()) {
  // Another copy owns port 8642; hand focus to it rather than racing for the port.
  app.quit();
} else {
  app.on('second-instance', focusExistingWindow);
  ipcMain.handle('viator:version', () => app.getVersion());
  void boot();
}

async function boot(): Promise<void> {
  await app.whenReady();

  if (!devUrl && !(await startEmbeddedServer())) return;

  createWindow(devUrl ?? APP_URL);
  if (app.isPackaged) initUpdater();
}

async function startEmbeddedServer(): Promise<boolean> {
  process.env.NODE_ENV = 'production';
  process.env.VIATOR_DATA_DIR = app.getPath('userData');
  process.env.VIATOR_APP_VERSION = app.getVersion();
  process.env.VIATOR_CLIENT_DIST = app.isPackaged
    ? path.join(process.resourcesPath, 'client')
    : path.resolve(app.getAppPath(), '..', 'client', 'dist');

  // Dynamic import on purpose: a static one would be hoisted above the assignments
  // above, and the server reads these variables while its modules evaluate.
  const { startServer } = await import(pathToFileURL(path.join(__dirname, 'server.mjs')).href);

  try {
    serverHandle = (await startServer()) as RunningServer;
    return true;
  } catch (err) {
    await reportStartupFailure(err);
    return false;
  }
}

async function reportStartupFailure(err: unknown): Promise<void> {
  if ((err as NodeJS.ErrnoException)?.code === 'EADDRINUSE') {
    const isViator = await probeHealth();
    dialog.showErrorBox(
      isViator ? 'Viator is already running' : 'Port 8642 is in use',
      isViator
        ? 'Another copy of Viator already has port 8642 — that may be a development server left running. Close it, then start Viator again.'
        : 'Another program is using port 8642, which Viator needs for EVE SSO. Close that program, then start Viator again.',
    );
  } else {
    dialog.showErrorBox('Viator failed to start', String((err as Error)?.stack ?? err));
  }
  app.quit();
}

async function probeHealth(): Promise<boolean> {
  try {
    const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(2000) });
    return res.ok && ((await res.json()) as { ok?: boolean }).ok === true;
  } catch {
    return false;
  }
}

function createWindow(url: string): void {
  const state = windowStateKeeper({ defaultWidth: 1440, defaultHeight: 900 });

  win = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    minWidth: 940,
    minHeight: 600,
    title: 'Viator',
    backgroundColor: '#0e1116',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  state.manage(win);
  win.once('ready-to-show', () => win?.show());
  win.on('closed', () => {
    win = null;
  });

  // The EVE SSO round-trip is ordinary top-level navigation, so it stays in the window;
  // anything else a link points at belongs in the user's real browser.
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    openExternal(target);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, target) => {
    if (!isInternalUrl(target)) {
      event.preventDefault();
      openExternal(target);
    }
  });

  void win.loadURL(url);
}

function isInternalUrl(target: string): boolean {
  try {
    const { hostname } = new URL(target);
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === 'eveonline.com' ||
      hostname.endsWith('.eveonline.com')
    );
  } catch {
    return false;
  }
}

function openExternal(target: string): void {
  try {
    const { protocol } = new URL(target);
    if (protocol === 'https:' || protocol === 'http:') void shell.openExternal(target);
  } catch {
    // Not a URL we can hand off; ignore.
  }
}

function focusExistingWindow(): void {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
}

function initUpdater(): void {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-downloaded', (info) => {
    win?.webContents.send('viator:update-ready', info.version);
  });
  // Offline launches and GitHub rate limits are not worth bothering the user about.
  autoUpdater.on('error', () => {});

  const check = () => void autoUpdater.checkForUpdates().catch(() => {});
  check();
  setInterval(check, UPDATE_CHECK_INTERVAL_MS);
}

app.on('window-all-closed', () => app.quit());

// Close Fastify and checkpoint the database before the process goes away.
app.on('will-quit', (event) => {
  if (!serverHandle || shuttingDown) return;
  shuttingDown = true;
  event.preventDefault();

  const handle = serverHandle;
  serverHandle = null;
  handle
    .close()
    .catch(() => {})
    .finally(() => app.quit());
});
