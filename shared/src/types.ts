// Shared DTOs between server and client.

export type PriceSource = 'esi_average' | 'hub_sell' | 'hub_buy' | 'hub_split';

/**
 * Where a piece of "existing stock" physically sits, which decides what it's netted out of:
 *   'purchase'    — stock at the market/buy location: excluded from the Purchase view only
 *                   (you still have to haul it to the destination).
 *   'destination' — stock already at the destination: excluded from BOTH the Purchase and
 *                   Transport views (nothing to buy, nothing to move).
 */
export type StockZone = 'purchase' | 'destination';

export interface Settings {
  /** Resolved EVE SSO client id: the user's own if they set one, else the bundled default. */
  client_id: string;
  /** True when `client_id` is the app's bundled application (i.e. the user has no override). */
  client_id_is_default: boolean;
  /**
   * The callback URL this build authorizes against — the hosted bounce page in the desktop
   * app (it deep-links on to the app), `http://localhost:8642/sso/callback` in web mode.
   * Read-only; the UI shows it so a user registering their own application copies the right
   * value.
   */
  sso_redirect: string;
  contact_email: string;
  price_source: PriceSource;
  hub_station_id: number;
  hub_region_id: number;
  defaults_enabled: boolean;
}

/** `POST /api/sso/start` — an authorization attempt the client then opens in the browser. */
export interface SsoStart {
  /** Opaque id for this attempt; poll `/api/sso/status?state=…` with it. */
  state: string;
  /** The EVE SSO authorize URL to open in the user's default browser. */
  url: string;
}

/**
 * `GET /api/sso/status?state=…` — where an in-flight attempt got to. The browser half of the
 * flow lands on the server (web) or on the Electron protocol handler (desktop), never back in
 * the page that started it, so the UI polls for the outcome instead of being navigated to it.
 */
export type SsoStatus =
  | { status: 'pending' }
  | { status: 'done'; character: CharacterSummary }
  | { status: 'error'; message: string };

export interface ListSummary {
  id: number;
  name: string;
  item_count: number;
  created_at: number;
  updated_at: number;
}

/** One preview line on a lists-index card: an item (or a fit's hull) with a quantity. */
export interface ListOverviewEntry {
  type_id: number; // the item type — for a fit entry, the hull's ship_type_id
  name: string; // type name, or the fit's name for a fit entry
  quantity: number; // rollup (expanded) qty for items; fit_qty for fits
}

/**
 * A lists-index card: the summary plus rollup totals and value-sorted previews, computed
 * from **cached** prices only (`GET /api/lists` warms the esi_average cache best-effort
 * but never blocks on hub sources).
 */
export interface ListOverview extends ListSummary {
  total: number; // rollup ISK across enabled groups + ungrouped items (no owned deduction)
  total_volume: number; // same rollup, in m³ (packaged volume for ships)
  has_unpriced: boolean;
  top_items: ListOverviewEntry[]; // rollup lines sorted by extended value desc, capped
  top_fits: ListOverviewEntry[]; // fit groups sorted by subtotal desc, capped
}

export interface ListItem {
  type_id: number;
  name: string;
  quantity: number;
  position: number;
}

/**
 * A rollup line: one type aggregated across enabled groups, with the raw ingredients each
 * view needs to deduct owned stock. The client derives the per-view quantity/extended figures:
 *   Purchase view  displayed = quantity - owned_purchase - owned_destination
 *   Transport view displayed = quantity - owned_destination
 * (Edit view shows the per-group stored quantities and ignores owned entirely.)
 */
export interface PricedItem {
  type_id: number;
  name: string;
  quantity: number; // stored (group-multiplier–expanded) quantity aggregated across enabled groups
  owned_purchase: number; // owned at the purchase location (netted out of Purchase only)
  owned_destination: number; // owned at the destination (netted out of Purchase AND Transport)
  position: number;
  unit_price: number | null; // null = unpriceable / not on market
  unit_volume: number | null; // m³ per unit (null = unknown in the SDE)
}

/** A single item line inside one add-group (no owned deduction). */
export interface PricedGroupItem {
  type_id: number;
  name: string;
  stored_quantity: number; // raw per-line qty as typed (before the group multiplier)
  quantity: number; // expanded qty = stored_quantity * group multiplier (fit_qty)
  position: number;
  unit_price: number | null;
  extended_price: number | null; // unit_price * quantity (expanded)
  unit_volume: number | null; // m³ per unit (null = unknown in the SDE)
  extended_volume: number | null; // unit_volume * quantity (expanded)
}

