import { getDb } from '../db/db.js';
import { COMPATIBILITY_DATE, ESI_BASE, APP_VERSION } from '../config.js';
import { getSettings } from '../settings.js';

// --- A single global queue governs ALL ESI traffic ---
// Concurrency is capped and both of ESI's rate-limit regimes pause the queue when low.

const MAX_CONCURRENCY = 4;
let active = 0;
const waiters: Array<() => void> = [];
let pausedUntil = 0;

function userAgent(): string {
  const email = getSettings().contact_email;
  return `viator/${APP_VERSION}${email ? ` (${email})` : ''}`;
}

async function acquire(): Promise<void> {
  if (active >= MAX_CONCURRENCY) {
    await new Promise<void>((resolve) => waiters.push(resolve));
  }
  active++;
  const wait = pausedUntil - Date.now();
  if (wait > 0) await sleep(wait);
}

function release(): void {
  active--;
  const next = waiters.shift();
  if (next) next();
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, Math.max(0, ms)));
}

function pause(ms: number): void {
  pausedUntil = Math.max(pausedUntil, Date.now() + ms);
}

/** Inspect rate-limit headers and pause the queue if we're running low. */
function observeRateLimits(res: Response): void {
  const errRemain = Number(res.headers.get('x-esi-error-limit-remain'));
  const errReset = Number(res.headers.get('x-esi-error-limit-reset'));
  if (Number.isFinite(errRemain) && errRemain < 15 && Number.isFinite(errReset)) {
    pause(errReset * 1000 + 250);
  }
  if (res.status === 420) {
    pause((Number.isFinite(errReset) ? errReset : 60) * 1000 + 500);
  }
  if (res.status === 429) {
    const retry = Number(res.headers.get('retry-after'));
    pause((Number.isFinite(retry) ? retry : 60) * 1000 + 500);
  }
  const rlRemain = Number(res.headers.get('x-ratelimit-remaining'));
  if (Number.isFinite(rlRemain) && rlRemain <= 2) {
    pause(2000); // widen spacing when a route-group bucket is nearly empty
  }
}

export interface EsiOptions {
  query?: Record<string, string | number | undefined>;
  token?: string; // Bearer for authed routes
  cache?: boolean; // use the esi_cache table (public GETs only)
  method?: 'GET' | 'POST';
  body?: unknown;
}

export interface EsiResult<T> {
  data: T;
  headers: Headers;
}

function buildUrl(path: string, query?: EsiOptions['query']): string {
  const url = new URL(path.startsWith('http') ? path : `${ESI_BASE}${path}`);
  url.searchParams.set('compatibility_date', COMPATIBILITY_DATE);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

function readCache(url: string): { etag: string | null; expiresAt: number; body: string } | null {
  const row = getDb().prepare('SELECT etag, expires_at, body FROM esi_cache WHERE url = ?').get(url) as
    | { etag: string | null; expires_at: number; body: string }
    | undefined;
  return row ? { etag: row.etag, expiresAt: row.expires_at, body: row.body } : null;
}

function writeCache(url: string, etag: string | null, expiresAt: number, body: string): void {
  getDb()
    .prepare(
      `INSERT INTO esi_cache(url, etag, expires_at, body) VALUES(?, ?, ?, ?)
       ON CONFLICT(url) DO UPDATE SET etag = excluded.etag, expires_at = excluded.expires_at, body = excluded.body`,
    )
    .run(url, etag, expiresAt, body);
}

/** Perform a single ESI request through the queue, honoring caching + rate limits. */
export async function esiRequest<T>(path: string, opts: EsiOptions = {}): Promise<EsiResult<T>> {
  const method = opts.method ?? 'GET';
  const url = buildUrl(path, opts.query);
  const useCache = opts.cache && method === 'GET';

  if (useCache) {
    const cached = readCache(url);
    if (cached && cached.expiresAt > Date.now()) {
      return { data: JSON.parse(cached.body) as T, headers: new Headers() };
    }
  }

  await acquire();
  try {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': userAgent(),
    };
    if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    const cached = useCache ? readCache(url) : null;
    if (cached?.etag) headers['If-None-Match'] = cached.etag;

    const res = await fetch(url, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    observeRateLimits(res);

    if (res.status === 304 && cached) {
      const expiresAt = expiryFrom(res);
      writeCache(url, cached.etag, expiresAt, cached.body);
      return { data: JSON.parse(cached.body) as T, headers: res.headers };
    }

    const text = await res.text();
    if (!res.ok) {
      const err = new Error(`ESI ${method} ${path} -> ${res.status}: ${text.slice(0, 200)}`) as Error & {
        status?: number;
      };
      err.status = res.status;
      throw err;
    }

    if (useCache) writeCache(url, res.headers.get('etag'), expiryFrom(res), text);
    return { data: (text ? JSON.parse(text) : undefined) as T, headers: res.headers };
  } finally {
    release();
  }
}

function expiryFrom(res: Response): number {
  const exp = res.headers.get('expires');
  if (exp) {
    const t = Date.parse(exp);
    if (Number.isFinite(t)) return t;
  }
  return Date.now() + 5 * 60 * 1000; // fallback 5 min
}

/** GET all pages of a paginated public endpoint, concatenating the arrays. */
export async function esiGetAllPages<T>(path: string, opts: EsiOptions = {}): Promise<T[]> {
  const first = await esiRequest<T[]>(path, opts);
  const pages = Number(first.headers.get('x-pages') ?? '1');
  let all = first.data;
  if (pages > 1) {
    const rest = await Promise.all(
      Array.from({ length: pages - 1 }, (_, i) =>
        esiRequest<T[]>(path, { ...opts, query: { ...opts.query, page: i + 2 } }),
      ),
    );
    for (const r of rest) all = all.concat(r.data);
  }
  return all;
}
