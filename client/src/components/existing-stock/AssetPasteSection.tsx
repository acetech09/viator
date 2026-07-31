import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { StockZone } from '@viator/shared';
import { api } from '../../api';
import { useToast } from '../../toast';
import { Toggle } from '../Toggle';

/**
 * Manual stock snapshots: paste a fresher hangar to compare while API assets are cached. Saved
 * pastes always list (toggle/remove); the entry box (textarea + Save / ✕ cancel) is shown only
 * when `open` — opened by the "Add manual paste filter" button in the API section's action row.
 */
export function AssetPasteSection({
  listId,
  zone,
  open,
  onClose,
}: {
  listId: number;
  zone: StockZone;
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [text, setText] = useState('');
  const [errorLines, setErrorLines] = useState<string[]>([]);

  const pastes = useQuery({ queryKey: ['asset-pastes', listId, zone], queryFn: () => api.assetPastes(listId, zone) });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['asset-pastes', listId, zone] });
    qc.invalidateQueries({ queryKey: ['priced', listId] });
  };

  const cancel = () => {
    setText('');
    setErrorLines([]);
    onClose();
  };

  const create = useMutation({
    mutationFn: () => api.createAssetPaste(listId, text, zone),
    onSuccess: (r) => {
      setText('');
      setErrorLines([]);
      refresh();
      onClose();
      toast(`Saved "${r.name}" (${r.added} item type(s))`, 'success');
    },
    onError: (e: Error & { body?: { errors?: string[] } }) => {
      const errs = e.body?.errors ?? [];
      setErrorLines(errs);
      toast(errs.length ? `${errs.length} line(s) could not be matched` : `Save failed: ${e.message}`, 'error');
    },
  });

  const toggle = useMutation({
    mutationFn: ({ pasteId, enabled }: { pasteId: number; enabled: boolean }) =>
      api.setAssetPasteEnabled(listId, pasteId, enabled),
    onSuccess: refresh,
    onError: (e: Error) => toast(`Could not update paste: ${e.message}`, 'error'),
  });

  const remove = useMutation({
    mutationFn: (pasteId: number) => api.removeAssetPaste(listId, pasteId),
    onSuccess: refresh,
    onError: (e: Error) => toast(`Could not remove paste: ${e.message}`, 'error'),
  });

  const rows = pastes.data ?? [];

  return (
    <section className="col" style={{ gap: 8 }}>
      {rows.map((p) => (
        <div key={p.id} className={`char-card ${p.enabled ? '' : 'muted'}`}>
          <Toggle
            checked={p.enabled}
            title="Subtract this paste"
            onChange={(v) => toggle.mutate({ pasteId: p.id, enabled: v })}
          />
          <div style={{ flex: 1 }}>
            <div>{p.name}</div>
            <div className="muted" style={{ fontSize: 12 }}>
              {p.item_count} item type(s) · {p.total_quantity.toLocaleString()} units
            </div>
          </div>
          <button className="btn small danger" onClick={() => remove.mutate(p.id)}>
            Remove
          </button>
        </div>
      ))}

      {open && (
        <div className="col paste-entry" style={{ gap: 8 }}>
          <label className="field-label">Paste a list (name + quantity; tab, comma, or space separated)</label>
          <textarea
            rows={6}
            value={text}
            autoFocus
            placeholder={'Hobgoblin II\t10\nTritanium\t100000'}
            onChange={(e) => setText(e.target.value)}
          />
          {errorLines.length > 0 && (
            <div className="error-text">
              Unmatched lines:{'\n'}
              {errorLines.join('\n')}
            </div>
          )}
          <div className="row" style={{ gap: 8 }}>
            <button className="btn primary" disabled={!text.trim() || create.isPending} onClick={() => create.mutate()}>
              {create.isPending ? 'Saving…' : 'Save paste'}
            </button>
            <button className="btn icon small" title="Cancel" aria-label="Cancel paste" onClick={cancel}>
              ✕
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
