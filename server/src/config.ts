import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Project root is two levels up from server/src (or server/dist in prod).
export const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

// The desktop shell sets these before it imports this module, so the packaged app
// writes to the user's app-data dir and serves its own copy of the UI. Unset in
// web mode, where the repo layout below is correct.
export const DATA_DIR = process.env.VIATOR_DATA_DIR ?? path.join(PROJECT_ROOT, 'data');
export const DB_PATH = path.join(DATA_DIR, 'viator.db');
export const CLIENT_DIST = process.env.VIATOR_CLIENT_DIST ?? path.join(PROJECT_ROOT, 'client', 'dist');

export const HOST = '127.0.0.1';

/**
 * The port web mode always uses. It is part of that build's registered SSO callback URL, and
 * it is what Vite proxies `/api` + `/sso` to, so it cannot move.
 *
 * The desktop shell sets `VIATOR_PORT=0` and takes whatever the OS hands it: its callback is
 * a `eveauth-viator://` URL, so no port is baked into anything, and the app can no longer fail to
 * start because something else holds one particular port.
 */
export const WEB_PORT = 8642;
export const PORT = Number(process.env.VIATOR_PORT ?? WEB_PORT);

/** In dev the client runs on Vite; the SSO "you're done" page links back there. */
export const DEV_CLIENT_ORIGIN = 'http://localhost:5173';
export const isDev = process.env.NODE_ENV !== 'production';
/** Web mode only — with an ephemeral port there is no origin known at module-eval time. */
export const APP_ORIGIN = isDev ? DEV_CLIENT_ORIGIN : `http://localhost:${WEB_PORT}`;

// --- ESI / SSO constants ---
export const ESI_BASE = 'https://esi.evetech.net';
/** Pinned compatibility date. Bump deliberately after testing new behavior. */
export const COMPATIBILITY_DATE = '2026-07-25';
export const SSO_BASE = 'https://login.eveonline.com';
export const SSO_AUTHORIZE = `${SSO_BASE}/v2/oauth/authorize`;
export const SSO_TOKEN = `${SSO_BASE}/v2/oauth/token`;
export const SSO_METADATA = `${SSO_BASE}/.well-known/oauth-authorization-server`;
export const SSO_SCOPES = ['esi-assets.read_assets.v1', 'esi-universe.read_structures.v1'];

/**
 * How this build gets the authorization code back from the browser.
 *
 * `'desktop'` (set by the Electron shell via `VIATOR_SSO_MODE`) uses a registered `eveauth-viator://`
 * URL scheme: Windows hands the callback to the running app, so nothing has to be listening
 * on a port. `'web'` uses the loopback callback, which is the only option without an
 * installer to register a scheme.
 *
 * CCP allows exactly **one** callback URL per application — there is no way to serve both
 * from one registration — so each mode has its own bundled application below.
 */
export type SsoMode = 'desktop' | 'web';
export const SSO_MODE: SsoMode = process.env.VIATOR_SSO_MODE === 'desktop' ? 'desktop' : 'web';

/**
 * The URL scheme Windows uses to hand the callback to the running desktop app.
 *
 * **The `eveauth` prefix is required, not decoration.** The EVE developer portal only accepts a
 * callback URL that is either `https` or a custom scheme matching `eveauth[a-z0-9+.-]*[a-z0-9]`
 * — a plain `viator://` is rejected at registration time. Don't "tidy" this name; it also has
 * to match `electron-builder.yml` and the deep link hardcoded in `docs/auth.html`.
 */
export const SSO_PROTOCOL = 'eveauth-viator';

/**
 * The desktop application's registered callback: a **static page**, not the URL scheme itself.
 *
 * EVE could redirect straight to `eveauth-viator://…`, and that works — but a custom scheme is
 * not a document, so the browser hands it to the OS and leaves the tab stranded on EVE's
 * half-finished redirect, spinning forever. Bouncing through a real page gives the browser
 * somewhere to land ("Signed in — returning to Viator") and it then triggers the deep link.
 *
 * The cost is that a desktop login now needs this page to be reachable. It is served by GitHub
 * Pages from `docs/auth.html` in this repo, is entirely static, and must keep working for every
 * released version — it is baked into the EVE application registration, not into the app.
 * `VIATOR_SSO_CALLBACK_URL` overrides it for testing against a different host.
 */
export const DESKTOP_SSO_CALLBACK =
  process.env.VIATOR_SSO_CALLBACK_URL ?? 'https://acetech09.github.io/viator/auth.html';

export const SSO_REDIRECT =
  SSO_MODE === 'desktop' ? DESKTOP_SSO_CALLBACK : `http://localhost:${WEB_PORT}/sso/callback`;

/**
 * The EVE applications Viator ships with, so users don't have to register their own.
 *
 * Safe to bundle: these are PKCE public clients, so there is no secret — and the client id is
 * already visible in the user's URL bar during the SSO redirect. A user-entered Client ID in
 * Settings overrides whichever one this build selected.
 *
 * Each registration must use its mode's `SSO_REDIRECT` as its callback and grant (at least)
 * `SSO_SCOPES` — a request may only ask for scopes the registration already has. Changing an
 * id invalidates every refresh token stored under it (EVE binds them to the issuing client).
 */
/** Registered against `eveauth-viator://sso/callback`. */
const DESKTOP_SSO_CLIENT_ID = process.env.VIATOR_SSO_CLIENT_ID_DESKTOP ?? '446c64d5f7c24f0694c9193d170b7372';

/**
 * **Empty on purpose.** The application above used to be the web one; its callback was
 * repointed at the desktop scheme, and CCP allows only one callback URL per application, so
 * there is no longer a registration matching `http://localhost:8642/sso/callback`.
 *
 * Web mode therefore has no bundled application: Settings shows its "no application bundled"
 * state and asks for a Client ID, which is the honest outcome — shipping the desktop id here
 * would look fine right up until the callback, then fail. Set `VIATOR_SSO_CLIENT_ID` for a
 * local run, or register a second application against the loopback callback and fill this in.
 */
const WEB_SSO_CLIENT_ID = process.env.VIATOR_SSO_CLIENT_ID ?? '';

export const DEFAULT_SSO_CLIENT_ID = SSO_MODE === 'desktop' ? DESKTOP_SSO_CLIENT_ID : WEB_SSO_CLIENT_ID;

export const IMAGE_BASE = 'https://images.evetech.net';

// --- SDE ---
export const SDE_LATEST_URL = 'https://developers.eveonline.com/static-data/tranquility/latest.jsonl';
export const SDE_ZIP_URL = 'https://developers.eveonline.com/static-data/eve-online-static-data-latest-jsonl.zip';

// --- Market defaults (Jita 4-4 in The Forge) ---
export const DEFAULT_HUB_STATION_ID = 60003760;
export const DEFAULT_HUB_REGION_ID = 10000002;

/** Reported in the ESI User-Agent. The desktop shell passes its own release version. */
export const APP_VERSION = process.env.VIATOR_APP_VERSION ?? '0.1.0';

export function ensureDataDir(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
