import type {
  AssetPaste,
  AssetRefreshStatus,
  CharacterSummary,
  DefaultLocation,
  FilterBuckets,
  FilterBucketsUpdate,
  FilterRow,
  ListItem,
  ListOverview,
  ListSummary,
  LocationSummary,
  PricedList,
  SdeStatus,
  Settings,
  StockZone,
} from '@viator/shared';

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  // Only advertise a JSON body when we actually send one. Fastify 5 rejects a POST
  // with `Content-Type: application/json` and an empty body (FST_ERR_CTP_EMPTY_JSON_BODY
  // -> 400 "Bad Request"), which broke bodyless POSTs like refreshAssets/duplicateList.
  const headers: Record<string, string> = { ...((init?.headers as Record<string, string>) ?? {}) };
  if (init?.body != null && !('Content-Type' in headers)) headers['Content-Type'] = 'application/json';
  const res = await fetch(url, { ...init, headers });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const body = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    const err = new Error(body?.error ?? `HTTP ${res.status}`) as Error & { body?: unknown; status?: number };
    err.body = body;
    err.status = res.status;
    throw err;
  }
  return body as T;
}

export interface ListDetail {
  id: number;
  name: string;
  created_at: number;
  updated_at: number;
  items: ListItem[];
}

export const api = {
  // SDE
  sdeStatus: () => req<SdeStatus>('/api/sde/status'),
  // [type_id, name] + an optional trailing 1 marking a demoted type (cosmetic/blueprint).
  typesIndex: () => req<Array<[number, string, number?]>>('/api/sde/types-index'),

  // settings
  getSettings: () => req<Settings>('/api/settings'),
  updateSettings: (patch: Partial<Settings>) =>
    req<Settings>('/api/settings', { method: 'PUT', body: JSON.stringify(patch) }),

  // lists
  lists: () => req<ListOverview[]>('/api/lists'),
  createList: (name: string) => req<ListSummary>('/api/lists', { method: 'POST', body: JSON.stringify({ name }) }),
  renameList: (id: number, name: string) =>
    req<{ ok: true }>(`/api/lists/${id}`, { method: 'PUT', body: JSON.stringify({ name }) }),
  deleteList: (id: number) => req<void>(`/api/lists/${id}`, { method: 'DELETE' }),
  duplicateList: (id: number) => req<{ id: number }>(`/api/lists/${id}/duplicate`, { method: 'POST' }),
  listDetail: (id: number) => req<ListDetail>(`/api/lists/${id}`),
  addItem: (id: number, type_id: number, quantity: number, group_id?: number) =>
    req<{ ok: true; items: ListItem[] }>(`/api/lists/${id}/items`, {
      method: 'POST',
      body: JSON.stringify({ type_id, quantity, group_id }),
    }),
  setGroupItemQty: (id: number, groupId: number, typeId: number, quantity: number) =>
    req<{ ok: true }>(`/api/lists/${id}/groups/${groupId}/items/${typeId}`, {
      method: 'PUT',
      body: JSON.stringify({ quantity }),
    }),
  removeGroupItem: (id: number, groupId: number, typeId: number) =>
    req<{ ok: true }>(`/api/lists/${id}/groups/${groupId}/items/${typeId}`, { method: 'DELETE' }),
  pricedList: (id: number) => req<PricedList>(`/api/lists/${id}/priced`),
  importPaste: (id: number, text: string, group_id?: number) =>
    req<{ ok: true; added: number }>(`/api/lists/${id}/import`, {
      method: 'POST',
      body: JSON.stringify({ text, group_id }),
    }),

  // add-groups
  createGroup: (id: number, name?: string) =>
    req<{ id: number; name: string }>(`/api/lists/${id}/groups`, { method: 'POST', body: JSON.stringify({ name }) }),
  updateGroup: (id: number, groupId: number, patch: { name?: string; enabled?: boolean; fit_qty?: number }) =>
    req<{ ok: true }>(`/api/lists/${id}/groups/${groupId}`, { method: 'PUT', body: JSON.stringify(patch) }),
  deleteGroup: (id: number, groupId: number) =>
    req<{ ok: true }>(`/api/lists/${id}/groups/${groupId}`, { method: 'DELETE' }),
  setActiveGroup: (id: number, group_id: number) =>
    req<{ ok: true }>(`/api/lists/${id}/active-group`, { method: 'PUT', body: JSON.stringify({ group_id }) }),

  // ship fits (add-groups built from a pyfa paste)
  createFit: (id: number, text: string) =>
    req<{ id: number; name: string }>(`/api/lists/${id}/fits`, { method: 'POST', body: JSON.stringify({ text }) }),
  updateFit: (id: number, groupId: number, patch: { text?: string; fit_qty?: number }) =>
    req<{ ok: true }>(`/api/lists/${id}/fits/${groupId}`, { method: 'PUT', body: JSON.stringify(patch) }),

  // filters (scoped to an existing-stock zone: 'purchase' | 'destination')
  getFilters: (id: number, zone: StockZone) => req<FilterRow[]>(`/api/lists/${id}/filters?zone=${zone}`),
  setFilters: (id: number, zone: StockZone, filters: FilterRow[]) =>
    req<{ ok: true }>(`/api/lists/${id}/filters?zone=${zone}`, { method: 'PUT', body: JSON.stringify({ filters }) }),

  // per-row bucket selection (containers / fitted ships / basic hangar), per zone
  getFilterBuckets: (id: number, characterId: number, locationId: number, zone: StockZone) =>
    req<FilterBuckets>(
      `/api/lists/${id}/filters/buckets?character_id=${characterId}&location_id=${locationId}&zone=${zone}`,
    ),
  setFilterBuckets: (id: number, payload: FilterBucketsUpdate) =>
    req<{ ok: true }>(`/api/lists/${id}/filters/buckets`, { method: 'PUT', body: JSON.stringify(payload) }),

  // asset pastes (manual stock snapshots), per zone
  assetPastes: (id: number, zone: StockZone) => req<AssetPaste[]>(`/api/lists/${id}/asset-pastes?zone=${zone}`),
  createAssetPaste: (id: number, text: string, zone: StockZone) =>
    req<{ id: number; name: string; added: number }>(`/api/lists/${id}/asset-pastes?zone=${zone}`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    }),
  setAssetPasteEnabled: (id: number, pasteId: number, enabled: boolean) =>
    req<{ ok: true }>(`/api/lists/${id}/asset-pastes/${pasteId}`, { method: 'PUT', body: JSON.stringify({ enabled }) }),
  removeAssetPaste: (id: number, pasteId: number) =>
    req<void>(`/api/lists/${id}/asset-pastes/${pasteId}`, { method: 'DELETE' }),

  // characters + assets
  characters: () => req<CharacterSummary[]>('/api/characters'),
  deleteCharacter: (id: number) => req<void>(`/api/characters/${id}`, { method: 'DELETE' }),
  locations: (characterId: number) => req<LocationSummary[]>(`/api/characters/${characterId}/locations`),
  refreshAssets: () => req<AssetRefreshStatus[]>('/api/assets/refresh', { method: 'POST' }),
  assetStatus: () => req<AssetRefreshStatus[]>('/api/assets/status'),
  defaultLocations: () => req<DefaultLocation[]>('/api/default-locations'),
  addDefaultLocation: (character_id: number, location_id: number, zone: StockZone) =>
    req<{ ok: true }>('/api/default-locations', {
      method: 'POST',
      body: JSON.stringify({ character_id, location_id, zone }),
    }),
  removeDefaultLocation: (character_id: number, location_id: number, zone: StockZone) =>
    req<void>(`/api/default-locations/${character_id}/${location_id}/${zone}`, { method: 'DELETE' }),
};
