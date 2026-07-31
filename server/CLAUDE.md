# server — Fastify API + pipelines

ESM (`type: module`); relative imports end in `.js`. Dev via `tsx watch`, prod via
compiled `dist/`. Entry: `src/index.ts` (opens+migrates DB, registers routes, kicks off
`startSde()` in the background, serves `client/dist` only when `NODE_ENV=production`).

## Config — `src/config.ts`

All constants: ports (8642), `COMPATIBILITY_DATE` (pinned ESI date — bump deliberately),
ESI/SSO/SDE/image URLs, `SSO_SCOPES`, `SSO_REDIRECT`, default hub (Jita 4-4 / The Forge).

## Database — `src/db/`

- `db.ts` — thin better-sqlite3 wrapper (WAL, FK on). Isolated so `node:sqlite` could swap
  in if the native module ever fails to build.
- `migrations.ts` — numbered migrations gated by `PRAGMA user_version` (v1 base schema; v2
  added `list_filters.enabled` + `asset_pastes`/`asset_paste_items`; v3 added `add_groups`,
  rebuilt `list_items` with `group_id` + `UNIQUE(list_id,group_id,type_id)`, and added
  `lists.active_group_id`; v4 added `add_groups.kind`/`ship_type_id`/`raw_fit`/`fit_qty` for
  ship fits; v5 added `sde_types.volume` (m³, nullable — the SDE ingest backfills it, and
  `startSde` forces a re-ingest of the current build while it's still all-null); v6 added
  `assets.bucket_kind`/`bucket_id` (top-level container/ship each asset belongs to) +
  `list_filter_buckets` (per-row bucket selection — `backfillAssetBuckets()` in `index.ts`
  startup reclassifies stored rows so buckets populate without an ESI refresh); v7 added
  `assets.name` (player-assigned singleton item names, resolved on refresh); v8 added a
  `zone` ('purchase'|'destination') column to `list_filters`, `list_filter_buckets`,
  `asset_pastes`, and `default_locations` — the first and last take it into their PRIMARY KEY
  (table rebuild), existing rows backfill to 'purchase'. Add a new numbered migration object to
  evolve; never edit a shipped one in place.
- Key tables: `lists` (+ `active_group_id`), `add_groups` (named toggleable buckets per
  list, `enabled`+`position`; `kind` 'manual'|'fit' — fit rows also carry `ship_type_id`,
  `raw_fit`, `fit_qty` multiplier), `list_items` (now `UNIQUE(list_id,group_id,type_id)`, qty>0
  — a type can repeat across groups, merges within one), `list_filters` (persisted per list,
  `enabled` toggle + `zone`), `asset_pastes`/`asset_paste_items` (manual stock snapshots per
  list, `enabled` toggle + `zone`), `list_filter_buckets` (per (list,character,location,zone)
  override of which container/ship/basic-hangar buckets deduct), `default_locations`
  (per-`zone` seed locations), `characters` (tokens + `needs_reauth`),
  `sde_types/groups/categories`, `price_cache(source,type_id)`, `assets` (with computed
  `root_location_id`+`included`+`bucket_kind`/`bucket_id`), `location_names`, `esi_cache`,
  `settings`, `meta`.
- `src/settings.ts` — `getSettings()`/`updateSettings()`. Defaults live here (price_source
  defaults to `esi_average`).

## Routes — `src/routes/` (all registered in `index.ts`)

| File | Endpoints |
| --- | --- |
| `lists/` (package, registered via `lists/index.ts`) | All `/api/lists` routes, split by domain below. Shared db helpers + the groupless/grouped invariants live in `lists/helpers.ts`: `intParam`/`listExists` (route boilerplate), `touchList`, position helpers, `resolveTargetGroup`, `upsertListItem`, `ensureManualHomeForUngrouped`, `fixActiveGroup`, `seedDefaultFilters`. |
| `lists/crud.ts` | lists CRUD — `GET /api/lists` returns **overview cards** (`ListOverview[]` via `lists/overview.ts`, after a best-effort `ensurePricesForOverview()` warm-up); duplicate (copies groups incl. fit metadata); item add — upsert into the active `kind='manual'` group, or **ungrouped** (`group_id` NULL) when the list is groupless; `/groups/:gid/items/:typeId` set-qty/delete (**`gid=0` = the ungrouped sentinel**); `/import` (paste into a group, all-or-nothing via `resolveLines`); `/priced` (rollup + per-group breakdown). |
| `lists/groups.ts` | `/groups` POST + `:gid` PUT(rename/toggle/set `fit_qty` multiplier)/DELETE; `/active-group` PUT; `/fits` POST(create from pyfa paste, `resolveFit`) + `:gid` PUT(re-paste and/or set `fit_qty`) — fit delete/toggle reuse the `/groups` routes. **Groupless lists**: a list can have **0 groups** — its items are a flat, ungrouped list. New lists start groupless; `/groups` POST on a groupless list *promotes* it by adding a single starter "Default group" that wraps any existing items (regardless of whether the list had items), and adding a fit promotes it too (`ensureManualHomeForUngrouped`); deleting the **last manual group** returns the list to groupless and **keeps** its items as ungrouped (a last *fit* group deletes normally). Invariant (code, not schema): a list has either 0 groups (all items ungrouped) OR ≥1 group (no ungrouped items) — `resolveTargetGroup` (creates a Default home if a grouped list somehow lacks a manual group) + `fixActiveGroup` (points/clears `active_group_id`) + `upsertListItem` (merges ungrouped rows by hand, since NULL escapes the UNIQUE index) uphold it. |
| `lists/stock.ts` | Existing-stock sources, all zone-scoped: `/filters` GET/PUT (both take `?zone=purchase\|destination`, default purchase — PUT replaces only that zone's rows); `/filters/buckets` GET(enumerate containers+ships at a character+location+`zone`, with saved/default enablement)/PUT(save a row's bucket selection incl. `zone`); `/asset-pastes` GET/POST (`?zone=`) + `:pasteId` PUT(toggle)/DELETE. |
| `settings.ts` | `/api/settings` GET/PUT |
| `sso.ts` | `/api/characters` list/delete; `/sso/login`, `/sso/callback` (PKCE) |
| `assets.ts` | `/api/assets/refresh` + `/status`; `/api/characters/:id/locations`; `/api/default-locations` CRUD (rows carry `zone`; DELETE is `/:characterId/:locationId/:zone`) |
| `sde.ts` | `/api/sde/status`; `/api/sde/types-index` (ETagged by build) |

## ESI — `src/esi/`

- `client.ts` — **all ESI traffic goes through one queue** (concurrency 4). `esiRequest()`
  and `esiGetAllPages()` (X-Pages). Sends compat-date + User-Agent (app + contact email).
  DB-backed cache (`esi_cache`) honoring `Expires` + `If-None-Match`/304. Honors **both**
  rate-limit systems: legacy error-limit (→ pause; 420 hard-pause) and per-route-group
  `X-Ratelimit-*` + `Retry-After` on 429.
- `sso.ts` — PKCE S256 helpers, `exchangeCode`/`refreshAccessToken`, `verifyToken` (jose
  against `login.eveonline.com/oauth/jwks`; `sub` = `CHARACTER:EVE:<id>`).
- `tokens.ts` — `getAccessToken(characterId)`: proactive refresh (<60s to expiry),
  `invalid_grant` → sets `needs_reauth`.

## SDE — `src/sde/`

The per-collection files are **403 (not downloadable)**; only the ~98 MB zip exists.
- `zipRange.ts` — reads the zip's central directory via HTTP range requests and pulls just
  `types.jsonl` + `groups.jsonl` + `categories.jsonl` (~23 MB). Assumes non-zip64.
- `updater.ts` — `startSde()` compares `latest.jsonl` buildNumber vs `meta`, ranged-fetches
  and ingests (full-download fallback in `fetchNeededViaFullDownload`). `getSdeStatus()`
  drives the client splash. `getShipTypeIds()` = category 6, cached, for asset classification.
  JSONL record shape: `{_key, name:{en}, groupID, marketGroupID?, published, volume?}` (volume
  in m³, stored on `sde_types.volume` — the **assembled** hull volume for ships).
- `packagedVolumes.ts` — ships are hauled **packaged**, a fixed volume per ship group (Frigate
  2,500 m³, Battleship 50,000 m³, …), not the assembled `volume`. `packagedVolumeFor(typeId,
  groupId)` returns that (per-type override → per-group map, else `null` to fall back to the SDE
  assembled volume). The map was derived from ESI `packaged_volume` over all category-6 types;
  `priced.ts` applies it so volume figures reflect what you actually buy/haul.

## Assets — `src/assets/`

- `pipeline.ts` — `classifyAssets(assets, shipTypes)` is **pure and unit-tested**
  (`pipeline.test.ts`) — this is the tricky logic. An item is `included` (eligible) iff its
  top-level ancestor sits directly in a station/structure hangar: the item **`Hangar`** (loose
  items, containers), or — for an assembled ship — the `Hangar`/`ShipHangar` bay. Each asset is
  also tagged with the **top-level bucket** it counts under: `'hangar'` (loose item, `bucket_id`
  NULL), `'container'` (a Hangar item that holds things, `bucket_id`=its item_id), or `'ship'`
  (an assembled ship + its fittings/cargo, `bucket_id`=the hull item_id). Whether a bucket
  actually deducts is decided at query time by `getOwnedForList` (default: containers +
  basic-hangar on, ships **off**) — so with no per-row overrides the deduction matches the old
  hangar-only behavior. `backfillAssetBuckets()` reclassifies stored rows once at startup (v6).
  `resolveAssetNames()` fetches player-given names for singleton container/ship bucket items via
  `POST /assets/names` (best-effort; un-renamed items come back as the type name and are ignored)
  so the picker can show a ship's given name.
  `refreshCharacterAssets()` handles pagination, cooldown (gated purely on the ESI `Expires`
  header — assets are cached ~1h server-side, so earlier pulls just re-return the same
  snapshot), wholesale row replace, and location-name resolution (stations public, structures
  authed → `Structure <id>` on 403).
- `owned.ts` — `getOwnedForList(listId, zone)`: sums owned qty per type_id **for one zone**
  from two sources — `included` assets across that zone's **enabled** filter rows (respecting
  each row's `list_filter_buckets` selection via a left join keyed on `zone` too; a bucket
  counts when `COALESCE(saved.enabled, ship→0 else 1)`), plus items from that zone's **enabled**
  `asset_pastes`. Disabled rows/pastes are skipped. `buildPricedList` calls it once per zone;
  the Purchase view nets out both, the Transport view nets out 'destination' only.

## Prices — `src/prices/`

- `refresh.ts` — `ensurePricesForList()` (called by `/priced`): `esi_average` = one bulk
  `/markets/prices` call serves all lists; hub sources delegate to `hub.ts`. Missing types
  cached as null so they aren't refetched every render. `ensurePricesForOverview()` (called by
  `GET /api/lists`): same bulk esi_average warm-up over **all** lists' items, but best-effort
  (never throws; hub sources skipped — the overview prices from cache only).
