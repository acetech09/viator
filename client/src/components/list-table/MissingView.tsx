import type { PricedItem } from '@viator/shared';
import { ItemNameCell, ItemTableHead, PriceVolCells } from './shared';

/** One pasted hauler-cargo line, deduped (case-insensitive name, quantities summed). */
export interface LoadedLine {
  name: string;
  quantity: number;
}

/**
 * The result of pressing Check in the Hauling-check tab. `token` bumps on every press so the
 * Missing-items tab re-focuses even when the cargo text didn't change.
 */
export interface HaulingCheck {
  loaded: LoadedLine[];
  token: number;
}

/** One list line the pasted cargo doesn't fully cover. */
export interface MissingRow {
  item: PricedItem;
  needed: number; // the baseline view's displayed quantity
  loaded: number; // pasted quantity for this type
  missing: number; // needed - loaded (> 0, or the row wouldn't be here)
}

/**
 * The spawned "Missing items" view: what the pasted hauler cargo still doesn't cover, compared
 * against the baseline view (Transport when destination stock exists, else Purchase, else the
 * raw list). Qty is the quantity still to load; a partially loaded line notes its progress.
 */
export function MissingView({
  rows,
  unmatched,
  baselineLabel,
  filterText,
}: {
  rows: MissingRow[];
  unmatched: LoadedLine[];
  baselineLabel: string;
  filterText: string;
}) {
  const visible = filterText ? rows.filter((r) => r.item.name.toLowerCase().includes(filterText)) : rows;

  return (
    <>
      <div className="muted" style={{ padding: '8px 10px 0', fontSize: 12 }}>
        Pasted cargo compared against the {baselineLabel}. Qty is what still needs to be loaded.
      </div>
      {rows.length === 0 ? (
        <div className="empty-state">Nothing missing — the pasted cargo covers the {baselineLabel}.</div>
      ) : visible.length === 0 ? (
        <div className="empty-state">No missing items match the filter.</div>
      ) : (
        <table>
          <ItemTableHead />
          <tbody>
            {visible.map((r) => (
              <tr key={r.item.type_id}>
                <td className="num">{r.missing}</td>
                <ItemNameCell
                  typeId={r.item.type_id}
                  name={r.item.name}
                  note={r.loaded > 0 ? `${r.loaded} of ${r.needed} loaded` : undefined}
                />
                <PriceVolCells unitPrice={r.item.unit_price} unitVolume={r.item.unit_volume} qty={r.missing} />
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {unmatched.length > 0 && (
        <div className="muted" style={{ padding: '10px', fontSize: 12 }}>
          In the paste but not on this list: {unmatched.map((u) => `${u.name} × ${u.quantity}`).join(', ')}
        </div>
      )}
    </>
  );
}
