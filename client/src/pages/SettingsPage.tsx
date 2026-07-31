import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { PriceSource, Settings } from '@viator/shared';
import { api } from '../api';
import { useToast } from '../toast';
import { DefaultLocationsSection } from '../components/DefaultLocationsSection';

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

export function SettingsPage() {
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

  const [clientId, setClientId] = useState('');
  const [email, setEmail] = useState('');
  useEffect(() => {
    if (settings.data) {
      setClientId(settings.data.client_id);
      setEmail(settings.data.contact_email);
    }
  }, [settings.data]);

  if (!settings.data) return <div className="muted">Loading…</div>;
  const s = settings.data;
  const hubDisabled = s.price_source === 'esi_average';

  return (
    <div>
      <div className="page-header">
        <h1>Settings</h1>
      </div>

      <div className="settings-section">
        <h2>EVE application</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Register a native application at{' '}
          <a href="https://developers.eveonline.com/applications" target="_blank" rel="noreferrer">
            developers.eveonline.com
          </a>
          . Set the callback URL to <code>http://localhost:8642/sso/callback</code> and grant the scopes{' '}
          <code>esi-assets.read_assets.v1</code> and <code>esi-universe.read_structures.v1</code>. Paste the Client ID
          below.
        </p>
        <div className="settings-row">
          <label className="field-label">Client ID</label>
          <input type="text" value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="Client ID" />
        </div>
        <div className="settings-row">
          <label className="field-label">Contact email (sent in the ESI User-Agent, optional but recommended)</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
        </div>
        <button
          className="btn primary"
          onClick={() => save.mutate({ client_id: clientId, contact_email: email })}
          disabled={save.isPending}
        >
          Save application settings
        </button>
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
        <a
          className="btn"
          href="/sso/login"
          onClick={(e) => {
            if (!s.client_id) {
              e.preventDefault();
              toast('Save a Client ID first', 'error');
            }
          }}
        >
          + Add character
        </a>
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
    </div>
  );
}
