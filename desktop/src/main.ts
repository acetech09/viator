import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import windowStateKeeper from 'electron-window-state';
import electronUpdater from 'electron-updater';

const { autoUpdater } = electronUpdater;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * The URL scheme NSIS registers for this app (see `protocols:` in electron-builder.yml) and
 * the EVE application's callback URL. Keep in sync with `SSO_PROTOCOL` in server/src/config.ts.
 *
 * Using a scheme instead of a loopback callback is what frees the embedded server from any
 * particular port: it asks for an ephemeral one and the OS decides. Nothing outside this
 * process needs to know which port that turned out to be.
 */
const PROTOCOL = 'eveauth-viator';
const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

/** `--dev-url=…` points the window at the Vite dev server and skips the embedded server. */
const devUrl = process.argv.find((a) => a.startsWith('--dev-url='))?.split('=')[1];

interface RunningServer {
  port: number;
  close(): Promise<void>;
}

let serverHandle: RunningServer | null = null;
let serverPort: number | null = null;
let win: BrowserWindow | null = null;
let shuttingDown = false;

if (!app.requestSingleInstanceLock()) {
  // Another copy is already running. If Windows started us only to deliver an eveauth-viator:// URL,
  // that copy gets it through its own 'second-instance' handler, so we can just leave.
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    focusExistingWindow();
    const url = ssoUrlIn(argv);
    if (url) void deliverSsoCallback(url);
  });
  ipcMain.handle('viator:version', () => app.getVersion());
  ipcMain.handle('viator:open-external', (_event, target: string) => openExternal(target));
  void boot();
}

async function boot(): Promise<void> {
  await app.whenReady();
  registerProtocolClient();

  if (!devUrl && !(await startEmbeddedServer())) return;

  createWindow(devUrl ?? `http://localhost:${serverPort}`);
  if (app.isPackaged) initUpdater();

  // Cold start via the protocol (the app wasn't running when the browser called back). The
  // attempt it belongs to lives in the previous process's memory, so this will report an
  // expired attempt — pass it along anyway rather than dropping it silently.
  const url = ssoUrlIn(process.argv);
  if (url) void deliverSsoCallback(url);
}

/**
 * Claim `eveauth-viator://` for this executable. The packaged installer already writes these keys;
 * doing it here as well is what makes the flow testable from an unpacked `electron .` run,
 * which has to name the script explicitly or Windows would launch a bare Electron.
 */
function registerProtocolClient(): void {
  if (process.defaultApp) {
    const script = process.argv[1];
    if (script) app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(script)]);
  } else {
    app.setAsDefaultProtocolClient(PROTOCOL);
  }
}

function ssoUrlIn(argv: string[]): string | undefined {
  return argv.find((a) => a.startsWith(`${PROTOCOL}://`));
}

/**
 * Hand `eveauth-viator://sso/callback?code=…&state=…` to the embedded server, which owns the PKCE
 * verifier for that state. The Settings page is polling `/api/sso/status`, so it picks the
 * result up on its own — all we add is bringing the window back to the front.
 */
async function deliverSsoCallback(rawUrl: string): Promise<void> {
  if (serverPort === null) return;
  let code: string | null = null;
  let state: string | null = null;
  try {
    const parsed = new URL(rawUrl);
    code = parsed.searchParams.get('code');
    state = parsed.searchParams.get('state');
  } catch {
    return;
  }
  if (!code || !state) return;

  try {
    await fetch(`http://127.0.0.1:${serverPort}/api/sso/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, state }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    // The page's poll reports the failure; there is nothing useful to show from here.
  }
  focusExistingWindow();
}

async function startEmbeddedServer(): Promise<boolean> {
  process.env.NODE_ENV = 'production';
  process.env.VIATOR_DATA_DIR = app.getPath('userData');
  process.env.VIATOR_APP_VERSION = app.getVersion();
  // 0 = let the OS pick. Nothing here is reachable from outside the app, and the SSO
  // callback is an eveauth-viator:// URL, so no fixed port is needed.
  process.env.VIATOR_PORT = '0';
  process.env.VIATOR_SSO_MODE = 'desktop';
  process.env.VIATOR_CLIENT_DIST = app.isPackaged
    ? path.join(process.resourcesPath, 'client')
    : path.resolve(app.getAppPath(), '..', 'client', 'dist');

  // Dynamic import on purpose: a static one would be hoisted above the assignments
  // above, and the server reads these variables while its modules evaluate.
  const { startServer } = await import(pathToFileURL(path.join(__dirname, 'server.mjs')).href);

  try {
    serverHandle = (await startServer()) as RunningServer;
    serverPort = serverHandle.port;
    return true;
  } catch (err) {
    dialog.showErrorBox('Viator failed to start', String((err as Error)?.stack ?? err));
    app.quit();
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

  // Nothing but the app itself should ever load in this window — EVE SSO now happens in the
  // user's real browser and comes back through the eveauth-viator:// handler.
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
    return hostname === 'localhost' || hostname === '127.0.0.1';
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
  if (!win.isVisible()) win.show();
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
