import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { FilterBucketEntry, FilterRow, StockZone } from '@viator/shared';
import { api } from '../api';
import { useToast } from '../toast';
import { Toggle } from './Toggle';

type Tab = 'containers' | 'ships';

/**
 * Per-row bucket picker for the "existing stock" API asset checks. Scoped to one filter row
 * (character + location + zone): a "basic hangar" checkbox on top, then Containers / Ships tabs,
 * each an alphabetized list of per-bucket toggles + a "toggle all". Defaults (containers + basic
 * hangar on, ships off) come from the server; saving persists the selection and re-prices.
 */
export function AssetBucketModal({
  listId,
  zone,
  characterId,
  locationId,
  characterName,
  locationName,
  onClose,
}: {
  listId: number;
  zone: StockZone;
  characterId: number;
  locationId: number;
  characterName: string;
  locationName: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('containers');

  // Local editable copies, seeded once the query resolves.
  const [basicHangar, setBasicHangar] = useState(true);
  const [containers, setContainers] = useState<FilterBucketEntry[]>([]);
  const [ships, setShips] = useState<FilterBucketEntry[]>([]);

  const buckets = useQuery({
    queryKey: ['filter-buckets', listId, characterId, locationId, zone],
    queryFn: () => api.getFilterBuckets(listId, characterId, locationId, zone),
  });

  useEffect(() => {
    if (!buckets.data) return;
    setBasicHangar(buckets.data.basic_hangar);
    setContainers(buckets.data.containers);
    setShips(buckets.data.ships);
  }, [buckets.data]);

  const save = useMutation({
    mutationFn: () =>
      api.setFilterBuckets(listId, {
        character_id: characterId,
        location_id: locationId,
        zone,
        basic_hangar: basicHangar,
        containers: containers.map((c) => ({ bucket_id: c.bucket_id, enabled: c.enabled })),
        ships: ships.map((s) => ({ bucket_id: s.bucket_id, enabled: s.enabled })),
      }),
    onSuccess: () => {
      // Whether this selection deviates from the default (mirror of the server's
      // has_bucket_filter test) — drives the row's "Add filter" vs "Edit filter" label.
      // Patch the cached filter row directly rather than refetch, which would drop any
      // in-progress (incomplete) rows the ExistingStockTab holds optimistically.
      const active = !basicHangar || containers.some((c) => !c.enabled) || ships.some((s) => s.enabled);
      qc.setQueryData<FilterRow[]>(['filters', listId, zone], (rows) =>
        rows?.map((r) =>
          r.character_id === characterId && r.location_id === locationId ? { ...r, has_bucket_filter: active } : r,
        ),
      );
      qc.invalidateQueries({ queryKey: ['priced', listId] });
      qc.invalidateQueries({ queryKey: ['filter-buckets', listId, characterId, locationId, zone] });
      onClose();
    },
    onError: (e: Error) => toast(`Could not save filter: ${e.message}`, 'error'),
  });

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const rows = tab === 'containers' ? containers : ships;
  const setRows = tab === 'containers' ? setContainers : setShips;
  const allOn = rows.length > 0 && rows.every((r) => r.enabled);
  const toggleAll = () => {
    const target = !allOn;
    setRows(rows.map((r) => ({ ...r, enabled: target })));
  };
  const toggleOne = (bucketId: number, enabled: boolean) =>
    setRows(rows.map((r) => (r.bucket_id === bucketId ? { ...r, enabled } : r)));

  const emptyLabel = useMemo(
    () => (tab === 'containers' ? 'No containers at this location.' : 'No fitted ships at this location.'),
    [tab],
  );

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <div style={{ fontWeight: 600 }}>Filter owned assets</div>
            <div className="muted" style={{ fontSize: 12 }}>
              {characterName} · {locationName}
            </div>
          </div>
          <button className="btn icon" title="Close" onClick={onClose}>
            ✕
          </button>
        </div>

        {buckets.isLoading ? (
          <div className="muted" style={{ padding: 16 }}>
            Loading…
          </div>
        ) : (
          <>
            <label className="basic-hangar-row">
              <Toggle checked={basicHangar} onChange={setBasicHangar} ariaLabel="Basic hangar" />
              <div>
                <div>Basic hangar</div>
                <div className="muted" style={{ fontSize: 12 }}>
                  Loose items sitting directly in the hangar (not in a container or ship).
                </div>
              </div>
            </label>

            <div className="subtabs" style={{ marginTop: 4 }}>
              <button className={`tab ${tab === 'containers' ? 'active' : ''}`} onClick={() => setTab('containers')}>
                Containers ({containers.length})
              </button>
              <button className={`tab ${tab === 'ships' ? 'active' : ''}`} onClick={() => setTab('ships')}>
                Ships ({ships.length})
              </button>
            </div>

            <div className="modal-body">
              {rows.length === 0 ? (
                <div className="muted" style={{ padding: '12px 4px' }}>
                  {emptyLabel}
                </div>
              ) : (
                <>
                  <div className="bucket-row bucket-row-head">
                    <Toggle checked={allOn} onChange={toggleAll} ariaLabel="Toggle all" />
                    <div className="muted">Toggle all</div>
                  </div>
                  {rows.map((r) => (
                    <div key={r.bucket_id} className={`bucket-row ${r.enabled ? '' : 'muted'}`}>
                      <Toggle
                        checked={r.enabled}
                        onChange={(v) => toggleOne(r.bucket_id, v)}
                        ariaLabel={`Toggle ${r.name}`}
                      />
                      <img
                        src={`https://images.evetech.net/types/${r.type_id}/icon?size=32`}
                        alt=""
                        width={24}
                        height={24}
                        style={{ borderRadius: 3, flexShrink: 0 }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {r.custom_name ? `${r.custom_name} (${r.name})` : r.name}
                        </div>
                        <div className="muted" style={{ fontSize: 12 }}>
                          {r.item_count} item type(s)
                        </div>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          </>
        )}

        <div className="modal-foot">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={save.isPending || buckets.isLoading} onClick={() => save.mutate()}>
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
