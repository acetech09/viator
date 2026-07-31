import type { PricedList } from '@viator/shared';
import { QtyCell } from '../QtyCell';
import { ItemNameCell, ItemTableHead, PriceVolCells, useItemMutations } from './shared';

/**
 * The Edit view for a **groupless** list: one flat, editable table straight off the rollup — no
 * group header, no multiplier. Same columns and affordances as a group's edit table (editable Qty
 * cell + remove ✕). Mutations target the ungrouped lines via the `groupId = 0` sentinel.
 */
export function FlatEditView({
  listId,
  priced,
  filterText,
}: {
  listId: number;
  priced: PricedList | undefined;
  filterText: string;
}) {
  const { setQty, remove } = useItemMutations(listId, 0);

  const items = priced?.items ?? [];
  const visible = filterText ? items.filter((it) => it.name.toLowerCase().includes(filterText)) : items;

  if (items.length === 0) {
    return <div className="empty-state">No items yet. Add some from the panel on the right.</div>;
  }

  return (
    <table>
      <ItemTableHead removeCol />
      <tbody>
        {visible.map((it) => (
          <tr key={it.type_id}>
            <QtyCell
              value={it.quantity}
              onCommit={(next) => setQty.mutate({ typeId: it.type_id, quantity: next })}
            />
            <ItemNameCell typeId={it.type_id} name={it.name} />
            <PriceVolCells unitPrice={it.unit_price} unitVolume={it.unit_volume} qty={it.quantity} />
            <td>
              <button
                className="btn icon small danger"
                title="Remove item from the list"
                onClick={() => remove.mutate(it.type_id)}
              >
                ✕
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
