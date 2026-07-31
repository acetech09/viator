import type { FastifyRequest } from 'fastify';
import type { ListItem, StockZone } from '@viator/shared';
import { getDb } from '../../db/db.js';
import { getSettings } from '../../settings.js';

/** Numeric path param, e.g. `intParam(req, 'id')` for `/api/lists/:id`. */
export function intParam(req: FastifyRequest, name: string): number {
  return Number((req.params as Record<string, string>)[name]);
}

/** Normalize a `?zone=` (or body) value to a valid StockZone; anything else → 'purchase'. */
export function asZone(v: unknown): StockZone {
  return v === 'destination' ? 'destination' : 'purchase';
}

export function listExists(listId: number): boolean {
  return !!getDb().prepare('SELECT 1 FROM lists WHERE id = ?').get(listId);
}

export function touchList(listId: number): void {
  getDb().prepare('UPDATE lists SET updated_at = ? WHERE id = ?').run(Date.now(), listId);
}

export function listItems(listId: number): ListItem[] {
  return getDb()
    .prepare(
      `SELECT li.type_id, t.name, li.quantity, li.position
       FROM list_items li JOIN sde_types t ON t.type_id = li.type_id
       WHERE li.list_id = ? ORDER BY li.position`,
    )
    .all(listId) as ListItem[];
}

export function nextPosition(listId: number): number {
  const row = getDb()
    .prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM list_items WHERE list_id = ?')
    .get(listId) as { p: number };
  return row.p;
}

export function nextGroupPosition(listId: number): number {
  const row = getDb()
    .prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM add_groups WHERE list_id = ?')
    .get(listId) as { p: number };
  return row.p;
}

/** True when `groupId` is a group belonging to `listId` (any kind). */
export function groupBelongs(listId: number, groupId: number): boolean {
  return !!getDb().prepare('SELECT 1 FROM add_groups WHERE id = ? AND list_id = ?').get(groupId, listId);
}

/** True when `groupId` is a *manual* group of `listId` (a valid target for manual adds). */
export function manualGroupBelongs(listId: number, groupId: number): boolean {
  return !!getDb()
    .prepare("SELECT 1 FROM add_groups WHERE id = ? AND list_id = ? AND kind = 'manual'")
    .get(groupId, listId);
}

/** True when `listId` has no add-groups at all — its items are a flat, ungrouped list. */
export function isGroupless(listId: number): boolean {
  return !getDb().prepare('SELECT 1 FROM add_groups WHERE list_id = ? LIMIT 1').get(listId);
}

/**
 * The group new adds/pastes should land in, as a `group_id` — or `null` to land **ungrouped**
 * (a flat-list item) when the list has no groups at all. Preference: the caller's requested
 * manual group, else the active manual group, else the first manual group. If the list is
 * grouped but has no *manual* group (e.g. fit-only), a "Default group" is created so manual
 * adds always have a home — a grouped list never holds ungrouped items.
 */
export function resolveTargetGroup(listId: number, requested?: number): number | null {
  const db = getDb();
  if (requested && manualGroupBelongs(listId, requested)) return requested;
  const list = db.prepare('SELECT active_group_id FROM lists WHERE id = ?').get(listId) as
    | { active_group_id: number | null }
    | undefined;
  if (list?.active_group_id && manualGroupBelongs(listId, list.active_group_id)) return list.active_group_id;
  const first = db
    .prepare("SELECT id FROM add_groups WHERE list_id = ? AND kind = 'manual' ORDER BY position, id LIMIT 1")
    .get(listId) as { id: number } | undefined;
  if (first) return first.id;
  // No manual group. If the list is fully groupless, adds land ungrouped (flat list).
  if (isGroupless(listId)) return null;
  // Grouped (e.g. fit-only) but no manual home — create a Default group so adds stay grouped.
  const info = db
    .prepare("INSERT INTO add_groups(list_id, name, enabled, position, kind) VALUES(?, 'Default group', 1, ?, 'manual')")
    .run(listId, nextGroupPosition(listId));
  const gid = Number(info.lastInsertRowid);
  db.prepare('UPDATE lists SET active_group_id = COALESCE(active_group_id, ?) WHERE id = ?').run(gid, listId);
  return gid;
}

/**
 * Add `qty` to a list line, merging with any existing line for the same (list, group, type).
 * `groupId === null` targets the ungrouped flat list. SQLite treats NULLs as distinct in the
 * UNIQUE index, so ON CONFLICT can't merge ungrouped rows — we merge those by hand.
 */
