import { useEffect, useRef, useState } from 'react';

/**
 * Click-to-edit text. Renders a span that becomes a text input on click; commits a
 * trimmed, non-empty, changed value on Enter/blur and restores on Escape. Used for the
 * list title on both the lists table and the detail header.
 */
export function EditableText({
  value,
  onCommit,
  className,
  inputClassName,
  inputSize,
  title = 'Click to rename',
}: {
  value: string;
  onCommit: (next: string) => void;
  className?: string;
  inputClassName?: string;
  /** HTML `size` for the input. Pass 1 when the input is width-controlled by CSS inside a
   * table cell, so its intrinsic size doesn't inflate the column's preferred width. */
  inputSize?: number;
  title?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== value) onCommit(trimmed);
    setEditing(false);
  };

  const cancel = () => {
    setDraft(value);
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        className={inputClassName}
        size={inputSize}
        value={draft}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          else if (e.key === 'Escape') cancel();
        }}
      />
    );
  }

  return (
    <span
      className={className}
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        setDraft(value);
        setEditing(true);
      }}
    >
      {value}
    </span>
  );
}
