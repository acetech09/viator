# Viator — EVE Online shopping-list manager

Single-user, locally-hosted web app. Build EVE shopping lists, price them against the
market, copy them into the in-game Multibuy window, and subtract items you already own
(via authorized characters' assets).

## Stack & layout

Node 22 + TypeScript, npm-workspaces monorepo. **SQLite** (better-sqlite3) for storage,
**Fastify** server, **React + Vite** client. One SQLite file at `data/viator.db`.

```
shared/   pure DTOs, ISK formatting, paste parser — the only unit-tested layer   → shared/CLAUDE.md
server/   Fastify API, SQLite, ESI client, SSO, SDE updater, asset/price pipelines → server/CLAUDE.md
client/   React + Vite UI                                                          → client/CLAUDE.md
```

Read the workspace's own `CLAUDE.md` before editing it — each documents its files and gotchas.

## Commands

| Task | Command |
| --- | --- |
| Dev (server :8642 + Vite :5173, both hot-reload) | `npm run dev` |
| Build everything | `npm run build` |
| Prod (single process, UI+API on :8642) | `npm start` — **requires `NODE_ENV=production`** or it won't serve the built UI |
| Tests (shared + server, vitest) | `npm test` |
| Typecheck all | `npm run typecheck` |
| Double-click launcher (build-if-needed → prod → browser) | `start-viator.bat` |
| Double-click launcher (always rebuild → prod → browser; use after code changes) | `rebuild-viator.bat` |

`npm run dev` proxies `/api` and `/sso` from Vite → :8642. The SSO callback is always
`http://localhost:8642/sso/callback` in both dev and prod.

## Cross-cutting conventions (easy to get wrong)

- **Module resolution differs by workspace.** `server/` and `shared/` are ESM compiled by
  `tsc` and run under Node, so their relative imports MUST end in `.js` (e.g. `./db/db.js`).
  `client/` is bundled by Vite — use **extensionless** imports there. `@viator/shared` is
  imported by name everywhere.
- **`shared` must be built before server/client can import it.** `npm run dev`'s `predev`
  builds it once, then `dev:shared` keeps `shared/dist` fresh in watch mode. If a
  server/client build fails with "cannot find @viator/shared", run `npm -w shared run build`.
- **ESI is unversioned** — every request pins `X-Compatibility-Date` (`config.ts`
  `COMPATIBILITY_DATE`). Bump that constant deliberately after testing new behavior; omitting
  it selects the *oldest* API behavior.
- Refresh tokens are stored **plaintext** in the DB (acceptable for single-user localhost).
- "Existing stock" deduction is a **non-destructive view**: displayed qty = stored qty −
  owned. The stored list is never mutated. Owned qty sums two toggleable sources per list —
  API asset filter rows and manual asset pastes (see `server/src/assets/owned.ts`).
- **Existing stock is split into two zones** (`StockZone` in `shared/src/types.ts`):
  `'purchase'` (stock at the buy hub) and `'destination'` (stock already at the endpoint).
  This drives the left panel's three views: **Edit** (no deduction), **Purchase** (nets out
  purchase **+** destination stock), **Transport** (nets out **destination only** — hub-owned
  goods still need hauling). Each of `list_filters`, `list_filter_buckets`, `asset_pastes`, and
  `default_locations` carries a `zone`; `getOwnedForList(listId, zone)` sums one zone, and
  `buildPricedList` returns both `owned_purchase`/`owned_destination` per rollup line so the
  client derives each view. Per-view totals are computed client-side (they differ by view).

## Where things live (breadcrumbs)

