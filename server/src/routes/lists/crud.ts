import type { FastifyInstance } from 'fastify';
import { parsePaste } from '@viator/shared';
import { getDb } from '../../db/db.js';
import { buildPricedList } from '../../lists/priced.js';
import { buildListOverviews } from '../../lists/overview.js';
import { ensurePricesForList, ensurePricesForOverview } from '../../prices/refresh.js';
import { resolveLines } from '../../lists/resolveNames.js';
import {
  intParam,
  listExists,
  listItems,
  resolveTargetGroup,
  seedDefaultFilters,
  touchList,
  upsertListItem,
} from './helpers.js';

/** Lists CRUD + duplicate, item add/edit/remove, bulk paste import, and the priced view. */
export async function listCrudRoutes(app: FastifyInstance): Promise<void> {
  const db = getDb();

  // The lists index returns full overview cards (totals + value-sorted previews), priced
  // from the cache after a best-effort bulk warm-up.
  app.get('/api/lists', async () => {
    await ensurePricesForOverview();
    return buildListOverviews();
  });

  app.post('/api/lists', async (req, reply) => {
    const { name } = (req.body ?? {}) as { name?: string };
    const trimmed = (name ?? '').trim() || 'New list';
    const now = Date.now();
    const info = db.prepare('INSERT INTO lists(name, created_at, updated_at) VALUES(?, ?, ?)').run(trimmed, now, now);
    const newId = Number(info.lastInsertRowid);
    // New lists start groupless: no add-groups, items land in a flat ungrouped list until the
    // user creates a group or adds a fit (which promotes the list to grouped mode).
    seedDefaultFilters(newId); // one-time seed of existing-stock filters from default locations
    return reply.code(201).send({ id: newId, name: trimmed, item_count: 0, created_at: now, updated_at: now });
  });

  app.put('/api/lists/:id', async (req, reply) => {
    const id = intParam(req, 'id');
    const { name } = (req.body ?? {}) as { name?: string };
    if (!name || !name.trim()) return reply.code(400).send({ error: 'name_required' });
    const info = db.prepare('UPDATE lists SET name = ?, updated_at = ? WHERE id = ?').run(name.trim(), Date.now(), id);
    if (info.changes === 0) return reply.code(404).send({ error: 'not_found' });
    return { ok: true };
  });

  app.delete('/api/lists/:id', async (req, reply) => {
    const id = intParam(req, 'id');
    const info = db.prepare('DELETE FROM lists WHERE id = ?').run(id);
    if (info.changes === 0) return reply.code(404).send({ error: 'not_found' });
    return reply.code(204).send();
  });

  app.post('/api/lists/:id/duplicate', async (req, reply) => {
    const id = intParam(req, 'id');
    const src = db.prepare('SELECT name, active_group_id FROM lists WHERE id = ?').get(id) as
      | { name: string; active_group_id: number | null }
      | undefined;
    if (!src) return reply.code(404).send({ error: 'not_found' });
    const now = Date.now();
    const newId = db.transaction(() => {
      const info = db
        .prepare('INSERT INTO lists(name, created_at, updated_at) VALUES(?, ?, ?)')
        .run(`${src.name} (copy)`, now, now);
      const nid = Number(info.lastInsertRowid);

      // Copy groups first, remembering old→new id so items keep their grouping. Fit
      // metadata (kind/ship/paste/multiplier) is carried across so duplicated fits stay fits.
      const srcGroups = db
        .prepare(
          `SELECT id, name, enabled, position, kind, ship_type_id, raw_fit, fit_qty
           FROM add_groups WHERE list_id = ? ORDER BY position, id`,
        )
        .all(id) as Array<{
        id: number;
        name: string;
        enabled: number;
        position: number;
        kind: string;
        ship_type_id: number | null;
        raw_fit: string | null;
        fit_qty: number;
      }>;
      const insertGroup = db.prepare(
        `INSERT INTO add_groups(list_id, name, enabled, position, kind, ship_type_id, raw_fit, fit_qty)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const idMap = new Map<number, number>();
      for (const g of srcGroups) {
        const gi = insertGroup.run(nid, g.name, g.enabled, g.position, g.kind, g.ship_type_id, g.raw_fit, g.fit_qty);
        idMap.set(g.id, Number(gi.lastInsertRowid));
      }

      const srcItems = db
        .prepare('SELECT group_id, type_id, quantity, position FROM list_items WHERE list_id = ?')
        .all(id) as Array<{ group_id: number | null; type_id: number; quantity: number; position: number }>;
      const insertItem = db.prepare(
        'INSERT INTO list_items(list_id, group_id, type_id, quantity, position) VALUES(?, ?, ?, ?, ?)',
      );
      for (const it of srcItems) {
        // Ungrouped items (groupless source) copy across with a NULL group_id; grouped items
        // follow their group's old→new id mapping.
        if (it.group_id == null) {
          insertItem.run(nid, null, it.type_id, it.quantity, it.position);
        } else {
          const gid = idMap.get(it.group_id);
          if (gid) insertItem.run(nid, gid, it.type_id, it.quantity, it.position);
        }
      }

      const activeCopy = src.active_group_id ? idMap.get(src.active_group_id) : undefined;
      db.prepare('UPDATE lists SET active_group_id = ? WHERE id = ?').run(activeCopy ?? null, nid);
      return nid;
    })();
    seedDefaultFilters(newId); // mirror new-list behavior: default existing-stock filters
    return reply.code(201).send({ id: newId });
  });

  app.get('/api/lists/:id', async (req, reply) => {
    const id = intParam(req, 'id');
    const list = db.prepare('SELECT id, name, created_at, updated_at FROM lists WHERE id = ?').get(id) as
      | { id: number; name: string; created_at: number; updated_at: number }
      | undefined;
    if (!list) return reply.code(404).send({ error: 'not_found' });
    return { ...list, items: listItems(id) };
  });

  // Add an item to a group (upsert within that group). group_id is optional; when omitted
  // the item lands in the list's active group.
  app.post('/api/lists/:id/items', async (req, reply) => {
    const id = intParam(req, 'id');
    const { type_id, quantity, group_id } = (req.body ?? {}) as {
      type_id?: number;
      quantity?: number;
      group_id?: number;
    };
    if (!type_id) return reply.code(400).send({ error: 'type_id_required' });
    const qty = Math.max(1, Math.floor(quantity ?? 1));
    if (!db.prepare('SELECT 1 FROM sde_types WHERE type_id = ?').get(type_id)) {
      return reply.code(400).send({ error: 'unknown_type' });
    }
    if (!listExists(id)) return reply.code(404).send({ error: 'not_found' });
    const groupId = resolveTargetGroup(id, group_id); // null → land in the ungrouped flat list
    upsertListItem(id, groupId, type_id, qty);
    touchList(id);
    return { ok: true, items: listItems(id) };
  });

  // Set one line's quantity outright (from the qty-cell editor). Rejects <= 0. `groupId` 0 is
  // the ungrouped sentinel (a flat-list line, group_id IS NULL).
  app.put('/api/lists/:id/groups/:groupId/items/:typeId', async (req, reply) => {
    const id = intParam(req, 'id');
    const groupId = intParam(req, 'groupId');
    const typeId = intParam(req, 'typeId');
    const { quantity } = (req.body ?? {}) as { quantity?: number };
    const qty = Math.floor(quantity ?? 0);
    if (!Number.isFinite(qty) || qty <= 0) return reply.code(400).send({ error: 'invalid_quantity' });
    const info =
      groupId === 0
        ? db
            .prepare('UPDATE list_items SET quantity = ? WHERE list_id = ? AND group_id IS NULL AND type_id = ?')
            .run(qty, id, typeId)
        : db
            .prepare('UPDATE list_items SET quantity = ? WHERE list_id = ? AND group_id = ? AND type_id = ?')
            .run(qty, id, groupId, typeId);
    if (info.changes === 0) return reply.code(404).send({ error: 'not_found' });
    touchList(id);
    return { ok: true };
  });

  app.delete('/api/lists/:id/groups/:groupId/items/:typeId', async (req, reply) => {
    const id = intParam(req, 'id');
    const groupId = intParam(req, 'groupId');
    const typeId = intParam(req, 'typeId');
    const info =
      groupId === 0
        ? db
            .prepare('DELETE FROM list_items WHERE list_id = ? AND group_id IS NULL AND type_id = ?')
            .run(id, typeId)
        : db
            .prepare('DELETE FROM list_items WHERE list_id = ? AND group_id = ? AND type_id = ?')
            .run(id, groupId, typeId);
    if (info.changes === 0) return reply.code(404).send({ error: 'not_found' });
    touchList(id);
    return { ok: true };
  });

  // Bulk paste import into a group: parse, resolve every name, commit all-or-nothing.
  // group_id is optional; omitted → the list's active group.
  app.post('/api/lists/:id/import', async (req, reply) => {
    const id = intParam(req, 'id');
    if (!listExists(id)) return reply.code(404).send({ error: 'not_found' });
    const { text, group_id } = (req.body ?? {}) as { text?: string; group_id?: number };
    if (!text || !text.trim()) return reply.code(400).send({ error: 'empty', errors: [] });
    const groupId = resolveTargetGroup(id, group_id); // null → land in the ungrouped flat list

    const { lines } = parsePaste(text);
    if (lines.length === 0) return reply.code(400).send({ error: 'no_lines', errors: [] });
    const resolved = resolveLines(lines);
    if (!resolved.ok) return reply.code(400).send({ error: 'unmatched', errors: resolved.errors });

    db.transaction(() => {
      for (const [typeId, qty] of resolved.merged) upsertListItem(id, groupId, typeId, qty);
    })();
    touchList(id);
    return { ok: true, added: resolved.merged.size };
  });

  // Priced, filter-deducted view. Ensures prices are fetched/refreshed first.
  app.get('/api/lists/:id/priced', async (req, reply) => {
    const id = intParam(req, 'id');
    if (!listExists(id)) return reply.code(404).send({ error: 'not_found' });
    await ensurePricesForList(id);
    const priced = buildPricedList(id);
    if (!priced) return reply.code(404).send({ error: 'not_found' });
    return priced;
  });
}
