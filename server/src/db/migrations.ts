import type Database from 'better-sqlite3';

// NOTE: migrations are append-only. Never edit a shipped `up` in place — add a new
// numbered object. v1 base schema; v2 filter/paste toggles; v3 add-groups; v4 ship-fit groups;
// v5 per-type volume (m³); v6 asset buckets + per-row bucket selection; v7 singleton item names;
// v8 existing-stock zones (purchase/destination) on filters/pastes/buckets/default_locations;
// v9 nullable list_items.group_id (a list can be "groupless" — a flat, ungrouped item list).
type Migration = { version: number; up: string };

const migrations: Migration[] = [
  {
    version: 1,
    up: `
      CREATE TABLE meta (
        key   TEXT PRIMARY KEY,
        value TEXT
      );

      CREATE TABLE settings (
        key   TEXT PRIMARY KEY,
        value TEXT
      );

      CREATE TABLE lists (
        id         INTEGER PRIMARY KEY,
        name       TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE list_items (
        id       INTEGER PRIMARY KEY,
        list_id  INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
        type_id  INTEGER NOT NULL,
        quantity INTEGER NOT NULL CHECK (quantity > 0),
        position INTEGER NOT NULL,
        UNIQUE (list_id, type_id)
      );
      CREATE INDEX idx_list_items_list ON list_items(list_id, position);

      CREATE TABLE characters (
        character_id          INTEGER PRIMARY KEY,
        name                  TEXT NOT NULL,
        refresh_token         TEXT NOT NULL,
        access_token          TEXT,
        access_token_expires  INTEGER,
        scopes                TEXT,
        added_at              INTEGER NOT NULL,
        needs_reauth          INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE default_locations (
        character_id INTEGER NOT NULL REFERENCES characters(character_id) ON DELETE CASCADE,
        location_id  INTEGER NOT NULL,
        PRIMARY KEY (character_id, location_id)
      );

      CREATE TABLE list_filters (
        list_id      INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
        character_id INTEGER NOT NULL,
        location_id  INTEGER NOT NULL,
        PRIMARY KEY (list_id, character_id, location_id)
      );

      CREATE TABLE sde_types (
        type_id         INTEGER PRIMARY KEY,
        name            TEXT NOT NULL,
        group_id        INTEGER NOT NULL,
        market_group_id INTEGER,
        published       INTEGER NOT NULL
      );
      CREATE INDEX idx_types_name ON sde_types(name COLLATE NOCASE);

      CREATE TABLE sde_groups (
        group_id    INTEGER PRIMARY KEY,
        name        TEXT,
        category_id INTEGER NOT NULL,
        published   INTEGER
      );

      CREATE TABLE sde_categories (
        category_id INTEGER PRIMARY KEY,
        name        TEXT,
        published   INTEGER
      );

      CREATE TABLE price_cache (
        source     TEXT NOT NULL,
        type_id    INTEGER NOT NULL,
        price      REAL,
        fetched_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        PRIMARY KEY (source, type_id)
      );

      CREATE TABLE assets (
        character_id     INTEGER NOT NULL,
        item_id          INTEGER NOT NULL,
        type_id          INTEGER NOT NULL,
        quantity         INTEGER NOT NULL,
        location_id      INTEGER NOT NULL,
        location_type    TEXT,
        location_flag    TEXT,
        is_singleton     INTEGER,
        root_location_id INTEGER,
        included         INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (character_id, item_id)
      );
      CREATE INDEX idx_assets_lookup
        ON assets(character_id, root_location_id, type_id) WHERE included = 1;

      CREATE TABLE asset_refresh (
        character_id INTEGER PRIMARY KEY,
        fetched_at   INTEGER,
        expires_at   INTEGER,
        etag         TEXT,
        last_error   TEXT
      );

      CREATE TABLE location_names (
        location_id     INTEGER PRIMARY KEY,
        kind            TEXT NOT NULL,
        name            TEXT,
        solar_system_id INTEGER,
        resolved_at     INTEGER
      );

      CREATE TABLE esi_cache (
        url        TEXT PRIMARY KEY,
        etag       TEXT,
        expires_at INTEGER,
        body       TEXT
      );
    `,
  },
  {
    // "Existing stock" rework: filter rows gain an on/off toggle, and lists can hold
    // manually pasted stock snapshots (asset_pastes) that deduct alongside API assets.
    version: 2,
    up: `
      ALTER TABLE list_filters ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1;

      CREATE TABLE asset_pastes (
        id         INTEGER PRIMARY KEY,
        list_id    INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
        name       TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        enabled    INTEGER NOT NULL DEFAULT 1
      );
      CREATE INDEX idx_asset_pastes_list ON asset_pastes(list_id);

      CREATE TABLE asset_paste_items (
        paste_id INTEGER NOT NULL REFERENCES asset_pastes(id) ON DELETE CASCADE,
        type_id  INTEGER NOT NULL,
        quantity INTEGER NOT NULL CHECK (quantity > 0),
        PRIMARY KEY (paste_id, type_id)
      );
    `,
  },
  {
    // "Add groups": items on a list are partitioned into named, toggleable groups.
    // The same type can now appear in several groups (one line per group), so the old
    // UNIQUE(list_id, type_id) is replaced by UNIQUE(list_id, group_id, type_id) via a
    // table rebuild. Every existing list gets one default group holding its current items.
    //
    // No inbound FKs reference list_items, so a straight drop+rename rebuild is safe here.
    version: 3,
    up: `
      CREATE TABLE add_groups (
        id       INTEGER PRIMARY KEY,
        list_id  INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
        name     TEXT NOT NULL,
        enabled  INTEGER NOT NULL DEFAULT 1,
        position INTEGER NOT NULL
      );
      CREATE INDEX idx_add_groups_list ON add_groups(list_id, position);

      ALTER TABLE lists ADD COLUMN active_group_id INTEGER;

      -- One default group per existing list.
      INSERT INTO add_groups(list_id, name, enabled, position)
        SELECT id, 'Default group', 1, 0 FROM lists;

      -- Rebuild list_items with a group_id + new uniqueness. Each list has exactly one
      -- group at this point, so the join assigns every item to that list's default group.
      CREATE TABLE list_items_new (
        id       INTEGER PRIMARY KEY,
        list_id  INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
        group_id INTEGER NOT NULL REFERENCES add_groups(id) ON DELETE CASCADE,
        type_id  INTEGER NOT NULL,
        quantity INTEGER NOT NULL CHECK (quantity > 0),
        position INTEGER NOT NULL,
        UNIQUE (list_id, group_id, type_id)
      );
      INSERT INTO list_items_new(id, list_id, group_id, type_id, quantity, position)
        SELECT li.id, li.list_id, g.id, li.type_id, li.quantity, li.position
        FROM list_items li
        JOIN add_groups g ON g.list_id = li.list_id;
      DROP TABLE list_items;
      ALTER TABLE list_items_new RENAME TO list_items;
      CREATE INDEX idx_list_items_list ON list_items(list_id, position);

      -- Point each list at its default group.
      UPDATE lists
        SET active_group_id = (SELECT id FROM add_groups g WHERE g.list_id = lists.id LIMIT 1);
    `,
  },
  {
    // "Ship fits": a second flavour of add-group carrying a parsed pyfa fit. A fit group
    // stores the hull (for its icon), the original paste (so it can be re-edited), and a
    // quantity multiplier applied to every line at rollup time. Its items live in
    // list_items exactly like a manual group's, so fits share the buy-list rollup + Multibuy.
    // `kind` distinguishes the two; existing groups default to 'manual'.
    version: 4,
    up: `
      ALTER TABLE add_groups ADD COLUMN kind TEXT NOT NULL DEFAULT 'manual';
      ALTER TABLE add_groups ADD COLUMN ship_type_id INTEGER;
      ALTER TABLE add_groups ADD COLUMN raw_fit TEXT;
      ALTER TABLE add_groups ADD COLUMN fit_qty INTEGER NOT NULL DEFAULT 1;
    `,
  },
  {
    // Per-type volume (m³) from the SDE, so the UI can show pack sizes/hauling volume
    // alongside ISK. The column starts null; the SDE ingest backfills it (and `startSde`
    // forces a re-ingest of the current build when it finds volumes still unpopulated).
    version: 5,
    up: `
      ALTER TABLE sde_types ADD COLUMN volume REAL;
    `,
  },
  {
    // Per-filter-row bucket selection for the "existing stock" deduction. Every included
    // asset is tagged with the top-level bucket it belongs to at its hangar root:
    //   'hangar'    — loose item sitting directly in the hangar (bucket_id NULL)
    //   'container' — a hangar item that holds other items (bucket_id = the container item_id)
    //   'ship'      — an assembled ship + its fittings/cargo (bucket_id = the ship item_id)
    // list_filter_buckets stores a per (list, character, location) override of which buckets
    // count. Absent rows fall back to the defaults (containers + basic hangar on, ships off),
    // so an untouched list behaves exactly as before. bucket_id is NULL for the single 'hangar'
    // bucket. Columns start null on existing rows; `backfillAssetBuckets()` reclassifies stored
    // assets on startup so buckets populate without waiting for an ESI refresh.
    version: 6,
    up: `
      ALTER TABLE assets ADD COLUMN bucket_kind TEXT;
      ALTER TABLE assets ADD COLUMN bucket_id INTEGER;

      CREATE TABLE list_filter_buckets (
        list_id      INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
        character_id INTEGER NOT NULL,
        location_id  INTEGER NOT NULL,
        bucket_kind  TEXT NOT NULL,
        bucket_id    INTEGER,
        enabled      INTEGER NOT NULL
      );
      CREATE INDEX idx_lfb_lookup ON list_filter_buckets(list_id, character_id, location_id);
    `,
  },
  {
    // Player-assigned item names for singleton assets (renamed ships / containers), resolved
    // via POST /characters/{id}/assets/names during a refresh. Lets the bucket picker show a
    // ship's given name alongside its hull type. Nullable; falls back to the type name.
    version: 7,
    up: `
      ALTER TABLE assets ADD COLUMN name TEXT;
    `,
  },
  {
    // "Existing stock" split into two zones (see shared `StockZone`): 'purchase' (netted out
    // of the Purchase view only) and 'destination' (netted out of Purchase AND the new
    // Transport view). Every existing filter row / paste / default is purchase-location stock,
    // which reproduces the old single-view deduction, so they all backfill to 'purchase'.
    //
    // `list_filters` and `default_locations` take `zone` into their PRIMARY KEY (so the same
    // character+location can appear in both zones) — SQLite can't alter a PK in place, so both
    // are rebuilt (neither has inbound FKs, matching the v3 rebuild pattern). `asset_pastes`
    // and `list_filter_buckets` only need a plain column; the buckets lookup index is widened
    // to include zone.
    version: 8,
    up: `
      CREATE TABLE list_filters_new (
        list_id      INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
        character_id INTEGER NOT NULL,
        location_id  INTEGER NOT NULL,
        zone         TEXT NOT NULL DEFAULT 'purchase',
        enabled      INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY (list_id, character_id, location_id, zone)
      );
      INSERT INTO list_filters_new(list_id, character_id, location_id, zone, enabled)
        SELECT list_id, character_id, location_id, 'purchase', enabled FROM list_filters;
      DROP TABLE list_filters;
      ALTER TABLE list_filters_new RENAME TO list_filters;

      ALTER TABLE list_filter_buckets ADD COLUMN zone TEXT NOT NULL DEFAULT 'purchase';
      DROP INDEX IF EXISTS idx_lfb_lookup;
      CREATE INDEX idx_lfb_lookup ON list_filter_buckets(list_id, character_id, location_id, zone);

      ALTER TABLE asset_pastes ADD COLUMN zone TEXT NOT NULL DEFAULT 'purchase';

      CREATE TABLE default_locations_new (
        character_id INTEGER NOT NULL REFERENCES characters(character_id) ON DELETE CASCADE,
        location_id  INTEGER NOT NULL,
        zone         TEXT NOT NULL DEFAULT 'purchase',
        PRIMARY KEY (character_id, location_id, zone)
      );
      INSERT INTO default_locations_new(character_id, location_id, zone)
        SELECT character_id, location_id, 'purchase' FROM default_locations;
      DROP TABLE default_locations;
      ALTER TABLE default_locations_new RENAME TO default_locations;
    `,
  },
  {
    // "Groupless" lists: a list can now have NO add-groups at all, in which case its items
    // are a single flat, ungrouped list (`list_items.group_id IS NULL`). This makes `group_id`
    // nullable — new lists start groupless, "+ New group" / adding a fit promotes into grouped
    // mode, and deleting the final group returns the list to groupless. A table rebuild drops
    // the NOT NULL; existing rows all carry a real group_id, so they copy across unchanged and
    // existing lists stay grouped. No inbound FKs reference list_items (v3 rebuild pattern).
    //
    // Invariant enforced in code (routes/lists/helpers.ts): a list has either 0 groups (all items
    // ungrouped) OR ≥1 group (no ungrouped items) — never a mix. NULL group_id is excluded from
    // UNIQUE(list_id, group_id, type_id) by SQLite's NULL-distinct rule, so the ungrouped upsert
    // merges by hand (`upsertListItem`) instead of ON CONFLICT.
    version: 9,
    up: `
      CREATE TABLE list_items_new (
        id       INTEGER PRIMARY KEY,
        list_id  INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
        group_id INTEGER REFERENCES add_groups(id) ON DELETE CASCADE,
        type_id  INTEGER NOT NULL,
        quantity INTEGER NOT NULL CHECK (quantity > 0),
        position INTEGER NOT NULL,
        UNIQUE (list_id, group_id, type_id)
      );
      INSERT INTO list_items_new(id, list_id, group_id, type_id, quantity, position)
        SELECT id, list_id, group_id, type_id, quantity, position FROM list_items;
      DROP TABLE list_items;
      ALTER TABLE list_items_new RENAME TO list_items;
      CREATE INDEX idx_list_items_list ON list_items(list_id, position);
    `,
  },
];

export function runMigrations(db: Database.Database): void {
  const current = db.pragma('user_version', { simple: true }) as number;
  const pending = migrations.filter((m) => m.version > current).sort((a, b) => a.version - b.version);
  for (const m of pending) {
    const tx = db.transaction(() => {
      db.exec(m.up);
      db.pragma(`user_version = ${m.version}`);
    });
    tx();
  }
}
