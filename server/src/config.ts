import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Project root is two levels up from server/src (or server/dist in prod).
export const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
export const DATA_DIR = path.join(PROJECT_ROOT, 'data');
export const DB_PATH = path.join(DATA_DIR, 'viator.db');
export const CLIENT_DIST = path.join(PROJECT_ROOT, 'client', 'dist');

export const PORT = 8642;
export const HOST = '127.0.0.1';

/** In dev the client runs on Vite; after SSO we bounce the browser back there. */
export const DEV_CLIENT_ORIGIN = 'http://localhost:5173';
export const isDev = process.env.NODE_ENV !== 'production';
export const APP_ORIGIN = isDev ? DEV_CLIENT_ORIGIN : `http://localhost:${PORT}`;

// --- ESI / SSO constants ---
export const ESI_BASE = 'https://esi.evetech.net';
/** Pinned compatibility date. Bump deliberately after testing new behavior. */
export const COMPATIBILITY_DATE = '2026-07-25';
export const SSO_BASE = 'https://login.eveonline.com';
export const SSO_AUTHORIZE = `${SSO_BASE}/v2/oauth/authorize`;
export const SSO_TOKEN = `${SSO_BASE}/v2/oauth/token`;
export const SSO_METADATA = `${SSO_BASE}/.well-known/oauth-authorization-server`;
export const SSO_REDIRECT = `http://localhost:${PORT}/sso/callback`;
export const SSO_SCOPES = ['esi-assets.read_assets.v1', 'esi-universe.read_structures.v1'];

export const IMAGE_BASE = 'https://images.evetech.net';

// --- SDE ---
export const SDE_LATEST_URL = 'https://developers.eveonline.com/static-data/tranquility/latest.jsonl';
export const SDE_ZIP_URL = 'https://developers.eveonline.com/static-data/eve-online-static-data-latest-jsonl.zip';

// --- Market defaults (Jita 4-4 in The Forge) ---
export const DEFAULT_HUB_STATION_ID = 60003760;
export const DEFAULT_HUB_REGION_ID = 10000002;

export const APP_VERSION = '0.1.0';

export function ensureDataDir(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
