import type { FastifyInstance } from 'fastify';
import { parseFit } from '@viator/shared';
import { getDb } from '../../db/db.js';
import { resolveLines } from '../../lists/resolveNames.js';
import {
  ensureManualHomeForUngrouped,
  fixActiveGroup,
  groupBelongs,
  intParam,
  isGroupless,
  listExists,
  nextGroupPosition,
  nextPosition,
  touchList,
} from './helpers.js';

/** Add-groups (named, toggleable item buckets) + ship fits (kind='fit' groups from a pyfa paste). */
export async function groupRoutes(app: FastifyInstance): Promise<void> {
  const db = getDb();

  // Create a group. Name defaults to "Group N"; new groups are enabled and appended.
  //
  // Creating the FIRST group on a groupless list *promotes* it into grouped mode by adding a
  // single starter "Default group" that **wraps any existing items** (loose ungrouped items move
  // into it) and becomes active — regardless of whether the list had items. Already-grouped lists
  // just append the next group.
  app.post('/api/lists/:id/groups', async (req, reply) => {
    const id = intParam(req, 'id');
    if (!listExists(id)) return reply.code(404).send({ error: 'not_found' });
    const { name } = (req.body ?? {}) as { name?: string };

    if (isGroupless(id)) {
      const result = db.transaction(() => {
        const trimmed = (name ?? '').trim() || 'Default group';
        const info = db
          .prepare("INSERT INTO add_groups(list_id, name, enabled, position, kind) VALUES(?, ?, 1, ?, 'manual')")
          .run(id, trimmed, nextGroupPosition(id));
        const newId = Number(info.lastInsertRowid);
        // Wrap any loose items into the starter group so they survive the promotion.
        db.prepare('UPDATE list_items SET group_id = ? WHERE list_id = ? AND group_id IS NULL').run(newId, id);
        db.prepare('UPDATE lists SET active_group_id = ? WHERE id = ?').run(newId, id);
        return { id: newId, name: trimmed };
      })();
      touchList(id);
      return reply.code(201).send(result);
    }

    const count = (
      db.prepare("SELECT COUNT(*) n FROM add_groups WHERE list_id = ? AND kind = 'manual'").get(id) as { n: number }
    ).n;
    const trimmed = (name ?? '').trim() || `Group ${count + 1}`;
    const info = db
      .prepare("INSERT INTO add_groups(list_id, name, enabled, position, kind) VALUES(?, ?, 1, ?, 'manual')")
      .run(id, trimmed, nextGroupPosition(id));
    return reply.code(201).send({ id: Number(info.lastInsertRowid), name: trimmed });
  });

  // Rename, toggle, and/or set the qty multiplier of a group. The multiplier (`fit_qty`) is
  // shared with fits — for a manual group it scales every line by that factor at rollup time.
  app.put('/api/lists/:id/groups/:groupId', async (req, reply) => {
    const id = intParam(req, 'id');
    const groupId = intParam(req, 'groupId');
    if (!groupBelongs(id, groupId)) return reply.code(404).send({ error: 'not_found' });
    const { name, enabled, fit_qty } = (req.body ?? {}) as { name?: string; enabled?: boolean; fit_qty?: number };
    if (name !== undefined) {
      const trimmed = name.trim();
      if (!trimmed) return reply.code(400).send({ error: 'name_required' });
      db.prepare('UPDATE add_groups SET name = ? WHERE id = ?').run(trimmed, groupId);
    }
    if (enabled !== undefined) {
      db.prepare('UPDATE add_groups SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, groupId);
    }
    if (fit_qty !== undefined) {
      const q = Math.floor(fit_qty);
      if (!Number.isFinite(q) || q <= 0) return reply.code(400).send({ error: 'invalid_quantity' });
      db.prepare('UPDATE add_groups SET fit_qty = ? WHERE id = ?').run(q, groupId);
    }
    touchList(id);
    return { ok: true };
  });

  // Delete a group. Normally its items go with it (FK cascade). But deleting the **last**
  // *manual* group returns the list to the groupless flat state and **keeps** its items as
  // ungrouped (group_id → NULL) rather than wiping them. A last *fit* group deletes normally
  // (a fit is re-pasteable; its modules shouldn't spill into a loose list), leaving the list
  // groupless and empty. active_group_id is re-pointed (or cleared) afterwards.
  app.delete('/api/lists/:id/groups/:groupId', async (req, reply) => {
    const id = intParam(req, 'id');
    const groupId = intParam(req, 'groupId');
    if (!groupBelongs(id, groupId)) return reply.code(404).send({ error: 'not_found' });
    db.transaction(() => {
      const total = (
        db.prepare('SELECT COUNT(*) n FROM add_groups WHERE list_id = ?').get(id) as { n: number }
      ).n;
      const kind = (db.prepare('SELECT kind FROM add_groups WHERE id = ?').get(groupId) as { kind: string }).kind;
      if (total === 1 && kind === 'manual') {
        // Last group, and it's manual: preserve its items as the ungrouped flat list.
        db.prepare('UPDATE list_items SET group_id = NULL WHERE list_id = ? AND group_id = ?').run(id, groupId);
      }
      db.prepare('DELETE FROM add_groups WHERE id = ?').run(groupId); // remaining items cascade-delete
      fixActiveGroup(id);
    })();
    touchList(id);
    return { ok: true };
  });

  // Set which group new adds/pastes land in.
  app.put('/api/lists/:id/active-group', async (req, reply) => {
    const id = intParam(req, 'id');
    const { group_id } = (req.body ?? {}) as { group_id?: number };
    if (!group_id || !groupBelongs(id, group_id)) return reply.code(400).send({ error: 'invalid_group' });
    db.prepare('UPDATE lists SET active_group_id = ? WHERE id = ?').run(group_id, id);
    return { ok: true };
  });

  // Create a fit from a pyfa paste: parse header + body, resolve every name (incl. the hull)
  // all-or-nothing, then create a fit group holding the merged items with a qty-1 multiplier.
  app.post('/api/lists/:id/fits', async (req, reply) => {
    const id = intParam(req, 'id');
    if (!listExists(id)) return reply.code(404).send({ error: 'not_found' });
    const { text } = (req.body ?? {}) as { text?: string };
    const parsed = resolveFit(text ?? '');
    if ('error' in parsed) return reply.code(400).send(parsed);

    const groupId = db.transaction(() => {
      // A fit turns a groupless list grouped — give any loose items a manual home first so they
      // don't become invisible once the grouped view takes over.
      ensureManualHomeForUngrouped(id);
      const info = db
        .prepare(
          `INSERT INTO add_groups(list_id, name, enabled, position, kind, ship_type_id, raw_fit, fit_qty)
           VALUES(?, ?, 1, ?, 'fit', ?, ?, 1)`,
        )
        .run(id, parsed.fitName, nextGroupPosition(id), parsed.shipTypeId, text);
      const gid = Number(info.lastInsertRowid);
      const ins = db.prepare(
        'INSERT INTO list_items(list_id, group_id, type_id, quantity, position) VALUES(?, ?, ?, ?, ?)',
      );
      let pos = nextPosition(id);
      for (const [typeId, qty] of parsed.merged) ins.run(id, gid, typeId, qty, pos++);
      return gid;
    })();
    touchList(id);
    return reply.code(201).send({ id: groupId, name: parsed.fitName });
  });

  // Edit a fit: re-paste (replaces items + name + hull) and/or change its qty multiplier.
  app.put('/api/lists/:id/fits/:groupId', async (req, reply) => {
    const id = intParam(req, 'id');
    const groupId = intParam(req, 'groupId');
    const isFit = db.prepare("SELECT 1 FROM add_groups WHERE id = ? AND list_id = ? AND kind = 'fit'").get(groupId, id);
    if (!isFit) return reply.code(404).send({ error: 'not_found' });
    const { text, fit_qty } = (req.body ?? {}) as { text?: string; fit_qty?: number };

    if (fit_qty !== undefined) {
      const q = Math.floor(fit_qty);
      if (!Number.isFinite(q) || q <= 0) return reply.code(400).send({ error: 'invalid_quantity' });
      db.prepare('UPDATE add_groups SET fit_qty = ? WHERE id = ?').run(q, groupId);
    }

    if (text !== undefined) {
      const parsed = resolveFit(text);
      if ('error' in parsed) return reply.code(400).send(parsed);
      db.transaction(() => {
        db.prepare('DELETE FROM list_items WHERE list_id = ? AND group_id = ?').run(id, groupId);
        db.prepare('UPDATE add_groups SET name = ?, ship_type_id = ?, raw_fit = ? WHERE id = ?').run(
          parsed.fitName,
          parsed.shipTypeId,
          text,
          groupId,
        );
        const ins = db.prepare(
          'INSERT INTO list_items(list_id, group_id, type_id, quantity, position) VALUES(?, ?, ?, ?, ?)',
        );
        let pos = nextPosition(id);
        for (const [typeId, qty] of parsed.merged) ins.run(id, groupId, typeId, qty, pos++);
      })();
    }

    touchList(id);
    return { ok: true };
  });
}

type FitResolveOk = { shipTypeId: number; fitName: string; merged: Map<number, number> };
type FitResolveErr = { error: string; errors: string[] };

/**
 * Parse + resolve a pyfa fit paste the same all-or-nothing way as a bulk import: every line
 * (including the ship hull) must resolve to a type, or the whole thing is rejected with the
 * unmatched raw lines. On success returns the hull's type_id (for the icon), the fit name,
 * and the merged {type_id → qty} map (raw per-fit quantities; the fit_qty multiplier is
 * applied later at rollup time).
 */
function resolveFit(text: string): FitResolveOk | FitResolveErr {
  if (!text || !text.trim()) return { error: 'empty', errors: [] };
  const fit = parseFit(text);
  if (!fit) return { error: 'not_a_fit', errors: [] };

  const resolved = resolveLines(fit.lines);
  if (!resolved.ok) return { error: 'unmatched', errors: resolved.errors };
  return { shipTypeId: resolved.byName.get(fit.shipName.toLowerCase())!, fitName: fit.fitName, merged: resolved.merged };
}
