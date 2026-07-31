import { useMutation } from '@tanstack/react-query';
import { formatIsk, formatVolume, type PricedItem } from '@viator/shared';
import { api } from '../../api';
import { useToast } from '../../toast';
import { useInvalidateList } from '../../hooks/useInvalidateList';
import { ItemIcon } from '../ItemIcon';

// The two owned-deducted views. Purchase nets out stock at BOTH the purchase location and the
// destination; Transport nets out destination stock only (purchase-location stock still has to
// be hauled, so it stays on the transport list).
export type DeductView = 'purchase' | 'transport';

/** Owned stock a given deducted view nets out for one rollup line. */
export function ownedInView(it: PricedItem, view: DeductView): number {
  return view === 'purchase' ? it.owned_purchase + it.owned_destination : it.owned_destination;
}

/**
 * Set-qty / remove mutations for one group's item lines (or the ungrouped flat list via the
 * `groupId = 0` sentinel). Shared by FlatEditView and GroupBlock.
 */
export function useItemMutations(listId: number, groupId: number) {
  const invalidate = useInvalidateList(listId);
  const toast = useToast();
  const setQty = useMutation({
    mutationFn: ({ typeId, quantity }: { typeId: number; quantity: number }) =>
      api.setGroupItemQty(listId, groupId, typeId, quantity),
    onSuccess: invalidate,
    onError: (e: Error) => toast(`Update failed: ${e.message}`, 'error'),
  });
  const remove = useMutation({
    mutationFn: (typeId: number) => api.removeGroupItem(listId, groupId, typeId),
    onSuccess: invalidate,
    onError: (e: Error) => toast(`Remove failed: ${e.message}`, 'error'),
  });
  return { setQty, remove };
}

/**
 * The standard item-table header: Qty / Item / Unit / Unit m³ / Total / Total m³, with an
 * optional "Expanded" column (qty × group multiplier) and an optional trailing remove-button
 * column. Every item table in the list panel uses this so the column set stays in lockstep.
 */
export function ItemTableHead({ expanded = false, removeCol = false }: { expanded?: boolean; removeCol?: boolean }) {
  return (
    <thead>
      <tr>
        <th className="num" style={{ width: 70 }}>
          Qty
        </th>
        {expanded && (
          <th className="num" style={{ width: 80 }} title="Qty × group multiplier">
            Expanded
          </th>
        )}
        <th>Item</th>
        <th className="num">Unit</th>
        <th className="num" title="Volume per unit">Unit m³</th>
        <th className="num">Total</th>
        <th className="num" title="Total volume for the quantity needed">Total m³</th>
        {removeCol && <th style={{ width: 32 }}></th>}
      </tr>
    </thead>
  );
}

/**
 * Item cell: icon + name, plus an optional muted parenthetical — either the standard
 * "(N needed)" partial-stock note via `needed`, or a free-form `note` (e.g. the Missing-items
 * view's "x of y loaded").
 */
export function ItemNameCell({
  typeId,
  name,
  needed,
  note,
}: {
  typeId: number;
  name: string;
  needed?: number;
  note?: string;
}) {
  const suffix = note ?? (needed != null ? `${needed} needed` : null);
  return (
    <td>
      <span className="item-name">
        <ItemIcon typeId={typeId} name={name} />
        {name}
        {suffix != null && (
          <span className="muted" style={{ fontSize: 12 }}>
            &nbsp;({suffix})
          </span>
        )}
      </span>
    </td>
  );
}

/**
 * The four price/volume cells of an item row: Unit / Unit m³ / Total / Total m³. Extended
 * figures follow `qty` (the post-deduction displayed quantity); a fully covered row shows —.
 */
export function PriceVolCells({
  unitPrice,
  unitVolume,
  qty,
  covered = false,
}: {
  unitPrice: number | null;
  unitVolume: number | null;
  qty: number;
  covered?: boolean;
}) {
  const extended = unitPrice != null ? unitPrice * Math.max(0, qty) : null;
  const extendedVol = unitVolume != null ? unitVolume * Math.max(0, qty) : null;
  return (
    <>
      <td className="num">{formatIsk(unitPrice)}</td>
      <td className="num vol">{formatVolume(unitVolume)}</td>
      <td className="num">{covered ? '—' : formatIsk(extended)}</td>
      <td className="num vol">{covered ? '—' : formatVolume(extendedVol)}</td>
    </>
  );
}
