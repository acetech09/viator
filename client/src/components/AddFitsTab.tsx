import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { type PricedGroup, type PricedList } from '@viator/shared';
import { api } from '../api';
import { useToast } from '../toast';
import { useConfirm } from '../confirm';
import { useInvalidateList } from '../hooks/useInvalidateList';
import { QtyInput } from './QtyInput';
import { EyeIcon } from './EyeIcon';
import { CostVolume } from './CostVolume';
import { ItemIcon } from './ItemIcon';

const FIT_PLACEHOLDER = `[Loki, Bling Inside Link Logi]

Damage Control II
Republic Fleet Large Shield Extender
Republic Fleet Large Shield Extender

Hornet EC-300 x10
Nanite Repair Paste x400`;

/**
 * "Add fits" subtab — a table of ship fits (each a kind='fit' add-group) plus a paste box.
 * Pasting a pyfa fit creates a new fit (qty 1); every fit contributes its items — scaled by
 * its per-fit quantity — to the same buy-list rollup as manual groups. Editing a fit re-opens
 * its original paste in the box below. There is no "active" fit: a paste always creates a new one.
 */
export function AddFitsTab({ listId }: { listId: number }) {
  const priced = useQuery<PricedList>({ queryKey: ['priced', listId], queryFn: () => api.pricedList(listId) });
  const fits = (priced.data?.groups ?? []).filter((g) => g.kind === 'fit');

  const [editingId, setEditingId] = useState<number | null>(null);
  const [text, setText] = useState('');

  function startEdit(fit: PricedGroup) {
    setEditingId(fit.id);
    setText(fit.raw_fit ?? '');
  }
  function resetBox() {
    setEditingId(null);
    setText('');
  }

  const editingFit = editingId != null ? fits.find((f) => f.id === editingId) : undefined;

  return (
    <div className="col">
      <FitManager fits={fits} listId={listId} editingId={editingId} onEdit={startEdit} />

      <FitPasteBox
        listId={listId}
        text={text}
        setText={setText}
        editingId={editingId}
        editingName={editingFit?.name}
        onDone={resetBox}
        onCancel={resetBox}
      />
    </div>
  );
}

