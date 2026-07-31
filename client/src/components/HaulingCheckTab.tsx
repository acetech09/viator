import { parsePaste } from '@viator/shared';
import { useToast } from '../toast';
import type { LoadedLine } from './list-table/MissingView';

/**
 * The "Hauling check" right-panel tab: paste what's loaded in the hauler, hit Check, and a
 * "Missing items" tab spawns (and focuses) in the left panel with whatever the cargo doesn't
 * yet cover. Text + result state live in ListDetailPage so they survive subtab switches.
 */
export function HaulingCheckTab({
  text,
  onTextChange,
  onCheck,
}: {
  text: string;
  onTextChange: (t: string) => void;
  onCheck: (loaded: LoadedLine[]) => void;
}) {
  const toast = useToast();

  function check() {
    const { lines } = parsePaste(text);
    if (lines.length === 0) {
      toast('Nothing to check — paste the hauler cargo first', 'info');
      return;
    }
    // Dedupe case-insensitively (an inventory paste can repeat a type across stacks).
    const byKey = new Map<string, LoadedLine>();
    for (const l of lines) {
      const k = l.name.toLowerCase();
      const cur = byKey.get(k);
      if (cur) cur.quantity += l.quantity;
      else byKey.set(k, { name: l.name, quantity: l.quantity });
    }
    onCheck([...byKey.values()]);
  }

  return (
    <div className="col" style={{ gap: 6 }}>
      <label className="field-label">Paste the hauler's cargo (copy the ship's inventory in-game)</label>
      <textarea
        rows={14}
        value={text}
        placeholder={'Tritanium\t100000\nHobgoblin II\t10'}
        onChange={(e) => onTextChange(e.target.value)}
      />
      <div className="muted" style={{ fontSize: 12 }}>
        Compares the pasted cargo against the list (the Transport view when destination stock is
        set up, else the Purchase view) and opens a “Missing items” tab on the left showing what
        still needs to be loaded.
      </div>
      <div>
        <button className="btn primary" disabled={!text.trim()} onClick={check}>
          Check
        </button>
      </div>
    </div>
  );
}
