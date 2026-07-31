import type { FastifyInstance } from 'fastify';
import {
  parsePaste,
  type AssetPaste,
  type FilterBuckets,
  type FilterBucketEntry,
  type FilterBucketsUpdate,
  type FilterRow,
} from '@viator/shared';
import { getDb } from '../../db/db.js';
import { resolveLines } from '../../lists/resolveNames.js';
import { asZone, intParam, listExists } from './helpers.js';

/**
 * Existing-stock sources for a list, all scoped to a zone (`?zone=purchase|destination`,
 * default purchase): persisted API asset filter rows, per-row bucket selections
 * (containers / fitted ships / basic hangar), and manual asset pastes.
 */
export async function stockRoutes(app: FastifyInstance): Promise<void> {
  const db = getDb();

  // Persisted inventory filter rows (character + location + enabled) for a list.
  app.get('/api/lists/:id/filters', async (req) => {
    const id = intParam(req, 'id');
    const zone = asZone((req.query as { zone?: string }).zone);
    const rows = db
      .prepare(
        // has_bucket_filter is true only when the saved bucket selection *deviates* from the
        // default (basic hangar / containers on, ships off) — i.e. a ship turned on or a
        // hangar/container turned off. A save that leaves everything at default reads as no filter.
        `SELECT f.character_id, f.location_id, f.enabled,
           EXISTS(
             SELECT 1 FROM list_filter_buckets b
             WHERE b.list_id = f.list_id AND b.character_id = f.character_id AND b.location_id = f.location_id
               AND b.zone = f.zone
               AND ((b.bucket_kind = 'ship' AND b.enabled = 1)
                    OR (b.bucket_kind IN ('hangar', 'container') AND b.enabled = 0))
           ) AS has_bucket_filter
         FROM list_filters f WHERE f.list_id = ? AND f.zone = ? ORDER BY f.rowid`,
      )
      .all(id, zone) as Array<{ character_id: number; location_id: number; enabled: number; has_bucket_filter: number }>;
    return rows.map((r) => ({
      character_id: r.character_id,
      location_id: r.location_id,
      enabled: !!r.enabled,
      has_bucket_filter: !!r.has_bucket_filter,
    })) as FilterRow[];
  });

  app.put('/api/lists/:id/filters', async (req, reply) => {
    const id = intParam(req, 'id');
    if (!listExists(id)) return reply.code(404).send({ error: 'not_found' });
    const zone = asZone((req.query as { zone?: string }).zone);
    const { filters } = (req.body ?? {}) as { filters?: FilterRow[] };
    const rows = Array.isArray(filters) ? filters : [];
    db.transaction(() => {
      // Replace only this zone's rows — the other zone is edited by its own section.
      db.prepare('DELETE FROM list_filters WHERE list_id = ? AND zone = ?').run(id, zone);
      const stmt = db.prepare(
        'INSERT OR IGNORE INTO list_filters(list_id, character_id, location_id, zone, enabled) VALUES(?, ?, ?, ?, ?)',
      );
      for (const f of rows) {
        if (f && Number.isFinite(f.character_id) && Number.isFinite(f.location_id)) {
          stmt.run(id, f.character_id, f.location_id, zone, f.enabled === false ? 0 : 1);
        }
      }
    })();
    return { ok: true };
  });

  // Per-row bucket selection: which containers / fitted ships (and the loose "basic hangar")
  // at a filter row's location are subtracted. Defaults: containers + basic hangar on, ships off.
  app.get('/api/lists/:id/filters/buckets', async (req) => {
    const id = intParam(req, 'id');
    const q = req.query as { character_id?: string; location_id?: string; zone?: string };
    const characterId = Number(q.character_id);
    const locationId = Number(q.location_id);
    const zone = asZone(q.zone);
    if (!Number.isFinite(characterId) || !Number.isFinite(locationId)) {
      return { basic_hangar: true, has_basic_hangar: false, containers: [], ships: [] } satisfies FilterBuckets;
    }

    // Saved overrides for this (list, character, location, zone).
    const saved = db
      .prepare(
        `SELECT bucket_kind, bucket_id, enabled FROM list_filter_buckets
         WHERE list_id = ? AND character_id = ? AND location_id = ? AND zone = ?`,
      )
      .all(id, characterId, locationId, zone) as Array<{
      bucket_kind: string;
      bucket_id: number | null;
      enabled: number;
    }>;
    const savedContainer = new Map<number, boolean>();
    const savedShip = new Map<number, boolean>();
    let savedBasic: boolean | undefined;
    for (const s of saved) {
      if (s.bucket_kind === 'hangar') savedBasic = !!s.enabled;
      else if (s.bucket_kind === 'container' && s.bucket_id != null) savedContainer.set(s.bucket_id, !!s.enabled);
      else if (s.bucket_kind === 'ship' && s.bucket_id != null) savedShip.set(s.bucket_id, !!s.enabled);
    }

    // Distinct container / ship buckets actually present at this location, with a name +
    // a size hint (distinct item types held). The bucket item itself is counted too.
    const buckets = db
      .prepare(
        `SELECT a.bucket_kind AS bucket_kind, a.bucket_id AS bucket_id,
                MAX(CASE WHEN a.item_id = a.bucket_id THEN a.type_id END) AS type_id,
                MAX(CASE WHEN a.item_id = a.bucket_id THEN a.name END) AS custom_name,
                COUNT(DISTINCT a.type_id) AS item_count
         FROM assets a
         WHERE a.character_id = ? AND a.root_location_id = ? AND a.included = 1
           AND a.bucket_kind IN ('container', 'ship')
         GROUP BY a.bucket_kind, a.bucket_id`,
      )
      .all(characterId, locationId) as Array<{
      bucket_kind: string;
      bucket_id: number;
      type_id: number | null;
      custom_name: string | null;
      item_count: number;
    }>;

    const nameOf = (typeId: number | null): string => {
      if (typeId == null) return 'Unknown';
      const row = db.prepare('SELECT name FROM sde_types WHERE type_id = ?').get(typeId) as { name: string } | undefined;
      return row?.name ?? `Type ${typeId}`;
    };

    const containers: FilterBucketEntry[] = [];
    const ships: FilterBucketEntry[] = [];
    for (const b of buckets) {
      const typeName = nameOf(b.type_id);
      const entry: FilterBucketEntry = {
        bucket_id: b.bucket_id,
        type_id: b.type_id ?? 0,
        name: typeName,
        // ESI returns the type name for un-renamed ships/cans; only surface a genuinely
        // custom name (one that differs from the hull/type name).
        custom_name: b.custom_name && b.custom_name !== typeName ? b.custom_name : null,
        item_count: b.item_count,
        enabled: false,
      };
      if (b.bucket_kind === 'container') {
        entry.enabled = savedContainer.get(b.bucket_id) ?? true; // containers default on
        containers.push(entry);
      } else {
        entry.enabled = savedShip.get(b.bucket_id) ?? false; // ships default off
        ships.push(entry);
      }
    }
    const sortKey = (e: FilterBucketEntry) => e.custom_name ?? e.name;
    containers.sort((x, y) => sortKey(x).localeCompare(sortKey(y)));
    ships.sort((x, y) => sortKey(x).localeCompare(sortKey(y)));

    const hasBasic =
      (db
        .prepare(
          `SELECT 1 FROM assets WHERE character_id = ? AND root_location_id = ? AND included = 1
             AND bucket_kind = 'hangar' LIMIT 1`,
        )
        .get(characterId, locationId) as unknown) != null;

    return {
      basic_hangar: savedBasic ?? true,
      has_basic_hangar: hasBasic,
      containers,
      ships,
    } satisfies FilterBuckets;
  });

  app.put('/api/lists/:id/filters/buckets', async (req, reply) => {
    const id = intParam(req, 'id');
    if (!listExists(id)) return reply.code(404).send({ error: 'not_found' });
    const body = (req.body ?? {}) as Partial<FilterBucketsUpdate>;
    const characterId = Number(body.character_id);
    const locationId = Number(body.location_id);
    const zone = asZone(body.zone);
    if (!Number.isFinite(characterId) || !Number.isFinite(locationId)) {
      return reply.code(400).send({ error: 'missing_fields' });
    }
    const containers = Array.isArray(body.containers) ? body.containers : [];
    const ships = Array.isArray(body.ships) ? body.ships : [];
    db.transaction(() => {
      db.prepare(
        'DELETE FROM list_filter_buckets WHERE list_id = ? AND character_id = ? AND location_id = ? AND zone = ?',
      ).run(id, characterId, locationId, zone);
      const ins = db.prepare(
        `INSERT INTO list_filter_buckets(list_id, character_id, location_id, zone, bucket_kind, bucket_id, enabled)
         VALUES(?, ?, ?, ?, ?, ?, ?)`,
      );
      ins.run(id, characterId, locationId, zone, 'hangar', null, body.basic_hangar === false ? 0 : 1);
      for (const c of containers) {
        if (c && Number.isFinite(c.bucket_id)) {
          ins.run(id, characterId, locationId, zone, 'container', c.bucket_id, c.enabled === false ? 0 : 1);
        }
      }
      for (const s of ships) {
        if (s && Number.isFinite(s.bucket_id)) {
          ins.run(id, characterId, locationId, zone, 'ship', s.bucket_id, s.enabled === false ? 0 : 1);
        }
      }
    })();
    return { ok: true };
  });

  // Manual asset pastes: pasted stock snapshots that deduct alongside API assets.
  app.get('/api/lists/:id/asset-pastes', async (req) => {
    const id = intParam(req, 'id');
    const zone = asZone((req.query as { zone?: string }).zone);
    const rows = db
      .prepare(
        `SELECT p.id, p.list_id, p.name, p.created_at, p.enabled,
                (SELECT COUNT(*) FROM asset_paste_items i WHERE i.paste_id = p.id) AS item_count,
                (SELECT COALESCE(SUM(quantity), 0) FROM asset_paste_items i WHERE i.paste_id = p.id) AS total_quantity
         FROM asset_pastes p WHERE p.list_id = ? AND p.zone = ? ORDER BY p.created_at`,
      )
      .all(id, zone) as Array<Omit<AssetPaste, 'enabled'> & { enabled: number }>;
    return rows.map((r) => ({ ...r, enabled: !!r.enabled })) as AssetPaste[];
  });

  // Create a paste: parse + resolve every name, commit all-or-nothing (same contract as /import).
  app.post('/api/lists/:id/asset-pastes', async (req, reply) => {
    const id = intParam(req, 'id');
    if (!listExists(id)) return reply.code(404).send({ error: 'not_found' });
    const zone = asZone((req.query as { zone?: string }).zone);
    const { text } = (req.body ?? {}) as { text?: string };
    if (!text || !text.trim()) return reply.code(400).send({ error: 'empty', errors: [] });

    const { lines } = parsePaste(text);
    if (lines.length === 0) return reply.code(400).send({ error: 'no_lines', errors: [] });
    const resolved = resolveLines(lines);
    if (!resolved.ok) return reply.code(400).send({ error: 'unmatched', errors: resolved.errors });

    const now = Date.now();
    const name = stampName(now);
    const pasteId = db.transaction(() => {
      const info = db
        .prepare('INSERT INTO asset_pastes(list_id, name, created_at, enabled, zone) VALUES(?, ?, ?, 1, ?)')
        .run(id, name, now, zone);
      const pid = Number(info.lastInsertRowid);
      const ins = db.prepare('INSERT INTO asset_paste_items(paste_id, type_id, quantity) VALUES(?, ?, ?)');
      for (const [typeId, qty] of resolved.merged) ins.run(pid, typeId, qty);
      return pid;
    })();
    return reply.code(201).send({ id: pasteId, name, added: resolved.merged.size });
  });

  // Toggle a paste on/off (affects the deducted view without deleting the snapshot).
  app.put('/api/lists/:id/asset-pastes/:pasteId', async (req, reply) => {
    const id = intParam(req, 'id');
    const pasteId = intParam(req, 'pasteId');
    const { enabled } = (req.body ?? {}) as { enabled?: boolean };
    const info = db
      .prepare('UPDATE asset_pastes SET enabled = ? WHERE id = ? AND list_id = ?')
      .run(enabled ? 1 : 0, pasteId, id);
    if (info.changes === 0) return reply.code(404).send({ error: 'not_found' });
    return { ok: true };
  });

  app.delete('/api/lists/:id/asset-pastes/:pasteId', async (req, reply) => {
    const id = intParam(req, 'id');
    const pasteId = intParam(req, 'pasteId');
    const info = db.prepare('DELETE FROM asset_pastes WHERE id = ? AND list_id = ?').run(pasteId, id);
    if (info.changes === 0) return reply.code(404).send({ error: 'not_found' });
    return reply.code(204).send();
  });
}

/** Local-time label for a paste, e.g. "Asset paste 2026-07-26 14:32". */
function stampName(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `Asset paste ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
