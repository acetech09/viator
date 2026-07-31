import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { Settings } from '@viator/shared';
import { api } from '../api';
import { useToast } from '../toast';

/**
 * The "EVE application Client ID" sub-page of Advanced settings: an optional override of the
 * bundled application (Client ID + the contact email sent in the ESI User-Agent).
 */
export function EveApplicationPanel({ onBack }: { onBack: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.getSettings });

  const save = useMutation({
    mutationFn: (patch: Partial<Settings>) => api.updateSettings(patch),
    onSuccess: (s) => {
      qc.setQueryData(['settings'], s);
      toast('Settings saved', 'success');
    },
  });

  const [clientId, setClientId] = useState('');
  const [email, setEmail] = useState('');
  useEffect(() => {
    if (settings.data) {
      // Leave the field blank when we're on the bundled app — it's an override, not a copy.
      setClientId(settings.data.client_id_is_default ? '' : settings.data.client_id);
      setEmail(settings.data.contact_email);
    }
  }, [settings.data]);

  if (!settings.data) return <div className="muted">Loading…</div>;
  const s = settings.data;

  return (
    <div className="settings-page">
      <div className="page-header">
        <button className="btn small" onClick={onBack}>
          ← Advanced
        </button>
        <h1>EVE application Client ID</h1>
      </div>

      <div className="settings-section">
        <p className="muted" style={{ marginTop: 0 }}>
          {s.client_id_is_default && s.client_id
            ? 'Viator ships with its own registered EVE application, so you normally do not need anything here.'
            : 'Viator normally ships with its own EVE application; this build has none bundled, so enter a Client ID below.'}
        </p>
        <p className="muted">
          To use your own application instead, register a native application at{' '}
          <a href="https://developers.eveonline.com/applications" target="_blank" rel="noreferrer">
            developers.eveonline.com
          </a>
          . Set the callback URL to <code>http://localhost:8642/sso/callback</code> and grant the scopes{' '}
          <code>esi-assets.read_assets.v1</code> and <code>esi-universe.read_structures.v1</code>. Paste the Client ID
          below — leave it blank to use the built-in application. Changing it means re-authorizing your characters.
        </p>
        <div className="settings-row">
          <label className="field-label">Client ID</label>
          <input
            type="text"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder={s.client_id_is_default && s.client_id ? 'Using the built-in application' : 'Client ID'}
          />
        </div>
        <div className="settings-row">
          <label className="field-label">Contact email (sent in the ESI User-Agent, optional)</label>
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
    </div>
  );
}
