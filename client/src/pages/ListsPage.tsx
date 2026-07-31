import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import type { ListOverview, ListOverviewEntry } from '@viator/shared';
import { api } from '../api';
import { useToast } from '../toast';
import { EditableText } from '../components/EditableText';
import { ItemIcon } from '../components/ItemIcon';
import { IskAmount, VolAmount } from '../components/CostVolume';

function formatDate(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** One card column: value-sorted preview lines (icon · name · × qty), fading past ~4. */
function PreviewColumn({ entries, empty }: { entries: ListOverviewEntry[]; empty: string }) {
  if (entries.length === 0) return <div className="list-card-preview muted">{empty}</div>;
  return (
    <div className={'list-card-preview' + (entries.length > 4 ? ' faded' : '')}>
      {entries.map((e, i) => (
        <div className="preview-line" key={`${e.type_id}:${i}`}>
          <ItemIcon typeId={e.type_id} name={e.name} />
          <span className="preview-name">{e.name}</span>
          <span className="preview-qty muted">× {e.quantity}</span>
        </div>
      ))}
    </div>
  );
}

function ListCard({
  list,
  onOpen,
  onRename,
  onDuplicate,
  onDelete,
}: {
  list: ListOverview;
  onOpen: () => void;
  onRename: (name: string) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  // An empty list has nothing to say in the stats or the previews — a row of zeros and em-dashes
  // is noise, so it collapses to a single "(empty)" marker beside the title.
  const empty = list.item_count === 0;
  return (
    <div className="list-card-row">
      <div className="list-card" onClick={onOpen}>
        <div className="list-card-head">
          <div className="list-card-title">
            <EditableText
              value={list.name}
              onCommit={onRename}
              className="editable-title"
              inputClassName="title-input"
            />
            {empty && <span className="list-card-empty muted">(empty)</span>}
          </div>
          <span className="list-card-edited muted">{formatDate(list.updated_at)}</span>
          {!empty && (
            <>
              <span className="list-card-stat">
                {list.item_count} {list.item_count === 1 ? 'item' : 'items'}
              </span>
              <span className="list-card-stat">
                <IskAmount value={list.total} />
              </span>
              <span className="list-card-stat vol">
                <VolAmount value={list.total_volume} />
              </span>
            </>
          )}
        </div>
        {!empty && (
          <div className="list-card-body">
            <PreviewColumn entries={list.top_items} empty="No items" />
            <PreviewColumn entries={list.top_fits} empty="No fits" />
          </div>
        )}
      </div>
      <div className="list-card-actions" onClick={(e) => e.stopPropagation()}>
        <button className="btn icon" title="Duplicate list" onClick={onDuplicate}>
          ⧉
        </button>
        <button className="btn icon danger" title="Delete list" onClick={onDelete}>
          ✕
        </button>
      </div>
    </div>
  );
}

export function ListsPage() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const toast = useToast();
  const lists = useQuery({ queryKey: ['lists'], queryFn: api.lists });

  const [query, setQuery] = useState('');
  const [newestFirst, setNewestFirst] = useState(true);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['lists'] });

  const create = useMutation({
    mutationFn: () => api.createList('New list'),
    onSuccess: (l) => {
      invalidate();
      nav(`/lists/${l.id}`);
    },
  });

  const duplicate = useMutation({
    mutationFn: (id: number) => api.duplicateList(id),
    onSuccess: () => {
      invalidate();
      toast('List duplicated', 'success');
    },
  });

  const remove = useMutation({
    mutationFn: (id: number) => api.deleteList(id),
    onSuccess: () => {
      invalidate();
      toast('List deleted', 'success');
    },
  });

  const rename = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) => api.renameList(id, name),
    onSuccess: () => invalidate(),
  });

  const visible = useMemo(() => {
    const all = lists.data ?? [];
    const q = query.trim().toLowerCase();
    const filtered = q ? all.filter((l) => l.name.toLowerCase().includes(q)) : all;
    return [...filtered].sort((a, b) => (newestFirst ? b.updated_at - a.updated_at : a.updated_at - b.updated_at));
  }, [lists.data, query, newestFirst]);

  return (
    <div className="lists-page">
      <button className="btn primary new-list-btn" onClick={() => create.mutate()} disabled={create.isPending}>
        + New list
      </button>

      <div className="lists-toolbar">
        <input
          type="text"
          className="lists-search"
          placeholder="Search lists…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          className="btn sort-btn"
          onClick={() => setNewestFirst((v) => !v)}
          title="Toggle sort order (by last modified)"
        >
          {newestFirst ? 'Newest first ↓' : 'Oldest first ↑'}
        </button>
      </div>

      {lists.data && lists.data.length === 0 && (
        <div className="empty-state">No lists yet. Create one to get started.</div>
      )}
      {lists.data && lists.data.length > 0 && visible.length === 0 && (
        <div className="empty-state">No lists match “{query.trim()}”.</div>
      )}

      <div className="list-cards">
        {visible.map((l) => (
          <ListCard
            key={l.id}
            list={l}
            onOpen={() => nav(`/lists/${l.id}`)}
            onRename={(name) => rename.mutate({ id: l.id, name })}
            onDuplicate={() => duplicate.mutate(l.id)}
            onDelete={() => {
              if (confirm(`Delete list "${l.name}"? This cannot be undone.`)) remove.mutate(l.id);
            }}
          />
        ))}
      </div>
    </div>
  );
}