/**
 * One add-group with its own priced lines and subtotal. Owned/stock deduction is a
 * rollup-level concept (owned isn't attributable to a single group), so group lines are
 * the raw stored quantities. Disabled groups are still returned (the client greys them)
 * but are excluded from the rollup total.
 */
export interface PricedGroup {
  id: number;
  name: string;
  enabled: boolean;
  position: number;
  items: PricedGroupItem[]; // quantities already scaled by fit_qty (1 for manual groups)
  item_count: number; // distinct type_ids in this group
  subtotal: number; // sum of extended prices
  subtotal_volume: number; // sum of extended volumes
  has_unpriced: boolean;
  /** 'manual' = ordinary add-group; 'fit' = a parsed pyfa ship fit. */
  kind: 'manual' | 'fit';
  ship_type_id: number | null; // fit only: the hull, for the ship icon
  fit_qty: number; // qty multiplier applied to every line (fits and manual groups; 1 = no scaling)
  raw_fit: string | null; // fit only: original pasted text, for the fit editor
}

export interface PricedList {
  list_id: number;
  name: string;
  price_source: PriceSource;
  // ROLLUP: aggregated across enabled groups, carrying owned-per-zone so the client can
  // compute the Purchase / Transport views. Per-view totals are derived client-side (they
  // differ by view), so they aren't carried here.
  items: PricedItem[];
  has_unpriced: boolean; // rollup has an unpriced type
  groups: PricedGroup[]; // every group (incl. disabled), for the grouped view + add-tab manager
  active_group_id: number; // where new adds/pastes land
}

export interface TypesIndexEntry {
  0: number; // type_id
  1: string; // name
}

export interface CharacterSummary {
  character_id: number;
  name: string;
  needs_reauth: boolean;
  added_at: number;
}

export interface LocationSummary {
  location_id: number;
  name: string;
  kind: 'station' | 'structure';
  unique_types: number;
}

export interface FilterRow {
  character_id: number;
  location_id: number;
  enabled: boolean; // when false, this row is not subtracted from the list
  has_bucket_filter?: boolean; // GET only: a non-default container/ship selection is saved for this row
}

/**
 * One selectable container or fitted ship inside a filter row's location, shown in the
 * per-row bucket picker. `bucket_id` is the asset item_id that identifies it.
 */
export interface FilterBucketEntry {
  bucket_id: number;
  type_id: number;
  name: string; // the container/ship type name
  custom_name: string | null; // the player-assigned item name, if any (e.g. a renamed ship)
  item_count: number; // distinct item types held (contents), for a size hint
  enabled: boolean; // whether this bucket currently deducts (with defaults applied)
}

/**
 * The bucket selection for a single filter row (character + location): whether the loose
 * "basic hangar" items deduct, plus the container and fitted-ship buckets present there.
 * Defaults are containers + basic hangar on, ships off.
 */
export interface FilterBuckets {
  basic_hangar: boolean;
  has_basic_hangar: boolean; // whether any loose hangar items exist (to show/hide the checkbox)
  containers: FilterBucketEntry[];
  ships: FilterBucketEntry[];
}

/** PUT payload to save a filter row's bucket selection. */
export interface FilterBucketsUpdate {
  character_id: number;
  location_id: number;
  zone: StockZone; // which existing-stock section the row belongs to
  basic_hangar: boolean;
  containers: Array<{ bucket_id: number; enabled: boolean }>;
  ships: Array<{ bucket_id: number; enabled: boolean }>;
}

/**
 * A manually pasted stock snapshot (a "newer hangar" the user wants to compare against
 * while API assets are still cached). Saved per list, toggled like a filter row.
 */
export interface AssetPaste {
  id: number;
  list_id: number;
  name: string; // auto-generated, e.g. "Asset paste 2026-07-26 14:32"
  created_at: number;
  enabled: boolean;
  item_count: number; // distinct type_ids
  total_quantity: number; // summed quantities
}

export interface DefaultLocation {
  character_id: number;
  character_name: string;
  location_id: number;
  location_name: string;
  zone: StockZone; // seeds this zone's filter rows on new lists
}

export interface SdeStatus {
  ready: boolean;
  build_number: number | null;
  ingested_at: number | null;
  updating: boolean;
  message: string | null;
}

export interface AssetRefreshStatus {
  character_id: number;
  name: string;
  fetched_at: number | null;
  next_allowed_at: number | null;
  in_cooldown: boolean;
  last_error: string | null;
}

/** Result of parsing a pasted bulk-import block. */
export interface ParsedPasteLine {
  raw: string;
  lineNumber: number;
  name: string;
  quantity: number;
}
