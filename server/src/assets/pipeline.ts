import type { AssetRefreshStatus } from '@viator/shared';
import { getDb } from '../db/db.js';
import { esiRequest } from '../esi/client.js';
import { getAccessToken } from '../esi/tokens.js';
import { getShipTypeIds } from '../sde/updater.js';

export interface EsiAsset {
  item_id: number;
  type_id: number;
  quantity: number;
  location_id: number;
  location_type: 'station' | 'solar_system' | 'item' | 'other';
  location_flag: string;
  is_singleton: boolean;
}

/** The top-level container an asset belongs to at its hangar root. */
export type BucketKind = 'hangar' | 'container' | 'ship';

export interface ClassifiedAsset {
  asset: EsiAsset;
  rootId: number;
  included: boolean;
  /** Which top-level bucket this asset counts under (see BucketKind). */
  bucketKind: BucketKind;
  /** The container/ship item_id for 'container'/'ship'; NULL for the single 'hangar' bucket. */
  bucketId: number | null;
}

const STATION_MIN = 60_000_000;
const STATION_MAX = 64_000_000;
const STRUCTURE_MIN = 1_000_000_000_000; // Upwell structures / player-owned

function rootKind(id: number): 'station' | 'structure' | 'other' {
  if (id >= STATION_MIN && id <= STATION_MAX) return 'station';
  if (id >= STRUCTURE_MIN) return 'structure';
  return 'other';
}

/** Refresh one character's assets if not in cooldown. Returns the character's status. */
export async function refreshCharacterAssets(characterId: number, force = false): Promise<AssetRefreshStatus> {
  const db = getDb();
  const name = (db.prepare('SELECT name FROM characters WHERE character_id = ?').get(characterId) as { name: string } | undefined)?.name ?? '';
  const prev = db.prepare('SELECT fetched_at, expires_at FROM asset_refresh WHERE character_id = ?').get(characterId) as
    | { fetched_at: number | null; expires_at: number | null }
    | undefined;

  const now = Date.now();
  const nextAllowed = nextAllowedAt(prev);
  if (!force && prev?.fetched_at && now < nextAllowed) {
    return statusFor(characterId, name);
  }

  try {
    const token = await getAccessToken(characterId);
    const { assets, expiresAt } = await fetchAllAssets(characterId, token);
    ingestAssets(characterId, assets);
    await resolveNewLocations(characterId, token);
    await resolveAssetNames(characterId, token);
    db.prepare(
      `INSERT INTO asset_refresh(character_id, fetched_at, expires_at, etag, last_error)
       VALUES(?, ?, ?, NULL, NULL)
       ON CONFLICT(character_id) DO UPDATE SET fetched_at = excluded.fetched_at, expires_at = excluded.expires_at, last_error = NULL`,
    ).run(characterId, now, expiresAt);
  } catch (err) {
    const msg = (err as Error).message.slice(0, 200);
    db.prepare(
      `INSERT INTO asset_refresh(character_id, fetched_at, expires_at, etag, last_error)
       VALUES(?, ?, ?, NULL, ?)
       ON CONFLICT(character_id) DO UPDATE SET last_error = excluded.last_error`,
    ).run(characterId, prev?.fetched_at ?? null, prev?.expires_at ?? null, msg);
  }
  return statusFor(characterId, name);
}

function nextAllowedAt(prev?: { fetched_at: number | null; expires_at: number | null }): number {
  // ESI caches character assets server-side (~1h). Requesting again before the
  // Expires header just returns the same snapshot, so gate purely on it — the
  // moment it lapses is the earliest new data can exist.
  if (!prev?.fetched_at) return 0;
  return prev.expires_at ?? 0;
}

function statusFor(characterId: number, name: string): AssetRefreshStatus {
  const db = getDb();
  const r = db.prepare('SELECT fetched_at, expires_at, last_error FROM asset_refresh WHERE character_id = ?').get(characterId) as
    | { fetched_at: number | null; expires_at: number | null; last_error: string | null }
    | undefined;
  const next = nextAllowedAt(r);
  return {
    character_id: characterId,
    name,
    fetched_at: r?.fetched_at ?? null,
    next_allowed_at: next,
    in_cooldown: Date.now() < next,
    last_error: r?.last_error ?? null,
  };
}

async function fetchAllAssets(characterId: number, token: string): Promise<{ assets: EsiAsset[]; expiresAt: number }> {
  const path = `/characters/${characterId}/assets`;
  const first = await esiRequest<EsiAsset[]>(path, { token, query: { page: 1 } });
  const pages = Number(first.headers.get('x-pages') ?? '1');
  let assets = first.data;
  const expiresAt = parseExpires(first.headers) ?? Date.now() + 60 * 60 * 1000;
  if (pages > 1) {
    const rest = await Promise.all(
      Array.from({ length: pages - 1 }, (_, i) => esiRequest<EsiAsset[]>(path, { token, query: { page: i + 2 } })),
    );
    for (const r of rest) assets = assets.concat(r.data);
  }
  return { assets, expiresAt };
}

