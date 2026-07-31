import type { PricedGroup, PricedGroupItem, PricedItem, PricedList } from '@viator/shared';
import { getDb } from '../db/db.js';
import { getSettings } from '../settings.js';
import { getCachedPrices } from '../prices/service.js';
import { getOwnedForList } from '../assets/owned.js';
import { packagedVolumeFor } from '../sde/packagedVolumes.js';

interface ItemRow {
  type_id: number;
  name: string;
  quantity: number;
  position: number;
  group_id: number | null; // add-group the line belongs to; NULL = ungrouped (flat list)
  volume: number | null; // SDE assembled volume (m³)
  type_group_id: number; // SDE group of the type (for packaged-ship volumes)
}

interface GroupRow {
  id: number;
  name: string;
  enabled: number;
  position: number;
  kind: 'manual' | 'fit';
  ship_type_id: number | null;
  fit_qty: number;
  raw_fit: string | null;
}

/**
 * Assemble a fully-priced view of a list in two shapes:
 *  - `items`/`total`: the ROLLUP — quantities aggregated across enabled groups per type,
 *    then owned/stock-deducted (the "what do I actually buy" view + Multibuy source).
 *  - `groups`: per-group priced lines and subtotals (raw stored quantities, no owned
 *    deduction), including disabled groups so the grouped view can grey them.
 */
export function buildPricedList(listId: number): PricedList | null {
  const db = getDb();
  const list = db.prepare('SELECT id, name, active_group_id FROM lists WHERE id = ?').get(listId) as
    | { id: number; name: string; active_group_id: number | null }
    | undefined;
  if (!list) return null;

  const settings = getSettings();

  const rows = db
    .prepare(
      `SELECT li.type_id, t.name, li.quantity, li.position, li.group_id, t.volume, t.group_id AS type_group_id
       FROM list_items li JOIN sde_types t ON t.type_id = li.type_id
       WHERE li.list_id = ? ORDER BY li.position`,
    )
    .all(listId) as ItemRow[];

  // Display order (the client renders groups in the order it gets them): manual groups first,
  // then fits, each alphabetical. `position` only breaks ties between same-named rows now.
  const groupRows = db
    .prepare(
      `SELECT id, name, enabled, position, kind, ship_type_id, fit_qty, raw_fit
       FROM add_groups WHERE list_id = ?
       ORDER BY CASE kind WHEN 'manual' THEN 0 ELSE 1 END, name COLLATE NOCASE, position, id`,
    )
    .all(listId) as GroupRow[];

  // Fit groups scale every line by their multiplier; manual groups have fit_qty 1 (no-op).
  // Ungrouped lines (null) carry no multiplier.
  const multiplierOf = (groupId: number | null): number => {
    const g = groupRows.find((r) => r.id === groupId);
    return g && g.fit_qty > 0 ? g.fit_qty : 1;
  };

  const typeIds = [...new Set(rows.map((r) => r.type_id))];
  const prices = getCachedPrices(settings.price_source, typeIds);
  const priceOf = (typeId: number): number | null => (prices.has(typeId) ? prices.get(typeId)! : null);

  // Unit volume (m³) per type, as bought/hauled: packaged volume for ships (a Rifter hauls
  // at 2,500 m³, not its 27,289 m³ assembled size), otherwise the SDE assembled volume.
  // Same for every add-group a type appears in.
  const volumes = new Map<number, number | null>(
    rows.map((r) => [r.type_id, packagedVolumeFor(r.type_id, r.type_group_id) ?? r.volume]),
  );
  const volumeOf = (typeId: number): number | null => volumes.get(typeId) ?? null;

  // ---- Grouped view: per-group priced lines (raw quantities) ----
  const groups: PricedGroup[] = groupRows.map((g) => {
    const mult = g.fit_qty > 0 ? g.fit_qty : 1;
    let subtotal = 0;
    let subtotalVolume = 0;
    let hasUnpriced = false;
    const items: PricedGroupItem[] = rows
      .filter((r) => r.group_id === g.id)
      .map((r) => {
        const qty = r.quantity * mult;
        const unit = priceOf(r.type_id);
        if (unit === null) hasUnpriced = true;
        const extended = unit !== null ? unit * qty : null;
        if (extended !== null) subtotal += extended;
        const unitVol = volumeOf(r.type_id);
        const extendedVol = unitVol !== null ? unitVol * qty : null;
        if (extendedVol !== null) subtotalVolume += extendedVol;
        return {
          type_id: r.type_id,
          name: r.name,
          stored_quantity: r.quantity,
          quantity: qty,
          position: r.position,
          unit_price: unit,
          extended_price: extended,
          unit_volume: unitVol,
          extended_volume: extendedVol,
        };
      });
    return {
      id: g.id,
      name: g.name,
      enabled: !!g.enabled,
      position: g.position,
      items,
      item_count: items.length,
      subtotal,
      subtotal_volume: subtotalVolume,
      has_unpriced: hasUnpriced,
      kind: g.kind,
      ship_type_id: g.ship_type_id,
      fit_qty: mult,
      raw_fit: g.raw_fit,
    };
  });

  // ---- Rollup: aggregate ungrouped items + ENABLED groups per type, then deduct owned ----
  // Ungrouped lines (group_id NULL, a groupless flat list) always count and carry no multiplier.
  const enabledGroupIds = new Set(groupRows.filter((g) => g.enabled).map((g) => g.id));
  const agg = new Map<number, { name: string; quantity: number; position: number }>();
  for (const r of rows) {
    if (r.group_id !== null && !enabledGroupIds.has(r.group_id)) continue;
    const qty = r.group_id === null ? r.quantity : r.quantity * multiplierOf(r.group_id);
    const cur = agg.get(r.type_id);
    if (cur) {
      cur.quantity += qty;
      cur.position = Math.min(cur.position, r.position);
    } else {
      agg.set(r.type_id, { name: r.name, quantity: qty, position: r.position });
    }
  }

  // Owned stock split by zone: purchase-location stock nets out of the Purchase view, and
  // destination stock nets out of both Purchase and Transport. The client derives each view's
  // deducted quantities/totals from these two components, so the rollup just carries them raw.
  const ownedPurchase = getOwnedForList(listId, 'purchase');
  const ownedDestination = getOwnedForList(listId, 'destination');
  let hasUnpriced = false;
  const items: PricedItem[] = [...agg.entries()]
    .sort((a, b) => a[1].position - b[1].position)
    .map(([typeId, v]) => {
      const unit = priceOf(typeId);
      if (unit === null) hasUnpriced = true;
      return {
        type_id: typeId,
        name: v.name,
        quantity: v.quantity,
        owned_purchase: ownedPurchase.get(typeId) ?? 0,
        owned_destination: ownedDestination.get(typeId) ?? 0,
        position: v.position,
        unit_price: unit,
        unit_volume: volumeOf(typeId),
      };
    });

  return {
    list_id: list.id,
    name: list.name,
    price_source: settings.price_source,
    items,
    has_unpriced: hasUnpriced,
    groups,
    active_group_id: list.active_group_id ?? groupRows[0]?.id ?? 0,
  };
}
