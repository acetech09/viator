import { useState } from 'react';

/**
 * Small click-to-edit integer field used for the group/fit quantity multiplier. Commits a
 * positive int on Enter/blur, reverts on Escape or invalid input.
 *
 * The same underlying multiplier is editable from two places at once (the list header and the
 * sidebar group/fit list), so the field **re-syncs its draft whenever `value` changes from the
 * outside** — otherwise the paired input keeps showing its stale mount-time value.
 */
export function QtyInput({
  value,
  onCommit,
  ariaLabel,
  title,
  width = 48,
}: {
  value: number;
  onCommit: (n: number) => void;
  ariaLabel: string;
  title?: string;
  width?: number;
}) {
  const [draft, setDraft] = useState(String(value));
  const [lastValue, setLastValue] = useState(value);
  // Adjust state during render (React's documented pattern) when the committed value changes
  // elsewhere. commit()/Escape already reset the draft locally, so this only fires for outside edits.
  if (value !== lastValue) {
    setLastValue(value);
    setDraft(String(value));
  }

  function commit() {
    const n = parseInt(draft, 10);
    if (Number.isFinite(n) && n > 0 && n !== value) onCommit(n);
    else setDraft(String(value));
  }

  return (
    <input
      type="text"
      inputMode="numeric"
      aria-label={ariaLabel}
      title={title}
      style={{ width, textAlign: 'right', padding: '3px 6px' }}
      value={draft}
      onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ''))}
      onFocus={(e) => e.target.select()}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        else if (e.key === 'Escape') setDraft(String(value));
      }}
    />
  );
}
