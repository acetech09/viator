# client — React + Vite UI

Bundled by Vite — **imports are extensionless** (`./api`, not `./api.js`). `@viator/shared`
imported by name. Dark theme in `src/theme.css` (CSS variables, no framework).

## State & structure

- **React Query is the only state layer** — no Redux/Zustand/global store. Mutations
  invalidate query keys. Keys in use: `lists`, `list-detail/:id`, `priced/:id`,
  `types-index`, `characters`, `settings`, `sde-status`, `asset-status`, `locations/:id`,
  `filters/:id/:zone`, `filter-buckets/:listId/:charId/:locId/:zone`, `asset-pastes/:id/:zone`,
  `default-locations`. (`zone` is `'purchase'|'destination'` — existing-stock is split per zone.)
- `main.tsx` — providers (QueryClient, Router, `ToastProvider`).
- `App.tsx` — **gates the whole app on `sde-status`** (splash until `ready`), then TitleBar +
  routes wrapped in `ErrorBoundary`. Routes: `/lists`, `/lists/:id`, `/settings`.
- `api.ts` — the single typed fetch layer. All endpoints live here; add new ones here.
- `toast.tsx` — `useToast()` for transient notifications.
- `hooks/useInvalidateList.ts` — `useInvalidateList(listId)` returns the standard
  post-mutation invalidation (`priced` + `list-detail` + `lists`). Use it as the `onSuccess`
  of any mutation that touches a list's items/groups/fits instead of hand-rolling the trio.

## Pages — `src/pages/`

- `ListsPage.tsx` — centered, max-width **card list** (`.lists-page` / `.list-cards`) fed by
  `ListOverview[]` from `GET /api/lists` (totals + value-sorted previews). Top of page: a wide
  centered **+ New list** button (`.new-list-btn`), then a toolbar with a name-search box and a
  Newest/Oldest-first sort toggle (both client-side). Each `.list-card-row` = the clickable card
  (whole card opens the list) + floating duplicate/delete buttons off to its right
  (`.list-card-actions`, `stopPropagation`). Card head: a **header bar** (`.list-card-head`,
  own `--bg-elev2` background + bottom border; the card clips it via `overflow: hidden`) holding
  the click-to-edit title (`EditableText` → `renameList`, `stopPropagation`s so editing doesn't
  navigate), muted last-edited date, then three fixed-width right-aligned stats
  (`.list-card-stat`, 12ch): item count, ISK, m³ — the latter two with wallet/cargo icons via
  `IskAmount`/`VolAmount` (em-dash when empty). Card body: two dividerless preview columns
  (`PreviewColumn` — top items | top
  fits; icon · name · × qty, server-capped at 6, `.faded` bottom mask when > 4 lines).
- `ListDetailPage.tsx` — click-to-edit `<h1>` title (`EditableText` → `renameList`, invalidates
  `list-detail` + `lists`). Two-column layout: `ListTable` (left) + right panel with four
  subtabs: **Add items** (`AddTab`), **Add fits** (`AddFitsTab`), **Existing stock**
  (`ExistingStockTab`), **Hauling check** (`HaulingCheckTab`). Owns the hauling-check state
  (`haulingText` + `haulingCheck: HaulingCheck | null`, reset on `listId` change since the route
  component stays mounted across list navigations) and passes the result into `ListTable`
  (which renders it as the spawnable **Missing items** tab) — text/result live here so they
  survive right-panel subtab switches.
- `SettingsPage.tsx` — EVE app + contact email, character management (`/sso/login`), price
  source + hub, and `DefaultLocationsSection`. The Client ID input is an **optional override**
  inside a collapsed `<details>` — the server bundles an application, so when
  `client_id_is_default` is set the field renders blank (never echoing the bundled id) and
  saving it empty clears the override.

## Components — `src/components/` (behaviors that are easy to break)

