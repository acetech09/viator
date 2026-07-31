import type { ListOverview, ListOverviewEntry } from '@viator/shared';
import { getDb } from '../db/db.js';
import { getSettings } from '../settings.js';
import { getCachedPrices } from '../prices/service.js';
import { packagedVolumeFor } from '../sde/packagedVolumes.js';

/** Max preview lines per card column; the client fades out anything past ~4. */
const PREVIEW_CAP = 6;

interface ItemRow {
  list_id: number;
  type_id: number;
  name: string;
  quantity: number;
  group_id: number | null; // NULL = ungrouped (flat list)
  volume: number | null;
  type_group_id: number;
}

interface GroupRow {
  id: number;
  list_id: number;
  name: string;
  enabled: number;
  kind: 'manual' | 'fit';
  ship_type_id: number | null;
  fit_qty: number;
}

/**
 * Card data for the lists index: per list, the same rollup as `buildPricedList` (ungrouped
 * items + enabled groups, fit_qty-expanded, no owned deduction) reduced to totals plus the
 * top preview lines by value. Reads only cached prices — unpriced lines count 0 toward the
 * total and sort last in the preview.
 */
export function buildListOverviews(): ListOverview[] {
  const db = getDb();
  const settings = getSettings();

  const lists = db
    .prepare('SELECT id, name, created_at, updated_at FROM lists ORDER BY updated_at DESC')
    .all() as Array<{ id: number; name: string; created_at: number; updated_at: number }>;

  const rows = db
    .prepare(
      `SELECT li.list_id, li.type_id, t.name, li.quantity, li.group_id, t.volume, t.group_id AS type_group_id
       FROM list_items li JOIN sde_types t ON t.type_id = li.type_id`,
    )
    .all() as ItemRow[];

  const groups = db
    .prepare('SELECT id, list_id, name, enabled, kind, ship_type_id, fit_qty FROM add_groups')
    .all() as GroupRow[];

  const prices = getCachedPrices(settings.price_source, [...new Set(rows.map((r) => r.type_id))]);
  const priceOf = (typeId: number): number | null => (prices.has(typeId) ? prices.get(typeId)! : null);

  const rowsByList = new Map<number, ItemRow[]>();
  for (const r of rows) {
    const arr = rowsByList.get(r.list_id);
    if (arr) arr.push(r);
    else rowsByList.set(r.list_id, [r]);
  }
  const groupsByList = new Map<number, GroupRow[]>();
  for (const g of groups) {
    const arr = groupsByList.get(g.list_id);
    if (arr) arr.push(g);
    else groupsByList.set(g.list_id, [g]);
  }

  return lists.map((l) => {
    const lrows = rowsByList.get(l.id) ?? [];
    const lgroups = groupsByList.get(l.id) ?? [];
    const groupById = new Map(lgroups.map((g) => [g.id, g]));

    // Rollup: ungrouped lines always count (no multiplier); grouped lines count when their
    // group is enabled, scaled by its fit_qty.
    const agg = new Map<number, { name: string; quantity: number; volume: number | null; type_group_id: number }>();
    for (const r of lrows) {
      const g = r.group_id === null ? null : groupById.get(r.group_id);
      if (r.group_id !== null && !g?.enabled) continue;
      const mult = g && g.fit_qty > 0 ? g.fit_qty : 1;
      const qty = r.quantity * mult;
      const cur = agg.get(r.type_id);
      if (cur) cur.quantity += qty;
      else agg.set(r.type_id, { name: r.name, quantity: qty, volume: r.volume, type_group_id: r.type_group_id });
    }

    let total = 0;
    let totalVolume = 0;
    let hasUnpriced = false;
    const lines = [...agg.entries()].map(([typeId, v]) => {
      const unit = priceOf(typeId);
      if (unit === null) hasUnpriced = true;
      const extended = unit !== null ? unit * v.quantity : null;
      if (extended !== null) total += extended;
      const unitVol = packagedVolumeFor(typeId, v.type_group_id) ?? v.volume;
      if (unitVol !== null) totalVolume += unitVol * v.quantity;
      return { type_id: typeId, name: v.name, quantity: v.quantity, extended };
    });
    lines.sort((a, b) => (b.extended ?? -1) - (a.extended ?? -1));
    const top_items: ListOverviewEntry[] = lines
      .slice(0, PREVIEW_CAP)
      .map(({ type_id, name, quantity }) => ({ type_id, name, quantity }));

    const top_fits: ListOverviewEntry[] = lgroups
      .filter((g) => g.kind === 'fit')
      .map((g) => {
        const mult = g.fit_qty > 0 ? g.fit_qty : 1;
        let value = 0;
        for (const r of lrows) {
          if (r.group_id !== g.id) continue;
          const unit = priceOf(r.type_id);
          if (unit !== null) value += unit * r.quantity * mult;
        }
        return { type_id: g.ship_type_id ?? 0, name: g.name, quantity: g.fit_qty, value };
      })
      .sort((a, b) => b.value - a.value)
      .slice(0, PREVIEW_CAP)
      .map(({ type_id, name, quantity }) => ({ type_id, name, quantity }));

    return {
      id: l.id,
      name: l.name,
      created_at: l.created_at,
      updated_at: l.updated_at,
      item_count: lrows.length,
      total,
      total_volume: totalVolume,
      has_unpriced: hasUnpriced,
      top_items,
      top_fits,
    };
  });
}
