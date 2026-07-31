import { useState } from 'react';

interface Props {
  value: number;
  onCommit: (next: number) => void;
}

/**
 * Always-visible editable quantity field for a list line (Edit mode). Rendered as a real text
 * input so it reads as editable at a glance. Selects all on focus, commits a positive integer on
 * Enter/blur, reverts on Escape or invalid input (with a shake).
 *
 * Re-syncs its draft when `value` changes from elsewhere (e.g. the group multiplier), following
 * the same adjust-state-during-render pattern as `QtyInput`.
 */
export function QtyCell({ value, onCommit }: Props) {
  const [draft, setDraft] = useState(String(value));
  const [lastValue, setLastValue] = useState(value);
  const [shake, setShake] = useState(false);

  if (value !== lastValue) {
    setLastValue(value);
    setDraft(String(value));
  }

  function commit() {
    const n = parseInt(draft, 10);
    if (!Number.isFinite(n) || n <= 0) {
      setShake(true);
      setTimeout(() => setShake(false), 300);
      setDraft(String(value));
      return;
    }
    if (n !== value) onCommit(n);
  }

  return (
    <td className={`qty-cell num ${shake ? 'shake' : ''}`}>
      <input
        type="text"
        inputMode="numeric"
        aria-label="Quantity"
        value={draft}
        onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ''))}
        onFocus={(e) => e.target.select()}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          else if (e.key === 'Escape') {
            setDraft(String(value));
            e.currentTarget.blur();
          }
        }}
      />
    </td>
  );
}
