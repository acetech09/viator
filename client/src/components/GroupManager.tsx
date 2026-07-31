import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { type PricedGroup } from '@viator/shared';
import { api } from '../api';
import { useToast } from '../toast';
import { useInvalidateList } from '../hooks/useInvalidateList';
import { QtyInput } from './QtyInput';
import { CostVolume } from './CostVolume';
import { EyeIcon } from './EyeIcon';

/**
 * Enumerated manual add-groups (fits live in their own tab): pick the active one, rename
 * (double-click or ✎), toggle visibility, set the × quantity multiplier, delete, or create.
 * On a groupless list shows just "+ New group" (which server-side promotes the list to
 * grouped mode).
 */
export function GroupManager({
  listId,
  groups,
  activeGroupId,
  groupless,
  totalGroups,
}: {
  listId: number;
  groups: PricedGroup[];
  activeGroupId: number | undefined;
  groupless: boolean;
  totalGroups: number;
}) {
  const toast = useToast();
  const [renaming, setRenaming] = useState<number | null>(null);
  const [draft, setDraft] = useState('');

  const refresh = useInvalidateList(listId);

  const setActive = useMutation({
    mutationFn: (groupId: number) => api.setActiveGroup(listId, groupId),
    onSuccess: refresh,
    onError: (e: Error) => toast(`Could not set active group: ${e.message}`, 'error'),
  });

  const toggle = useMutation({
    mutationFn: ({ groupId, enabled }: { groupId: number; enabled: boolean }) =>
      api.updateGroup(listId, groupId, { enabled }),
    onSuccess: refresh,
    onError: (e: Error) => toast(`Could not toggle group: ${e.message}`, 'error'),
  });

  const rename = useMutation({
    mutationFn: ({ groupId, name }: { groupId: number; name: string }) => api.updateGroup(listId, groupId, { name }),
    onSuccess: refresh,
    onError: (e: Error) => toast(`Could not rename group: ${e.message}`, 'error'),
  });

  const setMult = useMutation({
    mutationFn: ({ groupId, fit_qty }: { groupId: number; fit_qty: number }) =>
      api.updateGroup(listId, groupId, { fit_qty }),
    onSuccess: refresh,
    onError: (e: Error) => toast(`Could not set quantity: ${e.message}`, 'error'),
  });

  const remove = useMutation({
    mutationFn: (groupId: number) => api.deleteGroup(listId, groupId),
    onSuccess: refresh,
    onError: (e: Error) => toast(`Could not delete group: ${e.message}`, 'error'),
  });

  const create = useMutation({
    mutationFn: () => api.createGroup(listId),
    onSuccess: refresh,
    onError: (e: Error) => toast(`Could not create group: ${e.message}`, 'error'),
  });

  function startRename(g: PricedGroup) {
    setRenaming(g.id);
    setDraft(g.name);
  }
  function commitRename(groupId: number) {
    const name = draft.trim();
    if (name) rename.mutate({ groupId, name });
    setRenaming(null);
  }

  return (
    <section className="col" style={{ gap: 8 }}>
      {!groupless && <h3 style={{ margin: 0 }}>Groups</h3>}

      {groups.map((g) => (
        <div
          key={g.id}
          className={`group-row ${g.id === activeGroupId ? 'active' : ''} ${g.enabled ? '' : 'hidden'}`}
        >
          <button
            className={`active-arrow ${g.id === activeGroupId ? 'is-active' : ''}`}
            title={g.id === activeGroupId ? 'Active — new adds land here' : 'Set active — new adds land here'}
            aria-pressed={g.id === activeGroupId}
            onClick={() => setActive.mutate(g.id)}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="4" y1="12" x2="18" y2="12" />
              <polyline points="12 6 19 12 12 18" />
            </svg>
          </button>
          <button
            className={`eye-btn ${g.enabled ? '' : 'off'}`}
            title={g.enabled ? 'Visible in list — click to hide' : 'Hidden from list — click to show'}
            aria-label={g.enabled ? 'Hide group from list' : 'Show group in list'}
            onClick={() => toggle.mutate({ groupId: g.id, enabled: !g.enabled })}
          >
            <EyeIcon open={g.enabled} />
          </button>
          <div className="group-info" style={{ flex: 1, minWidth: 0 }}>
            {renaming === g.id ? (
              <input
                type="text"
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => commitRename(g.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename(g.id);
                  else if (e.key === 'Escape') setRenaming(null);
                }}
                style={{ width: '100%', padding: '3px 6px' }}
              />
            ) : (
              <div
                className="group-name"
                onDoubleClick={() => startRename(g)}
                title="Double-click to rename"
                style={{ cursor: 'text' }}
              >
                {g.name}
              </div>
            )}
            <div className="muted row" style={{ fontSize: 12, gap: 6 }}>
              <span>{g.item_count} item type(s)</span>
              <span>·</span>
              <CostVolume isk={g.subtotal} volume={g.subtotal_volume} />
            </div>
          </div>
          <label className="row" style={{ gap: 3, fontSize: 12 }} title="Group quantity — multiplies every line">
            <span className="muted">×</span>
            <QtyInput
              value={g.fit_qty}
              onCommit={(fit_qty) => setMult.mutate({ groupId: g.id, fit_qty })}
              ariaLabel="Group quantity"
              title="How many of this group to buy (multiplies every line)"
            />
          </label>
          <button className="btn icon small" title="Rename group" onClick={() => startRename(g)}>
            ✎
          </button>
          <button
            className="btn icon small danger"
            title="Delete group and its items"
            onClick={() => {
              // Deleting the very last group returns the list to the flat, ungrouped state and
              // KEEPS its items (they become ungrouped) rather than deleting them.
              const msg =
                totalGroups === 1
                  ? `Delete group "${g.name}"? Its items are kept as an ungrouped list.`
                  : `Delete group "${g.name}" and its items?`;
              if (window.confirm(msg)) remove.mutate(g.id);
            }}
          >
            ✕
          </button>
        </div>
      ))}

      <div>
        <button className="btn small" disabled={create.isPending} onClick={() => create.mutate()}>
          + New group
        </button>
      </div>
    </section>
  );
}