/**
 * Compute, for each asset, its root location, the top-level bucket it belongs to, and
 * whether it's *eligible* to count as owned. Pure: no DB access, so it can be unit-tested.
 *
 * An asset is `included` (eligible) when its top-level ancestor sits directly in a
 * station/structure hangar — either the item `Hangar` (loose items, containers) or, for an
 * assembled ship, the `Hangar`/`ShipHangar` bay. Every eligible asset is tagged with the
 * top-level bucket it counts under:
 *   'hangar'    — the top-level ancestor is a loose Hangar item with no contents
 *   'container' — the top-level ancestor is a Hangar item that holds other items
 *   'ship'      — the top-level ancestor is an assembled ship (its hull, fittings, and cargo)
 * Whether a bucket actually deducts is decided at query time (`getOwnedForList`); the default
 * is containers + basic hangar on, ships off — which reproduces the pre-bucket behavior.
 */
export function classifyAssets(assets: EsiAsset[], shipTypes: Set<number>): ClassifiedAsset[] {
  const byItemId = new Map<number, EsiAsset>();
  const hasContents = new Set<number>();
  for (const a of assets) byItemId.set(a.item_id, a);
  for (const a of assets) if (byItemId.has(a.location_id)) hasContents.add(a.location_id);

  return assets.map((a) => {
    // Walk to the root, keeping `top` = the top-level ancestor (the direct child of the
    // root). If `a` sits directly in the root, top === a.
    let top = a;
    let guard = 0;
    while (byItemId.has(top.location_id) && guard++ < 128) {
      top = byItemId.get(top.location_id)!;
    }
    const rootId = top.location_id; // top is the top-level ancestor; its parent is the root
    const kind = rootKind(rootId);
    const rootOk = kind === 'station' || kind === 'structure';
    const isShip = isAssembledShip(top, shipTypes);

    let bucketKind: BucketKind;
    let bucketId: number | null;
    let included: boolean;
    if (isShip) {
      // Assembled ships live in the ShipHangar (occasionally the item Hangar); their hull,
      // fittings, and cargo form one opt-in bucket.
      bucketKind = 'ship';
      bucketId = top.item_id;
      included = rootOk && (top.location_flag === 'ShipHangar' || top.location_flag === 'Hangar');
    } else {
      included = rootOk && top.location_flag === 'Hangar';
      if (hasContents.has(top.item_id)) {
        bucketKind = 'container';
        bucketId = top.item_id;
      } else {
        bucketKind = 'hangar';
        bucketId = null;
      }
    }
    return { asset: a, rootId, included, bucketKind, bucketId };
  });
}

