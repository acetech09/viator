import { useMemo } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { PricedGroup, PricedList } from '@viator/shared';
import { api } from '../../api';
import { useToast } from '../../toast';
import { useInvalidateList } from '../../hooks/useInvalidateList';
import { EyeIcon } from '../EyeIcon';
import { ItemIcon } from '../ItemIcon';
import { QtyCell } from '../QtyCell';
import { QtyInput } from '../QtyInput';
import { CostVolume } from '../CostVolume';
import { ItemNameCell, ItemTableHead, PriceVolCells, ownedInView, useItemMutations, type DeductView } from './shared';

/**
 * One table per group. In the Edit view rows are editable (item qty + fit multiplier) and show raw
 * quantities; in the Purchase view's Grouped option rows are read-only with existing stock
 * allocated top-to-bottom across enabled groups and covered rows struck through (excluded from
 * Copy). Groups collapse on header click (persisted by the parent).
 */
export function GroupedView({
  listId,
  priced,
  filterText,
  editable,
  showOwned,
  view,
  collapsed,
  onToggleCollapse,
  onCopy,
}: {
  listId: number;
  priced: PricedList | undefined;
  filterText: string;
  editable: boolean;
  showOwned: boolean;
  view: DeductView;
  collapsed: Set<number>;
  onToggleCollapse: (groupId: number) => void;
  onCopy: (lines: Array<{ name: string; quantity: number }>, label: string) => void;
}) {
  const groups = priced?.groups ?? [];

  // Deducted (Purchase/Transport) mode: allocate each type's owned quantity for the active view
  // across enabled groups in order (top-to-bottom) until exhausted. Key is `${groupId}:${typeId}`
  // → displayed (post-deduction) quantity for that line.
  const displayedByLine = useMemo(() => {
    const map = new Map<string, number>();
    if (editable) return map;
    const remaining = new Map<number, number>();
    for (const it of priced?.items ?? []) remaining.set(it.type_id, ownedInView(it, view));
    for (const g of groups) {
      if (!g.enabled) continue;
      for (const it of g.items) {
        const rem = remaining.get(it.type_id) ?? 0;
        const take = Math.min(rem, it.quantity);
        remaining.set(it.type_id, rem - take);
        map.set(`${g.id}:${it.type_id}`, it.quantity - take);
      }
    }
    return map;
  }, [priced, groups, editable, view]);

  if (groups.length === 0) {
    return <div className="empty-state">No groups yet.</div>;
  }
  return (
    <div className="col" style={{ gap: 16, padding: 4 }}>
      {groups.map((g) => (
        <GroupBlock
          key={g.id}
          listId={listId}
          group={g}
          filterText={filterText}
          editable={editable}
          showOwned={showOwned}
          collapsed={collapsed.has(g.id)}
          onToggleCollapse={() => onToggleCollapse(g.id)}
          displayedByLine={displayedByLine}
          onCopy={onCopy}
        />
      ))}
    </div>
  );
}

