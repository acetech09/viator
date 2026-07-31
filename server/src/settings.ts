import type { PriceSource, Settings } from '@viator/shared';
import { getDb } from './db/db.js';
import { DEFAULT_HUB_REGION_ID, DEFAULT_HUB_STATION_ID, DEFAULT_SSO_CLIENT_ID } from './config.js';

const DEFAULTS: Settings = {
  client_id: DEFAULT_SSO_CLIENT_ID,
  client_id_is_default: true,
  contact_email: '',
  price_source: 'esi_average',
  hub_station_id: DEFAULT_HUB_STATION_ID,
  hub_region_id: DEFAULT_HUB_REGION_ID,
  defaults_enabled: false,
};

const VALID_SOURCES: PriceSource[] = ['esi_average', 'hub_sell', 'hub_buy', 'hub_split'];

export function getSettings(): Settings {
  const db = getDb();
  const rows = db.prepare('SELECT key, value FROM settings').all() as Array<{ key: string; value: string }>;
  const map = new Map(rows.map((r) => [r.key, r.value]));
  // An empty stored value means "no override" — fall back to the bundled application.
  const ownClientId = map.get('client_id')?.trim() ?? '';
  return {
    client_id: ownClientId || DEFAULTS.client_id,
    client_id_is_default: !ownClientId,
    contact_email: map.get('contact_email') ?? DEFAULTS.contact_email,
    price_source: (VALID_SOURCES.includes(map.get('price_source') as PriceSource)
      ? (map.get('price_source') as PriceSource)
      : DEFAULTS.price_source),
    hub_station_id: intOr(map.get('hub_station_id'), DEFAULTS.hub_station_id),
    hub_region_id: intOr(map.get('hub_region_id'), DEFAULTS.hub_region_id),
    defaults_enabled: map.get('defaults_enabled') === '1',
  };
}

export function updateSettings(patch: Partial<Settings>): Settings {
  const db = getDb();
  const stmt = db.prepare(
    'INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  );
  const tx = db.transaction((entries: Array<[string, string]>) => {
    for (const [k, v] of entries) stmt.run(k, v);
  });

  const entries: Array<[string, string]> = [];
  if (patch.client_id !== undefined) entries.push(['client_id', patch.client_id.trim()]);
  if (patch.contact_email !== undefined) entries.push(['contact_email', patch.contact_email.trim()]);
  if (patch.price_source !== undefined && VALID_SOURCES.includes(patch.price_source)) {
    entries.push(['price_source', patch.price_source]);
  }
  if (patch.hub_station_id !== undefined) entries.push(['hub_station_id', String(patch.hub_station_id)]);
  if (patch.hub_region_id !== undefined) entries.push(['hub_region_id', String(patch.hub_region_id)]);
  if (patch.defaults_enabled !== undefined) {
    entries.push(['defaults_enabled', patch.defaults_enabled ? '1' : '0']);
  }
  if (entries.length) tx(entries);
  return getSettings();
}

function intOr(v: string | undefined, fallback: number): number {
  if (v === undefined) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}
