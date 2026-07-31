import { useState } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DefaultLocation, LocationSummary, Settings, StockZone } from '@viator/shared';
import { api } from '../api';
import { useToast } from '../toast';
import { FuzzySelect, type Option } from './FuzzySelect';
import { Toggle } from './Toggle';

export function DefaultLocationsSection() {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.getSettings });
  const characters = useQuery({ queryKey: ['characters'], queryFn: api.characters });
  const defaults = useQuery({ queryKey: ['default-locations'], queryFn: api.defaultLocations });

  const charIds = characters.data?.map((c) => c.character_id) ?? [];
  const locQueries = useQueries({
    queries: charIds.map((id) => ({ queryKey: ['locations', id], queryFn: () => api.locations(id), staleTime: 60_000 })),
  });
  const locsByChar = new Map<number, LocationSummary[]>();
  charIds.forEach((id, i) => locsByChar.set(id, (locQueries[i]?.data as LocationSummary[]) ?? []));

  const toggle = useMutation({
    mutationFn: (enabled: boolean) => api.updateSettings({ defaults_enabled: enabled } as Partial<Settings>),
    onSuccess: (s) => qc.setQueryData(['settings'], s),
  });

  if (!characters.data || characters.data.length === 0) return null;

  const charOptions: Option[] = characters.data.map((c) => ({
    value: c.character_id,
    label: c.name,
    iconUrl: `https://images.evetech.net/characters/${c.character_id}/portrait?size=32`,
  }));

  return (
    <div className="settings-section">
      <h2>Default filter locations</h2>
      <label className="row" style={{ marginBottom: 16, gap: 8, cursor: 'pointer' }}>
        <Toggle
          checked={settings.data?.defaults_enabled ?? false}
          onChange={(v) => toggle.mutate(v)}
          ariaLabel="Auto-apply default filters to new lists"
        />
        <span>Auto-apply these filters to new lists</span>
      </label>

      <ZoneDefaults
        zone="purchase"
        title="Purchase location"
        hint="Seeds the “Existing Stock at Purchase Location” rows."
        defaults={defaults.data ?? []}
        charOptions={charOptions}
        locsByChar={locsByChar}
      />
      <ZoneDefaults
        zone="destination"
        title="Destination"
        hint="Seeds the “Existing Stock at Destination” rows."
        defaults={defaults.data ?? []}
        charOptions={charOptions}
        locsByChar={locsByChar}
      />
    </div>
  );
}

/** One zone's default locations: its saved rows + an add row. */
function ZoneDefaults({
  zone,
  title,
  hint,
  defaults,
  charOptions,
  locsByChar,
}: {
  zone: StockZone;
  title: string;
  hint: string;
  defaults: DefaultLocation[];
  charOptions: Option[];
  locsByChar: Map<number, LocationSummary[]>;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [char, setChar] = useState<number | null>(null);
  const [loc, setLoc] = useState<number | null>(null);

  const rows = defaults.filter((d) => d.zone === zone);

  const add = useMutation({
    mutationFn: () => api.addDefaultLocation(char!, loc!, zone),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['default-locations'] });
      setLoc(null);
      toast('Default location added', 'success');
    },
  });

  const remove = useMutation({
    mutationFn: ({ c, l }: { c: number; l: number }) => api.removeDefaultLocation(c, l, zone),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['default-locations'] }),
  });

  const locOptions: Option[] = (char ? locsByChar.get(char) ?? [] : []).map((l) => ({
    value: l.location_id,
    label: l.name,
    sublabel: `${l.unique_types} item types`,
  }));

  return (
    <div style={{ marginBottom: 20 }}>
      <h3 style={{ margin: '0 0 4px', fontSize: 13 }}>{title}</h3>
      <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
        {hint}
      </div>

      {rows.map((d) => (
        <div key={`${d.character_id}-${d.location_id}`} className="char-card">
          <div style={{ flex: 1 }}>
            <div>{d.location_name}</div>
            <div className="muted" style={{ fontSize: 12 }}>
              {d.character_name}
            </div>
          </div>
          <button className="btn small danger" onClick={() => remove.mutate({ c: d.character_id, l: d.location_id })}>
            Remove
          </button>
        </div>
      ))}

      <div className="row" style={{ marginTop: 8, alignItems: 'flex-start' }}>
        <FuzzySelect
          options={charOptions}
          value={char}
          placeholder="Character"
          onChange={(v) => {
            setChar(v);
            setLoc(null);
          }}
        />
        <FuzzySelect
          options={locOptions}
          value={loc}
          placeholder={char ? 'Location' : 'Pick character'}
          disabled={!char}
          onChange={setLoc}
        />
        <button className="btn" disabled={!char || !loc || add.isPending} onClick={() => add.mutate()}>
          Add
        </button>
      </div>
    </div>
  );
}