function GroupBlock({
  listId,
  group,
  filterText,
  editable,
  showOwned,
  collapsed,
  onToggleCollapse,
  displayedByLine,
  onCopy,
}: {
  listId: number;
  group: PricedGroup;
  filterText: string;
  editable: boolean;
  showOwned: boolean;
  collapsed: boolean;
  onToggleCollapse: () => void;
  displayedByLine: Map<string, number>;
  onCopy: (lines: Array<{ name: string; quantity: number }>, label: string) => void;
}) {
  const invalidate = useInvalidateList(listId);
  const toast = useToast();
  const { setQty, remove } = useItemMutations(listId, group.id);

  const toggle = useMutation({
    mutationFn: (enabled: boolean) => api.updateGroup(listId, group.id, { enabled }),
    onSuccess: invalidate,
    onError: (e: Error) => toast(`Could not toggle group: ${e.message}`, 'error'),
  });

  // The qty multiplier lives on `fit_qty` for both kinds; updateGroup sets it uniformly.
  const setMult = useMutation({
    mutationFn: (fit_qty: number) => api.updateGroup(listId, group.id, { fit_qty }),
    onSuccess: invalidate,
    onError: (e: Error) => toast(`Could not set quantity: ${e.message}`, 'error'),
  });

  const isFit = group.kind === 'fit';
  const mult = group.fit_qty;
  const showExpanded = mult > 1; // second read-only "expanded" column only earns its keep when scaling

  // Per-line displayed quantity: raw in Edit, owned-deducted (allocated) in Purchase.
  const displayedOf = (typeId: number, quantity: number) =>
    editable ? quantity : displayedByLine.get(`${group.id}:${typeId}`) ?? quantity;

  let visible = filterText
    ? group.items.filter((it) => it.name.toLowerCase().includes(filterText))
    : group.items;
  // Purchase view with owned hidden: drop lines fully covered by existing stock.
  if (!showOwned) visible = visible.filter((it) => displayedOf(it.type_id, it.quantity) > 0);

  // Hide a whole group in the Purchase view when nothing in it is left to buy.
  if (!editable && !showOwned && visible.length === 0) return null;

  // In Purchase mode the header subtotal and Copy follow the deducted (displayed) quantities.
  const subtotal = editable
    ? group.subtotal
    : group.items.reduce((s, it) => {
        const disp = displayedOf(it.type_id, it.quantity);
        return it.unit_price != null && disp > 0 ? s + it.unit_price * disp : s;
      }, 0);
  const subtotalVolume = editable
    ? group.subtotal_volume
    : group.items.reduce((s, it) => {
        const disp = displayedOf(it.type_id, it.quantity);
        return it.unit_volume != null && disp > 0 ? s + it.unit_volume * disp : s;
      }, 0);

  const copyLines = group.items.map((it) => ({ name: it.name, quantity: displayedOf(it.type_id, it.quantity) }));

  return (
    <div className={`group-block ${group.enabled ? '' : 'disabled'} ${collapsed ? 'collapsed' : ''}`}>
      <div
        className="group-head"
        role="button"
        aria-expanded={!collapsed}
        title={collapsed ? 'Click to expand' : 'Click to collapse'}
        onClick={onToggleCollapse}
      >
        <span className="group-caret" aria-hidden="true">
          {collapsed ? '▸' : '▾'}
        </span>
        <button
          className={`eye-btn ${group.enabled ? '' : 'off'}`}
          title={group.enabled ? 'Visible in rollup — click to hide' : 'Hidden from rollup — click to show'}
          aria-label={group.enabled ? 'Hide group from rollup' : 'Show group in rollup'}
          onClick={(e) => {
            e.stopPropagation();
            toggle.mutate(!group.enabled);
          }}
        >
          <EyeIcon open={group.enabled} />
        </button>
        {isFit && group.ship_type_id != null && <ItemIcon typeId={group.ship_type_id} />}
        <span className="group-name">{group.name}</span>
        <span className="muted" style={{ fontSize: 12 }}>
          {!editable && mult > 1 ? `×${mult} · ` : ''}
          {group.item_count} item type(s)
        </span>
        {editable && (
          <label
            className="row"
            style={{ gap: 4, fontSize: 12 }}
            title="Group quantity — multiplies every line"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="muted">×</span>
            <QtyInput
              value={mult}
              onCommit={(n) => setMult.mutate(n)}
              ariaLabel={isFit ? 'Fit quantity' : 'Group quantity'}
              title="Multiplies every line in this group"
            />
          </label>
        )}
        <span className="spacer" style={{ flex: 1 }} />
        <CostVolume isk={subtotal} volume={subtotalVolume} />
        <button
          className="btn small"
          disabled={group.items.length === 0}
          onClick={(e) => {
            e.stopPropagation();
            onCopy(copyLines, group.name);
          }}
        >
          Copy
        </button>
      </div>

      {collapsed ? null : group.items.length === 0 ? (
        <div className="muted" style={{ padding: '8px 10px', fontSize: 13 }}>
          {isFit
            ? 'Empty — edit this fit in the Add fits tab.'
            : 'Empty — set this group active in the Add items tab to add items here.'}
        </div>
      ) : (
        <table>
          <ItemTableHead expanded={showExpanded} removeCol={editable && !isFit} />
          <tbody>
            {visible.map((it) => {
              const disp = displayedOf(it.type_id, it.quantity);
              const covered = !editable && disp <= 0;
              return (
                <tr key={it.type_id} className={covered ? 'covered' : ''}>
                  {editable && !isFit ? (
                    <QtyCell
                      value={it.stored_quantity}
                      onCommit={(next) => setQty.mutate({ typeId: it.type_id, quantity: next })}
                    />
                  ) : (
                    <td className="num">{it.stored_quantity}</td>
                  )}
                  {showExpanded && <td className="num">{it.quantity}</td>}
                  <ItemNameCell
                    typeId={it.type_id}
                    name={it.name}
                    needed={!editable && it.quantity - disp > 0 && !covered ? disp : undefined}
                  />
                  <PriceVolCells unitPrice={it.unit_price} unitVolume={it.unit_volume} qty={disp} covered={covered} />
                  {editable && !isFit && (
                    <td>
                      <button
                        className="btn icon small danger"
                        title="Remove item from this group"
                        onClick={() => remove.mutate(it.type_id)}
                      >
                        ✕
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