/** The table of fits: ship icon, name, per-fit quantity, visibility, edit, delete. */
function FitManager({
  fits,
  listId,
  editingId,
  onEdit,
}: {
  fits: PricedGroup[];
  listId: number;
  editingId: number | null;
  onEdit: (fit: PricedGroup) => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const refresh = useInvalidateList(listId);

  const toggle = useMutation({
    mutationFn: ({ groupId, enabled }: { groupId: number; enabled: boolean }) =>
      api.updateGroup(listId, groupId, { enabled }),
    onSuccess: refresh,
    onError: (e: Error) => toast(`Could not toggle fit: ${e.message}`, 'error'),
  });

  const setQty = useMutation({
    mutationFn: ({ groupId, fit_qty }: { groupId: number; fit_qty: number }) =>
      api.updateFit(listId, groupId, { fit_qty }),
    onSuccess: refresh,
    onError: (e: Error) => toast(`Could not set fit quantity: ${e.message}`, 'error'),
  });

  const remove = useMutation({
    mutationFn: (groupId: number) => api.deleteGroup(listId, groupId),
    onSuccess: refresh,
    onError: (e: Error) => toast(`Could not delete fit: ${e.message}`, 'error'),
  });

  return (
    <section className="col" style={{ gap: 8 }}>
      <h3 style={{ margin: 0 }}>Fits</h3>

      {fits.length === 0 ? (
        <div className="muted" style={{ fontSize: 13, padding: '4px 0' }}>
          No fits yet. Paste a pyfa/EFT fit below to add one.
        </div>
      ) : (
        fits.map((f) => (
          <div key={f.id} className={`group-row ${f.id === editingId ? 'active' : ''} ${f.enabled ? '' : 'hidden'}`}>
            <button
              className={`eye-btn ${f.enabled ? '' : 'off'}`}
              title={f.enabled ? 'Visible in list — click to hide' : 'Hidden from list — click to show'}
              aria-label={f.enabled ? 'Hide fit from list' : 'Show fit in list'}
              onClick={() => toggle.mutate({ groupId: f.id, enabled: !f.enabled })}
            >
              <EyeIcon open={f.enabled} />
            </button>
            {f.ship_type_id != null && <ItemIcon typeId={f.ship_type_id} />}
            <div className="group-info" style={{ flex: 1, minWidth: 0 }}>
              <div className="group-name">{f.name}</div>
              <div className="muted row" style={{ fontSize: 12, gap: 6 }}>
                <span>{f.item_count} item type(s)</span>
                <span>·</span>
                <CostVolume isk={f.subtotal} volume={f.subtotal_volume} />
              </div>
            </div>
            <QtyInput
              value={f.fit_qty}
              onCommit={(fit_qty) => setQty.mutate({ groupId: f.id, fit_qty })}
              ariaLabel="Fit quantity"
              title="How many of this fit to buy"
              width={56}
            />
            <button className="btn small" title="Edit this fit's paste" onClick={() => onEdit(f)}>
              Edit
            </button>
            <button
              className="btn icon small danger"
              title="Delete fit and its items"
              onClick={async () => {
                const ok = await confirm({
                  title: 'Delete fit',
                  message: `Delete fit "${f.name}" and its items?`,
                  confirmLabel: 'Delete fit',
                });
                if (ok) remove.mutate(f.id);
              }}
            >
              ✕
            </button>
          </div>
        ))
      )}
    </section>
  );
}

/** Paste box that creates a new fit — or, when editing, overwrites an existing one. */
function FitPasteBox({
  listId,
  text,
  setText,
  editingId,
  editingName,
  onDone,
  onCancel,
}: {
  listId: number;
  text: string;
  setText: (t: string) => void;
  editingId: number | null;
  editingName: string | undefined;
  onDone: () => void;
  onCancel: () => void;
}) {
  const toast = useToast();
  const [errorLines, setErrorLines] = useState<string[]>([]);
  const invalidate = useInvalidateList(listId);

  const save = useMutation({
    mutationFn: async () => {
      if (editingId != null) await api.updateFit(listId, editingId, { text });
      else await api.createFit(listId, text);
    },
    onSuccess: () => {
      setErrorLines([]);
      invalidate();
      toast(editingId != null ? 'Fit updated' : 'Fit added', 'success');
      onDone();
    },
    onError: (e: Error & { body?: { errors?: string[]; error?: string } }) => {
      const errs = e.body?.errors ?? [];
      setErrorLines(errs);
      if (e.body?.error === 'not_a_fit') toast('No [Ship, Fit name] header found — is this a fit?', 'error');
      else toast(errs.length ? `${errs.length} line(s) could not be matched` : `Save failed: ${e.message}`, 'error');
    },
  });

  return (
    <div className="col" style={{ gap: 6 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
        <label className="field-label" style={{ margin: 0 }}>
          {editingId != null ? `Editing fit: ${editingName ?? ''}` : 'Paste a pyfa / EFT fit'}
        </label>
        {editingId != null && (
          <button className="btn icon small" title="Cancel edit — start a new fit instead" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
      <textarea
        rows={12}
        value={text}
        placeholder={FIT_PLACEHOLDER}
        onChange={(e) => setText(e.target.value)}
        style={{ fontFamily: 'monospace' }}
      />
      {errorLines.length > 0 && (
        <div className="error-text">
          Unmatched lines:{'\n'}
          {errorLines.join('\n')}
        </div>
      )}
      <div>
        <button className="btn primary" disabled={!text.trim() || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? 'Saving…' : editingId != null ? 'Update fit' : 'Add fit'}
        </button>
      </div>
    </div>
  );
}
