import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { PriceSource, Settings } from '@viator/shared';
import { api } from '../api';
import { useToast } from '../toast';
import { AddCharacterButton } from '../components/AddCharacterButton';
import { DefaultLocationsSection } from '../components/DefaultLocationsSection';
import { EveApplicationPanel } from '../components/EveApplicationPanel';

const PRICE_LABELS: Record<PriceSource, string> = {
  esi_average: 'ESI estimated price (official average)',
  hub_sell: 'Hub — lowest sell',
  hub_buy: 'Hub — highest buy',
  hub_split: 'Hub — buy/sell split',
};

const HUBS: Array<{ id: number; region: number; name: string }> = [
  { id: 60003760, region: 10000002, name: 'Jita IV-4 (The Forge)' },
  { id: 60008494, region: 10000043, name: 'Amarr VIII (Domain)' },
  { id: 60011866, region: 10000032, name: 'Dodixie IX-20 (Sinq Laison)' },
  { id: 60004588, region: 10000030, name: 'Rens VI-8 (Heimatar)' },
  { id: 60005686, region: 10000042, name: 'Hek VIII-12 (Metropolis)' },
];

/** Advanced sub-pages, rendered in place of the main settings column. */
type AdvancedPage = 'eve-app';

export function SettingsPage() {
  const [advancedPage, setAdvancedPage] = useState<AdvancedPage | null>(null);
  if (advancedPage === 'eve-app') return <EveApplicationPanel onBack={() => setAdvancedPage(null)} />;
  return <SettingsMain onOpenAdvanced={setAdvancedPage} />;
}

function SettingsMain({ onOpenAdvanced }: { onOpenAdvanced: (p: AdvancedPage) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.getSettings });
  const characters = useQuery({ queryKey: ['characters'], queryFn: api.characters });

  const save = useMutation({
    mutationFn: (patch: Partial<Settings>) => api.updateSettings(patch),
    onSuccess: (s) => {
      qc.setQueryData(['settings'], s);
      toast('Settings saved', 'success');
    },
  });

  const removeChar = useMutation({
    mutationFn: (id: number) => api.deleteCharacter(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['characters'] });
      toast('Character removed', 'success');
    },
  });

  if (!settings.data) return <div className="muted">Loading…</div>;
  const s = settings.data;
  const hubDisabled = s.price_source === 'esi_average';

  return (
    <div className="settings-page">
      <div className="page-header">
        <h1>Settings</h1>
      </div>

      <div className="settings-section">
        <h2>Characters</h2>
        {characters.data && characters.data.length === 0 && <p className="muted">No characters authorized yet.</p>}
        {characters.data?.map((c) => (
          <div key={c.character_id} className="char-card">
            <img
              className="char-portrait"
              src={`https://images.evetech.net/characters/${c.character_id}/portrait?size=64`}
              alt=""
            />
            <div style={{ flex: 1 }}>
              <div>{c.name}</div>
              {c.needs_reauth && <span className="badge reauth">Re-auth needed</span>}
            </div>
            <button className="btn small danger" onClick={() => removeChar.mutate(c.character_id)}>
              Remove
            </button>
          </div>
        ))}
        <AddCharacterButton hasApplication={!!s.client_id} />
      </div>

      <div className="settings-section">
        <h2>Pricing</h2>
        <div className="settings-row">
          <label className="field-label">Price source</label>
          <select
            value={s.price_source}
            onChange={(e) => save.mutate({ price_source: e.target.value as PriceSource })}
          >
            {(Object.keys(PRICE_LABELS) as PriceSource[]).map((k) => (
              <option key={k} value={k}>
                {PRICE_LABELS[k]}
              </option>
            ))}
          </select>
        </div>
        <div className="settings-row">
          <label className="field-label">Market hub {hubDisabled && '(used by hub price sources)'}</label>
          <select
            value={s.hub_station_id}
            disabled={hubDisabled}
            onChange={(e) => {
              const hub = HUBS.find((h) => h.id === Number(e.target.value));
              if (hub) save.mutate({ hub_station_id: hub.id, hub_region_id: hub.region });
            }}
          >
            {HUBS.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <DefaultLocationsSection />

      <div className="settings-section">
        <h2>Advanced</h2>
        <button className="settings-nav-row" onClick={() => onOpenAdvanced('eve-app')}>
          <span className="settings-nav-text">
            <span className="settings-nav-title">EVE application Client ID</span>
            <span className="muted">
              {s.client_id_is_default && s.client_id
                ? 'Using the built-in application — override it with your own Client ID.'
                : 'No application bundled in this build — a Client ID is required to add characters.'}
            </span>
          </span>
          <span className="settings-nav-caret">›</span>
        </button>
      </div>
    </div>
  );
}
