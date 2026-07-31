import { describe, expect, it } from 'vitest';
import { classifyAssets, type EsiAsset } from './pipeline.js';

const SHIP = 587; // Rifter
const shipTypes = new Set<number>([SHIP]);
const STATION = 60003760;
const STRUCT = 1035466617946;

function a(p: Partial<EsiAsset> & { item_id: number; location_id: number }): EsiAsset {
  return { type_id: 34, quantity: 1, location_type: 'item', location_flag: 'Hangar', is_singleton: false, ...p } as EsiAsset;
}

function classify(assets: EsiAsset[]) {
  const map = new Map<number, { included: boolean; root: number; bucketKind: string; bucketId: number | null }>();
  for (const c of classifyAssets(assets, shipTypes))
    map.set(c.asset.item_id, { included: c.included, root: c.rootId, bucketKind: c.bucketKind, bucketId: c.bucketId });
  return map;
}

describe('classifyAssets', () => {
  it('includes loose hangar items, roots them to the station, buckets them as hangar', () => {
    const r = classify([
      a({ item_id: 1, quantity: 5000, location_id: STATION, location_type: 'station', location_flag: 'Hangar' }),
    ]);
    expect(r.get(1)).toEqual({ included: true, root: STATION, bucketKind: 'hangar', bucketId: null });
  });

  it('buckets a container and its nested contents under the container item_id', () => {
    const r = classify([
      a({ item_id: 2, type_id: 3296, location_id: STATION, location_type: 'station', location_flag: 'Hangar', is_singleton: true }),
      a({ item_id: 3, location_id: 2, location_flag: 'AutoFit' }),
    ]);
    expect(r.get(2)).toEqual({ included: true, root: STATION, bucketKind: 'container', bucketId: 2 });
    expect(r.get(3)).toEqual({ included: true, root: STATION, bucketKind: 'container', bucketId: 2 });
  });

  it('marks assembled ships + their fittings as an opt-in ship bucket (eligible, keyed to the hull)', () => {
    const r = classify([
      a({ item_id: 4, type_id: SHIP, location_id: STATION, location_type: 'station', location_flag: 'ShipHangar', is_singleton: true }),
      a({ item_id: 5, location_id: 4, location_flag: 'HiSlot0', is_singleton: true }),
    ]);
    expect(r.get(4)).toEqual({ included: true, root: STATION, bucketKind: 'ship', bucketId: 4 });
    expect(r.get(5)).toEqual({ included: true, root: STATION, bucketKind: 'ship', bucketId: 4 });
  });

  it('also treats an assembled ship sitting in the item Hangar as a ship bucket', () => {
    const r = classify([
      a({ item_id: 4, type_id: SHIP, location_id: STATION, location_type: 'station', location_flag: 'Hangar', is_singleton: true }),
    ]);
    expect(r.get(4)).toEqual({ included: true, root: STATION, bucketKind: 'ship', bucketId: 4 });
  });

  it('includes packaged (non-singleton) ships as basic-hangar items', () => {
    const r = classify([
      a({ item_id: 7, type_id: SHIP, quantity: 3, location_id: STATION, location_type: 'station', location_flag: 'Hangar', is_singleton: false }),
    ]);
    expect(r.get(7)).toEqual({ included: true, root: STATION, bucketKind: 'hangar', bucketId: null });
  });

  it('excludes ShipHangar (empty bay slots aside), AssetSafety, and items in space', () => {
    const r = classify([
      a({ item_id: 6, location_id: STATION, location_type: 'station', location_flag: 'ShipHangar' }),
      a({ item_id: 9, location_id: STATION, location_type: 'station', location_flag: 'AssetSafety' }),
      a({ item_id: 10, location_id: 30000142, location_type: 'solar_system', location_flag: 'Hangar' }),
    ]);
    expect(r.get(6)?.included).toBe(false);
    expect(r.get(9)?.included).toBe(false);
    expect(r.get(10)?.included).toBe(false);
  });

  it('includes items in a player structure hangar', () => {
    const r = classify([a({ item_id: 8, quantity: 10, location_id: STRUCT, location_type: 'item', location_flag: 'Hangar' })]);
    expect(r.get(8)).toEqual({ included: true, root: STRUCT, bucketKind: 'hangar', bucketId: null });
  });
});
