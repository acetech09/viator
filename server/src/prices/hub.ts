import type { PriceSource, Settings } from '@viator/shared';
import { getDb } from '../db/db.js';
import { esiGetAllPages } from '../esi/client.js';

interface MarketOrder {
  price: number;
  location_id: number;
  is_buy_order: boolean;
}

const HUB_CACHE_FLOOR_MS = 15 * 60 * 1000;

/** Fetch per-type hub prices (sell/buy/split) for any stale types and cache them. */
export async function refreshHubPrices(settings: Settings, typeIds: number[]): Promise<void> {
  const source = settings.price_source;
  const stale = typeIds.filter((id) => !isFresh(source, id));
  if (stale.length === 0) return;

  await Promise.all(
    stale.map(async (typeId) => {
      try {
        const price = await fetchHubPrice(settings, typeId);
        cachePrice(source, typeId, price);
      } catch {
        // Leave uncached on transient failure; it'll retry on the next priced request.
      }
    }),
  );
}

function isFresh(source: PriceSource, typeId: number): boolean {
  const row = getDb()
    .prepare('SELECT expires_at FROM price_cache WHERE source = ? AND type_id = ?')
    .get(source, typeId) as { expires_at: number } | undefined;
  return !!row && row.expires_at > Date.now();
}

async function fetchHubPrice(settings: Settings, typeId: number): Promise<number | null> {
  const { price_source, hub_region_id, hub_station_id } = settings;
  const path = `/markets/${hub_region_id}/orders`;

  const needSell = price_source === 'hub_sell' || price_source === 'hub_split';
  const needBuy = price_source === 'hub_buy' || price_source === 'hub_split';

  let minSell: number | null = null;
  let maxBuy: number | null = null;

  if (needSell) {
    const sell = await esiGetAllPages<MarketOrder>(path, {
      query: { type_id: typeId, order_type: 'sell' },
      cache: true,
    });
    for (const o of sell) {
      if (o.location_id === hub_station_id && (minSell === null || o.price < minSell)) minSell = o.price;
    }
  }
  if (needBuy) {
    const buy = await esiGetAllPages<MarketOrder>(path, {
      query: { type_id: typeId, order_type: 'buy' },
      cache: true,
    });
    for (const o of buy) {
      if (o.location_id === hub_station_id && (maxBuy === null || o.price > maxBuy)) maxBuy = o.price;
    }
  }

  if (price_source === 'hub_sell') return minSell;
  if (price_source === 'hub_buy') return maxBuy;
  // hub_split: midpoint when both sides exist, else whichever side we have.
  if (minSell !== null && maxBuy !== null) return (minSell + maxBuy) / 2;
  return minSell ?? maxBuy;
}

function cachePrice(source: PriceSource, typeId: number, price: number | null): void {
  const now = Date.now();
  const expiresAt = now + HUB_CACHE_FLOOR_MS;
  getDb()
    .prepare(
      `INSERT INTO price_cache(source, type_id, price, fetched_at, expires_at)
       VALUES(?, ?, ?, ?, ?)
       ON CONFLICT(source, type_id) DO UPDATE SET price = excluded.price, fetched_at = excluded.fetched_at, expires_at = excluded.expires_at`,
    )
    .run(source, typeId, price, now, expiresAt);
}