- `list-table/` — the left "final list" panel, one file per surface: `ListTable.tsx` (container:
  tabs + a top-right Multibuy-copy button (`.copy-multibuy`, `CopyIcon`) in the tab strip, filter
  box, bottom total bar, collapse state), `FlatEditView.tsx`, `RollupView.tsx`,
  `GroupedView.tsx` (+ its per-group `GroupBlock`), `MissingView.tsx` (the hauling-check result),
  and `shared.tsx` (`DeductView`/`ownedInView`,
  `useItemMutations` — set-qty/remove for one group's lines — and the table building blocks
  `ItemTableHead`/`ItemNameCell`/`PriceVolCells`; **every item table renders through these** so
  the column set stays in lockstep).

  `ListTable` is tabbed (`.subtabs` / `.list-view-tabs`). **Groupless lists**
  (`priced.groups.length === 0` — a flat, ungrouped item list): the Edit view renders
  `FlatEditView` (one headerless table straight off the rollup `items[]` — editable `QtyCell` + ✕
  remove via the `groupId = 0` ungrouped sentinel, no group headers/multiplier), the Combined|Grouped
  segmented control is hidden and deducted views always render the flat `RollupView`, and the Edit
  bottom-bar total falls back to the raw `items[]` when there are no enabled groups. Everything below
  applies once the list has groups. **Edit view**
  always shows; **Purchase view** and **Transport view** are **conditional** — Purchase appears once
  the **purchase** zone has a stock *source* added (a complete filter row or a manual paste),
  Transport once the **destination** zone does (`hasPurchaseStock`/`hasDestinationStock`, derived
  from the zone-scoped `['filters', id, zone]` / `['asset-pastes', id, zone]` queries — presence of
  a source, NOT whether it nets anything out). A list with no sources shows Edit alone. An effect
  (gated on those queries having loaded) keeps `topTab` valid as sources appear/disappear and
  defaults to Purchase → Transport → Edit. `editable = topTab === 'edit'`; the two deducted tabs share
  rendering via a `DeductView` ('purchase'|'transport') and `ownedInView(item, view)` — Purchase
  nets out `owned_purchase + owned_destination`, Transport nets out `owned_destination` only
  (hub-owned goods still need hauling). Deducted quantities/extended/totals are computed
  client-side from the rollup's raw `quantity`/`owned_*`/`unit_*` (the server no longer sends a
  single deducted qty or a total). A frozen fuzzy filter box sits under the tabs across all three.
  - **Edit view** (`GroupedView`, `editable=true`) — the building surface; per-group editing, no
    stock deduction, no striking, no sub-options. Manual items get in-row `QtyCell` edit + ✕
    (`useItemMutations`, editing the **stored** qty); fit *lines* stay read-only
    (re-paste to change modules in the Add fits tab). Bottom bar shows the raw aggregate of enabled
    groups ("List total"), not the rollup.
  - **Purchase view** — the buy list with existing stock applied. A boxed **Combined | Grouped**
    segmented control (`.segmented`, `purchaseLayout` state) plus a **Show/hide owned items** eye
    button (`.owned-toggle`, `showOwned` state — hides rows fully covered by stock; a group with
    nothing left to buy is dropped entirely). Bottom bar reads "Estimated total".
    - **Combined** (`RollupView`) — enabled groups summed per type, owned-deducted; covered rows
      (displayed ≤ 0) greyed/struck (or hidden when owned are hidden), excluded from total; the
      top-right Copy uses `toMultibuy` on the **displayed** quantities. No groups → no collapse here.
    - **Grouped** (`GroupedView`, `editable=false`) — read-only per-group tables. Owned stock is a
      rollup-level total, so `GroupedView` **allocates** each type's owned qty across enabled groups
      **top-to-bottom by position** (`displayedByLine`, keyed `groupId:typeId`); covered lines
      struck, header subtotal + per-group Copy follow the deducted quantities.

  **Collapse:** in every grouped surface (Edit + Purchase/Grouped) the **whole group/fit header**
  (`.group-head`, cursor + hover highlight; a larger `.group-caret` indicates state) is the
  collapse/expand click target — the interactive controls inside it (eye toggle, `× QtyInput`,
  Copy) `stopPropagation` so they don't also toggle. Collapsing hides the table, header stays.
  Collapsed ids are **persisted per list in `localStorage`**
  (`viator:collapsed:<listId>`, `collapsed` Set state, re-read on `listId` change) and **shared
  across both tabs**.

  **Group quantity multiplier:** every group (manual and fit) carries `fit_qty`. In the Edit view
  the header shows a `QtyInput` (`×`) that commits `updateGroup { fit_qty }` for either kind; in
  Purchase it renders as muted `×N`. When `fit_qty > 1` the item table gains a read-only
  **Expanded** column (`= stored_qty × fit_qty`) to the right of Qty — Qty stays the raw/editable
  value, Expanded is derived. All pricing, striking, Copy, and subtotals run off the expanded
  `quantity`; only the Qty cell and its edit use `stored_quantity`.

  - **Missing items tab** (`MissingView`) — spawns (and focuses, via a `token` bumped per Check
    press) when the right panel's Hauling check runs; closable via a `.tab-close` ✕ on the tab
    itself (`stopPropagation`, calls `onClearHaulingCheck`). Diffs the pasted hauler cargo against
    a **baseline view** — Transport if destination stock exists, else Purchase, else the raw
    list — matching pasted names to rollup lines case-insensitively: rows are
    `missing = needed − loaded` (> 0 only), Qty = the missing quantity, partially loaded lines
    get an "(x of y loaded)" note (`ItemNameCell`'s free-form `note` prop), pasted lines matching
    no list item are listed below as "In the paste but not on this list". Bottom bar reads
    "Missing total"; the top-right Copy exports the missing quantities. Not a deduct view — the
    Combined/Grouped control and owned-eye are hidden (`deducting` covers Purchase/Transport only).

  Every group header has an **eye** visibility button (`EyeIcon`; on = counted in the rollup,
  slashed = hidden) — distinct from the Purchase view's owned-items eye. Filter + total bar persist
  across all surfaces.
- `QtyCell.tsx` — the Edit-mode list-line qty field: an **always-visible text input** (so it
  reads as editable), selects-all on focus, Enter/blur commits a positive int, Escape restores,
  invalid shakes. Re-syncs its draft from `value` (adjust-state-during-render, like `QtyInput`).
- `QtyInput.tsx` — the shared group/fit **quantity multiplier** field (used by `ListTable`,
  `AddTab`, and `AddFitsTab`). Commits a positive int on Enter/blur. **Re-syncs its draft from
  the `value` prop** (adjust-state-during-render) so the two inputs bound to the same `fit_qty`
  (list header + sidebar list) stay in lockstep after either one commits — don't reintroduce a
  mount-once `useState(value)` copy here.
- `AddTab.tsx` — the spreadsheet-style entry loop: qty field → Tab/Enter → search field →
  Enter commits `addItem` then clears search and **refocuses qty**. Also hosts the paste
  textarea (all-or-nothing import, per-line errors). Both the single-add and the paste route
  into the **active group**. Renders `GroupManager` on top; when the list is **groupless** the
  "Adding to …" line is hidden entirely.
- `GroupManager.tsx` — the enumerated manual add-group list (rendered by `AddTab`): each row has
  a large right-facing **arrow** that selects the active group (active row gets a faint accent
  highlight, `.group-row.active`), an **eye** visibility button (`EyeIcon`; slashed = hidden
  from the list), an inline **× quantity** (`QtyInput` → `updateGroup fit_qty`, the group
  multiplier), inline rename (double-click or ✎), delete (confirm), and **+ New group**.
  Group data + `active_group_id` come from the shared `priced` query, so mutations invalidate
  via `useInvalidateList`. Filtered to `kind==='manual'` groups (fits live in
  their own tab). The "Groups" header renders only when groups exist; when the list is
  **groupless** (no groups at all) the manager shows just **+ New group** (which server-side
  promotes the list to grouped mode); the
  delete-confirm reveals that deleting the **last** group keeps its items as
  an ungrouped list rather than deleting them (`totalGroups === 1`).
- `AddFitsTab.tsx` — the "Add fits" subtab. A `FitManager` table of fits (each a `kind='fit'`
  group from the `priced` query): ship icon (`images.evetech.net/types/:shipTypeId/icon`), fit
  name, an inline per-fit **quantity** (`QtyInput` → `updateFit fit_qty`), an **eye** toggle
  (`updateGroup enabled`), **Edit**, and delete (`deleteGroup`, confirm). Below is `FitPasteBox`
  — a monospace textarea that `createFit`s on save (all-or-nothing, unmatched-line + `not_a_fit`
  errors). **Edit** loads a fit's `raw_fit` into the box; saving then `updateFit`s that fit
  (overwrites its items/name/hull). No "active" fit — a fresh paste always makes a new fit.
- `HaulingCheckTab.tsx` — the "Hauling check" subtab: a textarea (controlled by
  `ListDetailPage`'s `haulingText`) + a **Check** button. Check runs `parsePaste` client-side
  (no server round-trip, no name validation — unmatched names surface in the Missing view),
  dedupes lines case-insensitively (stacks sum), and hands `LoadedLine[]` up via `onCheck`;
  an empty parse just toasts. Types (`LoadedLine`/`HaulingCheck`) live in
  `list-table/MissingView.tsx`.
- `SuggestModal.tsx` — presentational suggestion list; uses `onMouseDown` (not click) so the
  field's blur doesn't fire first.
- `existing-stock/` (the "Existing stock" subtab, one file per section) —
  `ExistingStockTab.tsx`: **two zone sections** (`StockSection`),
  each headed with a hover tooltip (`.info-tip`): **"Existing Stock at Purchase Location"**
  (excluded from the Purchase view) and **"Existing Stock at Destination"** (excluded from
  Purchase **and** Transport). Each section renders a zone-scoped `ApiAssetSection` and, below it, a
  zone-scoped `AssetPasteSection`; `StockSection` owns the paste-box open state (`pasteOpen`).
  **`ApiAssetSection.tsx`**: character + location filter rows (`FuzzySelect`s), each with an enable
  `Toggle`; the header cell holds a **"Toggle all"** text button (not a switch — per-row toggles
  already show state). The `.filter-grid` (incl. its Character/Location headers) renders **only when
  ≥1 row exists** — an empty table showed bare left-stacked labels. Under the grid an action `row`
  holds **"Add API Assets Filter"** (`addRow`, hidden when no character is authorized) and **"Add
  manual paste filter"** (calls the parent's `onAddManualPaste` → opens the paste box). Seeds from
  that zone's default locations once when the global toggle is on; persists via `PUT /filters?zone=`.
  Each complete row has a bucket button opening `AssetBucketModal` (with the row's `zone`) to pick
  which containers/ships deduct — **"Add filter"** by default, **"Edit filter"** in yellow when a
  non-default selection is saved (the modal patches `has_bucket_filter` into the
  `['filters', listId, zone]` cache on save so it updates without a refetch). **`AssetPasteSection.tsx`**
  (props `open`/`onClose`): manual stock snapshots — the saved pastes always list (toggle/remove);
  the entry box (textarea + **Save paste** / **✕** cancel, all-or-nothing, same contract as AddTab's
  import, `POST`s to `/asset-pastes?zone=`) shows only when `open`, and closes on save or cancel.
  Only the API filter button is gated on having an authorized character; the manual-paste action
  always shows.
- `AssetBucketModal.tsx` — per-filter-row bucket picker (centered `.modal` overlay). Scoped to
  one character+location+`zone`: a **Basic hangar** toggle on top, then **Containers**/**Ships**
  `.subtabs`, each an alphabetized list of per-bucket `Toggle`s + a **Toggle all** row. A bucket
  with a player-given name renders as `Name (Type)` (e.g. a renamed ship), else just the type
  name. Seeds
  from `GET /filters/buckets` (defaults: containers + basic hangar on, ships off), edits local
  copies, and `PUT`s on Save → invalidates `['priced', listId]`. Closes on Escape / backdrop.
- `EditableText.tsx` — reusable click-to-edit text (span → input; commits trimmed/changed on
  Enter/blur, restores on Escape). Used for the list title on `ListsPage` + `ListDetailPage`
  (`.editable-title` / `.title-input` in `theme.css`).
- `FuzzySelect.tsx` — generic searchable dropdown (characters/locations).
- `Toggle.tsx` — reusable iOS-style on/off switch (`.switch` in `theme.css`); use it instead
  of a native `<input type="checkbox">` for on/off state (bigger hit target). Used by
  `ExistingStockTab` filters/pastes; the add-group visibility control uses `EyeIcon` instead.
- `EyeIcon.tsx` — inline feather-style eye / eye-off SVG for "visibility" affordances (add-group
  shown-in-list vs. hidden). Styled via `.eye-btn` (+ `.off`) in `theme.css`.
- `ItemIcon.tsx` — the **one** way a 32px EVE type/ship icon is rendered
  (`images.evetech.net/types/:id/icon`, `.item-icon`). Use it instead of an inline `<img>`.
- `CostVolume.tsx` — the **one** way ISK+cargo are shown together: `<wallet> num ISK` ⇥ `<cargo>
  num m³` (icons from `src/assets/32px-{Wallet,Cargo}.png`, inlined by Vite). Icons scale with
  font-size (`.cv-ico { height: 1em }` in `theme.css`), so size is set by the container: `size="lg"`
  (18px/600, matches the old list total) for the `list-total-bar`; the default small size for group/
  fit header subtotals and the Add-items / Add-fits row summaries. `formatVolume` already yields
  "742 m³", so only " ISK" is appended; blank (null/NaN → "—") drops icon + unit. **Per-row table
  cells** (Unit / Unit m³ / Total / Total m³ — `PriceVolCells` in `list-table/shared.tsx`) stay
  plain `formatIsk`/`formatVolume` under their labeled columns — the icon+label pairing is only
  for the combined summary spots.
- `DefaultLocationsSection.tsx` — global defaults on/off toggle, then two `ZoneDefaults` blocks
  (**Purchase location** / **Destination**) each listing that zone's saved defaults + an add row;
  defaults carry a `zone` and seed the matching existing-stock section on new lists.

## Fuzzy item search — `src/hooks/useTypesIndex.ts`

Loads `/api/sde/types-index` once (published market types, ~40k), builds a uFuzzy index.
**Gotcha (already fixed, don't reintroduce):** the ranked haystack index is
`info.idx[order[i]]` directly — do NOT index through `idxs` again. Unranked path (too many
matches) uses `idxs[i]`. Wrong indexing crashes only on the full-size list, not small tests.
