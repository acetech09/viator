import type { ParsedPasteLine } from '@viator/shared';
import { getDb } from '../db/db.js';

interface TypeRow {
  type_id: number;
  name: string;
  published: number;
  market_group_id: number | null;
}

/**
 * Resolve item names to type_ids by exact, case-insensitive match. EVE has name
 * collisions (published vs unpublished dupes), so we prefer published + market types.
 * Returns a map keyed by lowercased name.
 */
export function resolveNames(names: string[]): Map<string, number> {
  const out = new Map<string, number>();
  const unique = [...new Set(names.map((n) => n.trim().toLowerCase()))].filter(Boolean);
  if (unique.length === 0) return out;

  const db = getDb();
  const CHUNK = 400;
  const best = new Map<string, TypeRow>();
  for (let i = 0; i < unique.length; i += CHUNK) {
    const batch = unique.slice(i, i + CHUNK);
    const placeholders = batch.map(() => '?').join(',');
    const rows = db
      .prepare(
        `SELECT type_id, name, published, market_group_id FROM sde_types
         WHERE name COLLATE NOCASE IN (${placeholders})`,
      )
      .all(...batch) as TypeRow[];
    for (const row of rows) {
      const key = row.name.toLowerCase();
      const prev = best.get(key);
      if (!prev || rank(row) > rank(prev)) best.set(key, row);
    }
  }
  for (const [key, row] of best) out.set(key, row.type_id);
  return out;
}

function rank(r: TypeRow): number {
  return (r.published ? 2 : 0) + (r.market_group_id !== null ? 1 : 0);
}

export type ResolvedLines =
  | {
      ok: true;
      /** type_id → summed quantity (duplicate names within the paste merge). */
      merged: Map<number, number>;
      /** lowercased name → type_id, for callers that need a specific line's type (e.g. the fit hull). */
      byName: Map<string, number>;
    }
  | { ok: false; errors: string[] };

/**
 * Resolve parsed paste lines to type_ids all-or-nothing: every line must resolve or the whole
 * batch is rejected with the unmatched raw lines. Shared by bulk import, asset pastes, and fit
 * creation so they all enforce the same commit contract.
 */
export function resolveLines(lines: ParsedPasteLine[]): ResolvedLines {
  const byName = resolveNames(lines.map((l) => l.name));
  const errors = lines.filter((l) => !byName.has(l.name.toLowerCase())).map((l) => l.raw);
  if (errors.length > 0) return { ok: false, errors };

  const merged = new Map<number, number>();
  for (const line of lines) {
    const typeId = byName.get(line.name.toLowerCase())!;
    merged.set(typeId, (merged.get(typeId) ?? 0) + line.quantity);
  }
  return { ok: true, merged, byName };
}
