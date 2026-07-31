import { useMemo } from 'react';
import type { PricedList } from '@viator/shared';
import { ItemNameCell, ItemTableHead, PriceVolCells, ownedInView, type DeductView } from './shared';

/**
 * Read-only aggregate of enabled groups, owned-deducted for the active view (Purchase or
 * Transport). Shown as the "Combined" layout option. `showOwned=false` drops rows fully covered
 * by that view's existing stock.
 */
export function RollupView({
  priced,
  filterText,
  showOwned,
  view,
}: {
  priced: PricedList | undefined;
  filterText: string;
  showOwned: boolean;
  view: DeductView;
}) {
  const items = priced?.items ?? [];
  const visible = useMemo(() => {
    let v = items;
    if (filterText) v = v.filter((it) => it.name.toLowerCase().includes(filterText));
    if (!showOwned) v = v.filter((it) => it.quantity - ownedInView(it, view) > 0);
    return v;
  }, [items, filterText, showOwned, view]);

  if (items.length === 0) {
    return <div className="empty-state">No items yet. Add some from the panel on the right.</div>;
  }
  if (visible.length === 0) {
    const msg =
      view === 'transport'
        ? 'Nothing left to transport — every item is already at the destination.'
        : 'Nothing left to buy — every item is covered by existing stock.';
    return <div className="empty-state">{msg}</div>;
  }

  return (
    <table>
      <ItemTableHead />
      <tbody>
        {visible.map((it) => {
          const owned = ownedInView(it, view);
          const displayed = it.quantity - owned;
          const covered = displayed <= 0;
          return (
            <tr key={it.type_id} className={covered ? 'covered' : ''}>
              <td className="num">{it.quantity}</td>
              <ItemNameCell
                typeId={it.type_id}
                name={it.name}
                needed={owned > 0 && !covered ? displayed : undefined}
              />
              <PriceVolCells unitPrice={it.unit_price} unitVolume={it.unit_volume} qty={displayed} covered={covered} />
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