/** Compute roots + inclusion flags and replace the character's asset rows in one tx. */
function ingestAssets(characterId: number, assets: EsiAsset[]): void {
  const db = getDb();
  const shipTypes = getShipTypeIds();
  const computed = classifyAssets(assets, shipTypes);

  const insert = db.prepare(
    `INSERT INTO assets(character_id, item_id, type_id, quantity, location_id, location_type, location_flag, is_singleton, root_location_id, included, bucket_kind, bucket_id)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  db.transaction(() => {
    db.prepare('DELETE FROM assets WHERE character_id = ?').run(characterId);
    for (const c of computed) {
      insert.run(
        characterId,
        c.asset.item_id,
        c.asset.type_id,
        c.asset.quantity,
        c.asset.location_id,
        c.asset.location_type,
        c.asset.location_flag,
        c.asset.is_singleton ? 1 : 0,
        c.rootId,
        c.included ? 1 : 0,
        c.bucketKind,
        c.bucketId,
      );
    }
  })();
}

/**
 * Reclassify already-stored assets so the v6 bucket columns (and the widened `included`
 * eligibility that now covers ships) are populated without waiting for the ~1h ESI cache to
 * lapse. Runs once at startup: for any character whose rows still have a NULL bucket_kind, it
 * rebuilds EsiAsset shapes from the stored columns and re-runs the pure classifier. A no-op
 * once every character has been re-ingested at least once.
 */
export function backfillAssetBuckets(): void {
  const db = getDb();
  const chars = db
    .prepare('SELECT DISTINCT character_id FROM assets WHERE bucket_kind IS NULL')
    .all() as Array<{ character_id: number }>;
  if (chars.length === 0) return;

  const shipTypes = getShipTypeIds();
  const update = db.prepare(
    'UPDATE assets SET included = ?, bucket_kind = ?, bucket_id = ? WHERE character_id = ? AND item_id = ?',
  );
  for (const { character_id } of chars) {
    const rows = db
      .prepare(
        `SELECT item_id, type_id, quantity, location_id, location_type, location_flag, is_singleton
         FROM assets WHERE character_id = ?`,
      )
      .all(character_id) as Array<{
      item_id: number;
      type_id: number;
      quantity: number;
      location_id: number;
      location_type: string;
      location_flag: string;
      is_singleton: number;
    }>;
    const assets: EsiAsset[] = rows.map((r) => ({
      item_id: r.item_id,
      type_id: r.type_id,
      quantity: r.quantity,
      location_id: r.location_id,
      location_type: r.location_type as EsiAsset['location_type'],
      location_flag: r.location_flag,
      is_singleton: !!r.is_singleton,
    }));
    const computed = classifyAssets(assets, shipTypes);
    db.transaction(() => {
      for (const c of computed) {
        update.run(c.included ? 1 : 0, c.bucketKind, c.bucketId, character_id, c.asset.item_id);
      }
    })();
  }
}

function isAssembledShip(a: EsiAsset, shipTypes: Set<number>): boolean {
  return a.is_singleton && shipTypes.has(a.type_id);
}

/** Resolve names for any root locations we haven't seen yet. */
async function resolveNewLocations(characterId: number, token: string): Promise<void> {
  const db = getDb();
  const roots = db
    .prepare(
      `SELECT DISTINCT root_location_id AS id FROM assets
       WHERE character_id = ? AND included = 1
         AND root_location_id NOT IN (SELECT location_id FROM location_names WHERE name IS NOT NULL)`,
    )
    .all(characterId) as Array<{ id: number }>;

  for (const { id } of roots) {
    const kind = rootKind(id);
    try {
      if (kind === 'station') {
        const { data } = await esiRequest<{ name: string; system_id: number }>(`/universe/stations/${id}`, { cache: true });
        upsertLocation(id, 'station', data.name, data.system_id);
      } else if (kind === 'structure') {
        const { data } = await esiRequest<{ name: string; solar_system_id: number }>(`/universe/structures/${id}`, { token });
        upsertLocation(id, 'structure', data.name, data.solar_system_id);
      }
    } catch {
      // 403 (no docking ACL) or transient: store a placeholder so the UI has something.
      upsertLocation(id, kind === 'structure' ? 'structure' : 'station', null, null);
    }
  }
}

/**
 * Resolve player-assigned names for the singleton container/ship bucket items so the picker
 * can show a ship's given name. `/assets/names` only returns names for singleton items and is
 * best-effort: on failure (or for an un-renamed item, which ESI returns as the type name) we
 * simply fall back to the type name in the UI. Item ids are chunked to the endpoint's 1000 max.
 */
async function resolveAssetNames(characterId: number, token: string): Promise<void> {
  const db = getDb();
  const ids = (
    db
      .prepare(
        `SELECT DISTINCT item_id FROM assets
         WHERE character_id = ? AND included = 1 AND is_singleton = 1
           AND bucket_kind IN ('container', 'ship') AND item_id = bucket_id`,
      )
      .all(characterId) as Array<{ item_id: number }>
  ).map((r) => r.item_id);
  if (ids.length === 0) return;

  const update = db.prepare('UPDATE assets SET name = ? WHERE character_id = ? AND item_id = ?');
  for (let i = 0; i < ids.length; i += 1000) {
    const chunk = ids.slice(i, i + 1000);
    try {
      const { data } = await esiRequest<Array<{ item_id: number; name: string }>>(
        `/characters/${characterId}/assets/names`,
        { token, method: 'POST', body: chunk },
      );
      db.transaction(() => {
        for (const n of data) {
          if (n.name) update.run(n.name, characterId, n.item_id);
        }
      })();
    } catch {
      // Names are a nicety; leave them null and let the UI show the type name.
    }
  }
}

function upsertLocation(id: number, kind: string, name: string | null, systemId: number | null): void {
  getDb()
    .prepare(
      `INSERT INTO location_names(location_id, kind, name, solar_system_id, resolved_at)
       VALUES(?, ?, ?, ?, ?)
       ON CONFLICT(location_id) DO UPDATE SET
         kind = excluded.kind,
         name = COALESCE(excluded.name, location_names.name),
         solar_system_id = COALESCE(excluded.solar_system_id, location_names.solar_system_id),
         resolved_at = excluded.resolved_at`,
    )
    .run(id, kind, name, systemId, Date.now());
}

function parseExpires(headers: Headers): number | null {
  const exp = headers.get('expires');
  if (!exp) return null;
  const t = Date.parse(exp);
  return Number.isFinite(t) ? t : null;
}

export function allCharacterIds(): number[] {
  return (getDb().prepare('SELECT character_id FROM characters WHERE needs_reauth = 0').all() as Array<{ character_id: number }>).map(
    (r) => r.character_id,
  );
}

export function getRefreshStatuses(): AssetRefreshStatus[] {
  const db = getDb();
  const chars = db.prepare('SELECT character_id, name FROM characters ORDER BY added_at').all() as Array<{
    character_id: number;
    name: string;
  }>;
  return chars.map((c) => statusFor(c.character_id, c.name));
}
