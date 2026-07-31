import { useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { type PricedList } from '@viator/shared';
import { api } from '../api';
import { useToast } from '../toast';
import { useInvalidateList } from '../hooks/useInvalidateList';
import { useTypesIndex } from '../hooks/useTypesIndex';
import { GroupManager } from './GroupManager';
import { SuggestModal, type Suggestion } from './SuggestModal';

export function AddTab({ listId }: { listId: number }) {
  const toast = useToast();
  const { index } = useTypesIndex();

  const priced = useQuery<PricedList>({ queryKey: ['priced', listId], queryFn: () => api.pricedList(listId) });
  const activeGroupId = priced.data?.active_group_id;

  const qtyRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const [qty, setQty] = useState('');
  const [term, setTerm] = useState('');
  const [active, setActive] = useState(0);

  const suggestions: Suggestion[] = term.trim().length >= 2 && index ? index.search(term) : [];

  const invalidate = useInvalidateList(listId);

  const add = useMutation({
    mutationFn: (s: Suggestion) => {
      const n = parseInt(qty, 10);
      const quantity = Number.isFinite(n) && n > 0 ? n : 1;
      return api.addItem(listId, s.type_id, quantity, activeGroupId);
    },
    onSuccess: () => invalidate(),
    onError: (e: Error) => toast(`Add failed: ${e.message}`, 'error'),
  });

  function commit(s: Suggestion) {
    add.mutate(s);
    setTerm('');
    setActive(0);
    // Spreadsheet-like: return to the qty field and select it for the next entry.
    requestAnimationFrame(() => {
      qtyRef.current?.focus();
      qtyRef.current?.select();
    });
  }

  function onSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (suggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Tab') {
      // Tab cycles through suggestions rather than leaving the field.
      e.preventDefault();
      setActive((a) => (e.shiftKey ? (a - 1 + suggestions.length) % suggestions.length : (a + 1) % suggestions.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const pick = suggestions[Math.min(active, suggestions.length - 1)];
      if (pick) commit(pick);
    } else if (e.key === 'Escape') {
      setTerm('');
    }
  }

  const activeGroupName = priced.data?.groups.find((g) => g.id === activeGroupId)?.name;
  // Groupless = no add-groups at all; adds land in the flat, ungrouped list.
  const groupless = (priced.data?.groups.length ?? 0) === 0;

  return (
    <div className="col">
      <GroupManager
        listId={listId}
        groups={(priced.data?.groups ?? []).filter((g) => g.kind === 'manual')}
        activeGroupId={activeGroupId}
        groupless={groupless}
        totalGroups={priced.data?.groups.length ?? 0}
      />

      {!groupless && (
        <div className="muted" style={{ fontSize: 12 }}>
          Adding to <strong style={{ color: 'var(--text)' }}>{activeGroupName ?? '—'}</strong>
        </div>
      )}

      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div>
          <label className="field-label">Qty</label>
          <input
            ref={qtyRef}
            type="text"
            inputMode="numeric"
            style={{ width: 70 }}
            value={qty}
            placeholder="1"
            onChange={(e) => setQty(e.target.value.replace(/[^0-9]/g, ''))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey)) {
                e.preventDefault();
                searchRef.current?.focus();
              }
            }}
          />
        </div>
        <div style={{ flex: 1 }}>
          <label className="field-label">Item search</label>
          <div className="suggest-wrap">
            <input
              ref={searchRef}
              type="text"
              style={{ width: '100%' }}
              value={term}
              placeholder="Type an item name…"
              onChange={(e) => {
                setTerm(e.target.value);
                setActive(0);
              }}
              onKeyDown={onSearchKeyDown}
            />
            <SuggestModal items={suggestions} activeIndex={active} onPick={commit} onHover={setActive} />
          </div>
        </div>
      </div>

      <PasteBox listId={listId} groupId={activeGroupId} onImported={invalidate} />
    </div>
  );
}

function PasteBox({
  listId,
  groupId,
  onImported,
}: {
  listId: number;
  groupId: number | undefined;
  onImported: () => void;
}) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [errorLines, setErrorLines] = useState<string[]>([]);

  const importMut = useMutation({
    mutationFn: () => api.importPaste(listId, text, groupId),
    onSuccess: (r) => {
      setText('');
      setErrorLines([]);
      onImported();
      toast(`Imported ${r.added} item(s)`, 'success');
    },
    onError: (e: Error & { body?: any }) => {
      const errs: string[] = e.body?.errors ?? [];
      setErrorLines(errs);
      toast(errs.length ? `${errs.length} line(s) could not be matched` : `Import failed: ${e.message}`, 'error');
    },
  });

  return (
    <div className="col" style={{ gap: 6 }}>
      <label className="field-label">Paste a list (name + quantity; tab, comma, or space separated)</label>
      <textarea
        rows={8}
        value={text}
        placeholder={'Hobgoblin II\t10\nTritanium\t100000'}
        onChange={(e) => setText(e.target.value)}
      />
      {errorLines.length > 0 && (
        <div className="error-text">Unmatched lines:{'\n'}{errorLines.join('\n')}</div>
      )}
      <div>
        <button className="btn primary" disabled={!text.trim() || importMut.isPending} onClick={() => importMut.mutate()}>
          {importMut.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}