- `service.ts` — `getCachedPrices(source, typeIds)` reads fresh cache rows.
- `hub.ts` — `refreshHubPrices()`: per-type `/markets/{region}/orders` filtered to the hub
  station; min-sell / max-buy / split; 15-min cache floor.

## Composed view — `src/lists/`

- `priced.ts` — `buildPricedList(listId)`: two shapes in one pass. `items` = the **rollup**
  (quantities aggregated across **enabled** groups per type), each line carrying
  `owned_purchase` + `owned_destination` (from `getOwnedForList` per zone) plus `unit_price`/
  `unit_volume` — the client derives each view's deducted qty/extended/total (Purchase nets both
  zones, Transport nets destination only), since per-view totals differ. `groups[]` = per-group
  priced lines + subtotals (raw stored qty, **no** owned deduction), including disabled groups so
  the client can grey them. Owned/stock deduction is a rollup-only concept. Every group has a
  `fit_qty` **multiplier** (fits *and* manual groups; default 1) that scales every line in both
  shapes; each `PricedGroupItem` carries both `stored_quantity` (raw, as typed) and `quantity`
  (`= stored_quantity * fit_qty`, the "expanded" qty used for pricing/rollup). The DTO carries
  `kind`/`ship_type_id`/`fit_qty`/`raw_fit` through for the UI. Each line/group/list also carries
  **volume** (`unit_volume`/`extended_volume`, `subtotal_volume`, `total_volume`) computed from
  `sde_types.volume` in the same pass, mirroring the ISK fields (extended/total volumes follow the
  owned-deducted `displayed` qty exactly like extended price). Unit volume is the **packaged**
  volume for ships (`packagedVolumeFor` in `sde/packagedVolumes.ts`), else the SDE assembled volume.
  `resolveFit` (in `routes/lists/groups.ts`) parses+resolves a fit paste all-or-nothing before it
  reaches here.
- `overview.ts` — `buildListOverviews()`: the lists-index cards (`ListOverview[]`). Per list,
  the same rollup rules as `buildPricedList` (ungrouped + enabled groups, fit_qty-expanded, no
  owned deduction) reduced to `total`/`total_volume`/`has_unpriced` plus `top_items` (rollup
  lines by extended value desc) and `top_fits` (fit groups by subtotal desc), both capped at 6.
  Reads **cached** prices only (unpriced lines add 0 and sort last); volume uses the same
  packaged-ship rule.
- `resolveNames.ts` — `resolveNames()`: exact case-insensitive name → type_id, preferring
  published market types on collisions. `resolveLines()`: the shared all-or-nothing contract on
  top of it (every parsed line must resolve or the batch is rejected with the unmatched raw
  lines; duplicates merge) — used by bulk import, asset pastes, and fit creation.

## Tests

`src/**/*.test.ts` (vitest, `vitest.config.ts`), excluded from build. Currently
`assets/pipeline.test.ts`. When touching `classifyAssets`, add cases there.