export function upsertListItem(listId: number, groupId: number | null, typeId: number, qty: number): void {
  const db = getDb();
  if (groupId === null) {
    const existing = db
      .prepare('SELECT id FROM list_items WHERE list_id = ? AND group_id IS NULL AND type_id = ?')
      .get(listId, typeId) as { id: number } | undefined;
    if (existing) {
      db.prepare('UPDATE list_items SET quantity = quantity + ? WHERE id = ?').run(qty, existing.id);
    } else {
      db.prepare(
        'INSERT INTO list_items(list_id, group_id, type_id, quantity, position) VALUES(?, NULL, ?, ?, ?)',
      ).run(listId, typeId, qty, nextPosition(listId));
    }
    return;
  }
  db.prepare(
    `INSERT INTO list_items(list_id, group_id, type_id, quantity, position) VALUES(?, ?, ?, ?, ?)
     ON CONFLICT(list_id, group_id, type_id) DO UPDATE SET quantity = quantity + excluded.quantity`,
  ).run(listId, groupId, typeId, qty, nextPosition(listId));
}

/**
 * Before an action turns a groupless list grouped (adding a fit), sweep any loose ungrouped
 * items into a manual "Default group" so they stay visible — a grouped list never holds
 * ungrouped items. No-op when there are no ungrouped items.
 */
export function ensureManualHomeForUngrouped(listId: number): void {
  const db = getDb();
  const hasUngrouped = db
    .prepare('SELECT 1 FROM list_items WHERE list_id = ? AND group_id IS NULL LIMIT 1')
    .get(listId);
  if (!hasUngrouped) return;
  let g = db
    .prepare("SELECT id FROM add_groups WHERE list_id = ? AND kind = 'manual' ORDER BY position, id LIMIT 1")
    .get(listId) as { id: number } | undefined;
  if (!g) {
    const info = db
      .prepare("INSERT INTO add_groups(list_id, name, enabled, position, kind) VALUES(?, 'Default group', 1, ?, 'manual')")
      .run(listId, nextGroupPosition(listId));
    g = { id: Number(info.lastInsertRowid) };
  }
  db.prepare('UPDATE list_items SET group_id = ? WHERE list_id = ? AND group_id IS NULL').run(g.id, listId);
  db.prepare('UPDATE lists SET active_group_id = COALESCE(active_group_id, ?) WHERE id = ?').run(g.id, listId);
}

/**
 * Point active_group_id at a valid manual group of the list after a group mutation, or clear it
 * to NULL when no manual group remains (the list is now groupless). Never recreates a group —
 * a list is allowed to have none.
 */
export function fixActiveGroup(listId: number): void {
  const db = getDb();
  const list = db.prepare('SELECT active_group_id FROM lists WHERE id = ?').get(listId) as
    | { active_group_id: number | null }
    | undefined;
  if (list?.active_group_id && manualGroupBelongs(listId, list.active_group_id)) return;
  const first = db
    .prepare("SELECT id FROM add_groups WHERE list_id = ? AND kind = 'manual' ORDER BY position, id LIMIT 1")
    .get(listId) as { id: number } | undefined;
  db.prepare('UPDATE lists SET active_group_id = ? WHERE id = ?').run(first?.id ?? null, listId);
}

/**
 * One-time seed of a new list's existing-stock filter rows from the saved default locations,
 * when defaults are enabled. Runs **server-side at list creation** so the seed is deterministic
 * and happens exactly once — the client never re-seeds. That means emptying the filters (the ✕
 * button) stays empty instead of the default silently reappearing, and there's no
 * optimistic-write race that can leave the seeded row invisible on the first view.
 */
export function seedDefaultFilters(listId: number): void {
  if (!getSettings().defaults_enabled) return;
  const db = getDb();
  const defaults = db
    .prepare('SELECT character_id, location_id, zone FROM default_locations')
    .all() as Array<{ character_id: number; location_id: number; zone: string }>;
  if (defaults.length === 0) return;
  const ins = db.prepare(
    'INSERT OR IGNORE INTO list_filters(list_id, character_id, location_id, zone, enabled) VALUES(?, ?, ?, ?, 1)',
  );
  for (const d of defaults) {
    ins.run(listId, d.character_id, d.location_id, asZone(d.zone));
  }
}
