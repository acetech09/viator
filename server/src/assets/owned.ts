import type { StockZone } from '@viator/shared';
import { getDb } from '../db/db.js';

/**
 * Total owned quantity per type_id for a list **within one stock zone** ('purchase' or
 * 'destination'), summing two sources scoped to that zone:
 *   1. API-fetched assets across the zone's **enabled** filter rows
 *      (character + location pairs); only assets flagged `included = 1` count, and only
 *      buckets that are enabled for that row. A row's bucket selection lives in
 *      `list_filter_buckets` (also scoped by zone); buckets with no saved row fall back to the
 *      default (containers + basic hangar on, ships off) — so an untouched row deducts exactly
 *      the loose hangar items + container contents it always did.
 *   2. **Enabled** manual asset pastes attached to the list in that zone.
 * Disabled rows/pastes are ignored. Returns an empty map when nothing applies.
 *
 * Callers deduct the two zones differently: the Purchase view nets out both zones, the
 * Transport view nets out 'destination' only (see `buildPricedList`).
 */
export function getOwnedForList(listId: number, zone: StockZone): Map<number, number> {
  const db = getDb();
  const out = new Map<number, number>();

  const filters = db
    .prepare('SELECT character_id, location_id FROM list_filters WHERE list_id = ? AND zone = ? AND enabled = 1')
    .all(listId, zone) as Array<{ character_id: number; location_id: number }>;
  if (filters.length > 0) {
    const stmt = db.prepare(
      `SELECT a.type_id AS type_id, SUM(a.quantity) AS qty
       FROM assets a
       LEFT JOIN list_filter_buckets b
         ON b.list_id = @list AND b.character_id = a.character_id
            AND b.location_id = a.root_location_id
            AND b.zone = @zone
            AND b.bucket_kind = a.bucket_kind
            AND b.bucket_id IS a.bucket_id
       WHERE a.included = 1 AND a.character_id = @char AND a.root_location_id = @loc
         AND COALESCE(b.enabled, CASE a.bucket_kind WHEN 'ship' THEN 0 ELSE 1 END) = 1
       GROUP BY a.type_id`,
    );
    for (const f of filters) {
      const rows = stmt.all({ list: listId, char: f.character_id, loc: f.location_id, zone }) as Array<{
        type_id: number;
        qty: number;
      }>;
      for (const r of rows) out.set(r.type_id, (out.get(r.type_id) ?? 0) + r.qty);
    }
  }

  const pasteRows = db
    .prepare(
      `SELECT i.type_id AS type_id, SUM(i.quantity) AS qty
       FROM asset_paste_items i JOIN asset_pastes p ON p.id = i.paste_id
       WHERE p.list_id = ? AND p.zone = ? AND p.enabled = 1
       GROUP BY i.type_id`,
    )
    .all(listId, zone) as Array<{ type_id: number; qty: number }>;
  for (const r of pasteRows) out.set(r.type_id, (out.get(r.type_id) ?? 0) + r.qty);

  return out;
}
