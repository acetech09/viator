import type { PriceSource } from '@viator/shared';
import { getDb } from '../db/db.js';

// Returns a map type_id -> price (or null if unpriceable) for the given source.
// M2: reads whatever is cached (nothing yet -> all null). M3 fills the cache from ESI.
export function getCachedPrices(source: PriceSource, typeIds: number[]): Map<number, number | null> {
  const out = new Map<number, number | null>();
  if (typeIds.length === 0) return out;
  const db = getDb();
  const now = Date.now();
  const placeholders = typeIds.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT type_id, price, expires_at FROM price_cache
       WHERE source = ? AND type_id IN (${placeholders})`,
    )
    .all(source, ...typeIds) as Array<{ type_id: number; price: number | null; expires_at: number }>;
  for (const r of rows) {
    if (r.expires_at >= now) out.set(r.type_id, r.price);
  }
  return out;
}
