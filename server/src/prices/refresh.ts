import { getDb } from '../db/db.js';
import { getSettings } from '../settings.js';
import { esiRequest } from '../esi/client.js';
import { refreshHubPrices } from './hub.js';

// Ensures the price_cache holds fresh prices for a list's items before it's priced.

interface MarketPrice {
  type_id: number;
  adjusted_price?: number;
  average_price?: number;
}

let esiAverageInFlight: Promise<void> | null = null;

export async function ensurePricesForList(listId: number): Promise<void> {
  const db = getDb();
  const settings = getSettings();
  const typeIds = (
    db.prepare('SELECT DISTINCT type_id FROM list_items WHERE list_id = ?').all(listId) as Array<{ type_id: number }>
  ).map((r) => r.type_id);
  if (typeIds.length === 0) return;

  if (settings.price_source === 'esi_average') {
    await ensureEsiAverage(typeIds);
  } else {
    await refreshHubPrices(settings, typeIds);
  }
}

/**
 * Best-effort price warm-up for the lists-overview cards. esi_average is one bulk call that
 * covers every list, so it's worth blocking the index on; hub sources fetch per-type orders
 * (too slow for an index page) and just read whatever the cache holds. Never throws — the
 * overview must still render offline, it just shows unpriced totals.
 */
export async function ensurePricesForOverview(): Promise<void> {
  const settings = getSettings();
  if (settings.price_source !== 'esi_average') return;
  const typeIds = (getDb().prepare('SELECT DISTINCT type_id FROM list_items').all() as Array<{ type_id: number }>).map(
    (r) => r.type_id,
  );
  if (typeIds.length === 0) return;
  try {
    await ensureEsiAverage(typeIds);
  } catch {
    // cache-only fallback
  }
}

function freshCount(source: string, typeIds: number[]): number {
  const db = getDb();
  const now = Date.now();
  const placeholders = typeIds.map(() => '?').join(',');
  const row = db
    .prepare(
      `SELECT COUNT(*) n FROM price_cache WHERE source = ? AND expires_at > ? AND type_id IN (${placeholders})`,
    )
    .get(source, now, ...typeIds) as { n: number };
  return row.n;
}

async function ensureEsiAverage(typeIds: number[]): Promise<void> {
  if (freshCount('esi_average', typeIds) === typeIds.length) return; // all fresh
  if (!esiAverageInFlight) {
    esiAverageInFlight = refreshEsiAverage().finally(() => {
      esiAverageInFlight = null;
    });
  }
  await esiAverageInFlight;
  markMissingAsUnpriceable('esi_average', typeIds);
}

/** One bulk call to /markets/prices serves every list. */
async function refreshEsiAverage(): Promise<void> {
  const { data, headers } = await esiRequest<MarketPrice[]>('/markets/prices', { cache: true });
  const now = Date.now();
  const expiresAt = parseExpires(headers) ?? now + 60 * 60 * 1000; // ~1h fallback
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO price_cache(source, type_id, price, fetched_at, expires_at)
     VALUES('esi_average', ?, ?, ?, ?)
     ON CONFLICT(source, type_id) DO UPDATE SET price = excluded.price, fetched_at = excluded.fetched_at, expires_at = excluded.expires_at`,
  );
  db.transaction(() => {
    for (const p of data) {
      const price = p.average_price ?? p.adjusted_price ?? null;
      stmt.run(p.type_id, price, now, expiresAt);
    }
  })();
}

/** Cache any still-missing types as unpriceable so we don't refetch them every render. */
function markMissingAsUnpriceable(source: string, typeIds: number[]): void {
  const db = getDb();
  const now = Date.now();
  const expiresAt = now + 60 * 60 * 1000;
  const stmt = db.prepare(
    `INSERT INTO price_cache(source, type_id, price, fetched_at, expires_at)
     VALUES(?, ?, NULL, ?, ?) ON CONFLICT(source, type_id) DO NOTHING`,
  );
  db.transaction(() => {
    for (const id of typeIds) stmt.run(source, id, now, expiresAt);
  })();
}

function parseExpires(headers: Headers): number | null {
  const exp = headers.get('expires');
  if (!exp) return null;
  const t = Date.parse(exp);
  return Number.isFinite(t) ? t : null;
}