| To work on… | Start here |
| --- | --- |
| DB schema / a new table | `server/src/db/migrations.ts` (append-only numbered migrations, `PRAGMA user_version`) |
| Add-groups (named item buckets, active group, per-group view) — incl. the **groupless** flat-list state (0 groups) and promotion/demotion between them | `server/src/routes/lists/groups.ts` (group CRUD + `active-group`) + `lists/helpers.ts` (`resolveTargetGroup`/`upsertListItem`/`ensureManualHomeForUngrouped`/`fixActiveGroup`), `server/src/lists/priced.ts` (rollup incl. ungrouped items + groups); UI in `client/src/components/GroupManager.tsx` (+ `AddTab.tsx`) + `list-table/` (`FlatEditView` when groupless, else Rollup/Grouped toggle) |
| Ship fits (pyfa paste → a `kind='fit'` add-group with a hull + qty multiplier) | `shared/src/fitParser.ts` (`parseFit`), `server/src/routes/lists/groups.ts` (`/fits` POST/PUT + `resolveFit`), `priced.ts` (fit_qty multiplier); UI in `client/src/components/AddFitsTab.tsx` |
| ESI calls, rate limiting, caching | `server/src/esi/client.ts` |
| SSO login / character auth | `server/src/esi/sso.ts`, `server/src/esi/tokens.ts`, `server/src/routes/sso.ts` |
| Static data download/ingest | `server/src/sde/updater.ts` (+ `zipRange.ts`) |
| Owned-asset logic / stock deduction (purchase vs destination zones) | `server/src/assets/pipeline.ts` (`classifyAssets` — buckets each asset as hangar/container/ship), `assets/owned.ts` (`getOwnedForList(listId, zone)`, honors per-row `list_filter_buckets`); UI in `client/src/components/existing-stock/` (two zone sections) + `AssetBucketModal.tsx` (per-row container/ship picker) |
| The three list views (Edit / Purchase / Transport) + per-view deduction | `client/src/components/list-table/` (`shared.tsx`: `DeductView`, `ownedInView`) |
| Pricing | `server/src/prices/{refresh,service,hub}.ts` |
| The priced list shape (rollup + per-group) | `server/src/lists/priced.ts` |
| ISK formatting / Multibuy / paste parsing | `shared/src/{format,pasteParser}.ts` |
| UI state, routing, SDE splash gate | `client/src/App.tsx`, `client/src/api.ts` |
| Item fuzzy search | `client/src/hooks/useTypesIndex.ts` |

## Feature status

All core features are built and verified: lists CRUD/duplicate, fuzzy add + bulk paste
import (all-or-nothing), **add-groups** (named toggleable item buckets — adds/pastes land in
the active group; a type can repeat across groups; left panel toggles between a rolled-up
Multibuy view and a per-group edit view). A list can also be **groupless**: new lists start
with no groups at all — a single flat, ungrouped item list (`FlatEditView`, no headers/multiplier).
Creating the first group (or adding a fit) promotes it to grouped mode by adding a single starter
"Default group" that wraps any existing items; deleting the last manual group returns it to
groupless with items kept as ungrouped. **ship fits** (paste a pyfa/EFT fit → a `kind='fit'`
add-group carrying the hull + modules and a per-fit quantity multiplier; contributes to the
same rollup/Multibuy as manual groups; edited by re-pasting), ISK pricing (ESI estimate default; hub
sell/buy/split), Multibuy copy (whole-list + per-group), non-destructive "existing stock"
deduction split into **purchase-location** and **destination** zones (each with its own API
asset filters + manual asset pastes, each toggleable; per-filter-row bucket picker to
include/exclude individual containers and fitted ships — containers + basic hangar on, ships
off by default) — driving three left-panel views (**Edit** / **Purchase** = purchase+destination
netted / **Transport** = destination netted only), a **hauling check** (right-panel tab: paste
the hauler's cargo → a closable "Missing items" left-panel tab diffs it against the Transport
view, falling back to Purchase, then the raw list — all client-side), SSO character auth,
per-zone default filter locations.

The only path not verified against live servers is a real character login + asset fetch
(needs the user's own EVE developer app). Everything around it is covered: SSO URL/token
logic, and `classifyAssets` + deduction are unit-tested / synthetic-data-tested.
