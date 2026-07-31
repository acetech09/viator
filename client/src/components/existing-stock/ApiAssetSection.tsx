import { Fragment, useState } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import type { FilterRow, LocationSummary, StockZone } from '@viator/shared';
import { api } from '../../api';
import { useToast } from '../../toast';
import { AssetBucketModal } from '../AssetBucketModal';
import { ClipboardIcon, PersonIcon } from '../ButtonIcons';
import { FuzzySelect, type Option } from '../FuzzySelect';
import { Toggle } from '../Toggle';

/** API-fetched assets: character + location filter rows, each individually toggleable. */
export function ApiAssetSection({
  listId,
  zone,
  onAddManualPaste,
}: {
  listId: number;
  zone: StockZone;
  onAddManualPaste: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();

  const characters = useQuery({ queryKey: ['characters'], queryFn: api.characters });
  const filters = useQuery({ queryKey: ['filters', listId, zone], queryFn: () => api.getFilters(listId, zone) });

  // The filter row whose bucket picker is open (character + location it targets), or null.
  const [bucketModal, setBucketModal] = useState<{
    characterId: number;
    locationId: number;
    characterName: string;
    locationName: string;
  } | null>(null);

  const save = useMutation({
    mutationFn: (rows: FilterRow[]) => api.setFilters(listId, zone, rows),
    // Do NOT invalidate ['filters', listId, zone] here: the optimistic setQueryData in the
    // callers is authoritative for the editing session, and it holds in-progress rows
    // (character picked, location not yet) that the server never persists. Refetching
    // would clobber those rows and make character selection appear to do nothing.
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['priced', listId] });
    },
    onError: (e: Error) => toast(`Could not save filters: ${e.message}`, 'error'),
  });

  // Default locations seed a new list's filters ONCE, server-side at list creation
  // (see seedDefaultFilters in server/src/routes/lists/helpers.ts). Deliberately no client-side
  // seeding here: a length-based "seed when empty" re-fires whenever the user removes the
  // last filter (making the ✕ appear to revert to the default), and its optimistic write
  // races the initial refetch (making the seeded row vanish on first view).
  const rows = filters.data ?? [];

  // Load location options for every character referenced by a row (and all chars for pickers).
  const charIds = characters.data?.map((c) => c.character_id) ?? [];
  const locationQueries = useQueries({
    queries: charIds.map((id) => ({
      queryKey: ['locations', id],
      queryFn: () => api.locations(id),
      staleTime: 60_000,
    })),
  });
  const locationsByChar = new Map<number, LocationSummary[]>();
  charIds.forEach((id, i) => locationsByChar.set(id, (locationQueries[i]?.data as LocationSummary[]) ?? []));

  const complete = (r: FilterRow) => Boolean(r.character_id && r.location_id);

  function commit(next: FilterRow[]) {
    qc.setQueryData(['filters', listId, zone], next);
    save.mutate(next.filter(complete));
  }

  function updateRow(index: number, patch: Partial<FilterRow>) {
    commit(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function addRow() {
    qc.setQueryData(['filters', listId, zone], [...rows, { character_id: 0, location_id: 0, enabled: true }]);
  }

  function removeRow(index: number) {
    commit(rows.filter((_, i) => i !== index));
  }

  const toggleableRows = rows.filter(complete);
  const allEnabled = toggleableRows.length > 0 && toggleableRows.every((r) => r.enabled);
  function toggleAll() {
    const target = !allEnabled;
    commit(rows.map((r) => ({ ...r, enabled: target })));
  }

  const charOptions: Option[] = (characters.data ?? []).map((c) => ({
    value: c.character_id,
    label: c.name,
    iconUrl: `https://images.evetech.net/characters/${c.character_id}/portrait?size=32`,
  }));

  const noCharacters = characters.data != null && characters.data.length === 0;

  // Two actions sit under the grid. "Add API Assets Filter" needs an authorized character; "Add
  // manual paste filter" opens the paste box (owned by the parent) and is always available.
  const actions = (
    <div className="row" style={{ gap: 8 }}>
      {!noCharacters && (
        <button className="btn small ico-btn" onClick={addRow}>
          <PersonIcon />
          Add API Assets Filter
        </button>
      )}
      <button className="btn small ico-btn" onClick={onAddManualPaste}>
        <ClipboardIcon />
        Add manual paste filter
      </button>
    </div>
  );

  if (noCharacters) {
    return (
      <div className="col" style={{ gap: 10 }}>
        <div className="muted">Authorize a character in Settings to subtract owned assets from the API.</div>
        {actions}
      </div>
    );
  }

  return (
    <div className="col" style={{ gap: 10 }}>
      {/*
        CSS Grid (not a <table>) so columns follow a width priority: Location holds a hard 35ch
        minimum and fills any slack, while Character shows its full name but is the column that
        shrinks/truncates when the row is too tight to keep Location at 35ch (see .filter-grid in
        theme.css). Each row is a Fragment of exactly 5 cells so the grid keeps columns aligned.
        Headers only render once a filter row exists — an empty table left bare "Character" /
        "Location" labels stacked at the left.
      */}
      {rows.length > 0 && (
        <div className="filter-grid">
        <div className="fr-toggle fr-head">
          {toggleableRows.length > 0 && (
            <button
              className="btn small"
              onClick={() => toggleAll()}
              title={allEnabled ? 'Disable all filters' : 'Enable all filters'}
            >
              Toggle all
            </button>
          )}
        </div>
        <div className="fr-head">Character</div>
        <div className="fr-head">Location</div>
        <div />
        <div />

        {rows.map((row, i) => {
          const locs = locationsByChar.get(row.character_id) ?? [];
          const locOptions: Option[] = locs.map((l) => ({
            value: l.location_id,
            label: l.name,
            sublabel: `${l.unique_types} item types`,
          }));
          const rowMuted = complete(row) && !row.enabled;
          const dim = rowMuted ? 'muted' : '';
          return (
            <Fragment key={i}>
              <div className={`fr-toggle ${dim}`}>
                <Toggle
                  checked={row.enabled}
                  disabled={!complete(row)}
                  title={complete(row) ? 'Subtract this location' : 'Pick a character and location first'}
                  onChange={(v) => updateRow(i, { enabled: v })}
                />
              </div>
              <div className={dim}>
                <FuzzySelect
                  options={charOptions}
                  value={row.character_id || null}
                  placeholder="Character"
                  minWidth={0}
                  onChange={(v) => updateRow(i, { character_id: v, location_id: 0, has_bucket_filter: false })}
                />
              </div>
              <div className={dim}>
                <FuzzySelect
                  options={locOptions}
                  value={row.location_id || null}
                  placeholder={row.character_id ? 'Location' : 'Pick character first'}
                  disabled={!row.character_id}
                  minWidth={0}
                  onChange={(v) => updateRow(i, { location_id: v, has_bucket_filter: false })}
                />
              </div>
              <div>
                <button
                  className="btn small"
                  disabled={!complete(row)}
                  style={row.has_bucket_filter ? { color: 'var(--warn)', borderColor: 'var(--warn)' } : undefined}
                  title={
                    complete(row)
                      ? 'Choose which containers and ships to subtract'
                      : 'Pick a character and location first'
                  }
                  onClick={() =>
                    setBucketModal({
                      characterId: row.character_id,
                      locationId: row.location_id,
                      characterName: charOptions.find((c) => c.value === row.character_id)?.label ?? 'Character',
                      locationName: locs.find((l) => l.location_id === row.location_id)?.name ?? 'Location',
                    })
                  }
                >
                  {row.has_bucket_filter ? 'Edit filter' : 'Add filter'}
                </button>
              </div>
              <div>
                <button className="btn icon small danger" title="Remove filter" onClick={() => removeRow(i)}>
                  ✕
                </button>
              </div>
            </Fragment>
          );
        })}
        </div>
      )}
      {actions}

      {bucketModal && (
        <AssetBucketModal
          listId={listId}
          zone={zone}
          characterId={bucketModal.characterId}
          locationId={bucketModal.locationId}
          characterName={bucketModal.characterName}
          locationName={bucketModal.locationName}
          onClose={() => setBucketModal(null)}
        />
      )}
    </div>
  );
}
