import { useEffect, useMemo, useRef, useState } from 'react';

export interface Option {
  value: number;
  label: string;
  sublabel?: string;
  iconUrl?: string;
}

interface Props {
  options: Option[];
  value: number | null;
  onChange: (value: number) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Wrapper min-width (default 180). */
  minWidth?: number | string;
  /** Wrapper max-width — caps growth so a long selected label truncates instead of widening. */
  maxWidth?: number | string;
}

export function FuzzySelect({ options, value, onChange, placeholder, disabled, minWidth = 180, maxWidth }: Props) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = options.find((o) => o.value === value) ?? null;

  const filtered = useMemo(() => {
    const f = term.trim().toLowerCase();
    if (!f) return options;
    return options.filter((o) => o.label.toLowerCase().includes(f) || o.sublabel?.toLowerCase().includes(f));
  }, [options, term]);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    requestAnimationFrame(() => inputRef.current?.focus());
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  function pick(o: Option) {
    onChange(o.value);
    setOpen(false);
    setTerm('');
  }

  return (
    <div className="suggest-wrap" ref={wrapRef} style={{ minWidth, maxWidth }}>
      <button
        type="button"
        className="btn"
        disabled={disabled}
        style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 8 }}
        onClick={() => setOpen((o) => !o)}
      >
        {selected?.iconUrl && <img className="char-portrait" style={{ width: 22, height: 22 }} src={selected.iconUrl} alt="" />}
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {selected ? selected.label : <span className="muted">{placeholder ?? 'Select…'}</span>}
        </span>
        <span className="muted">▾</span>
      </button>
      {open && (
        <div className="suggest-list">
          <div style={{ padding: 6 }}>
            <input
              ref={inputRef}
              type="text"
              style={{ width: '100%' }}
              placeholder="Search…"
              value={term}
              onChange={(e) => {
                setTerm(e.target.value);
                setActive(0);
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setActive((a) => Math.min(a + 1, filtered.length - 1));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setActive((a) => Math.max(a - 1, 0));
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  const o = filtered[active];
                  if (o) pick(o);
                } else if (e.key === 'Escape') {
                  setOpen(false);
                }
              }}
            />
          </div>
          {filtered.length === 0 && <div className="suggest-item muted">No matches</div>}
          {filtered.map((o, i) => (
            <div
              key={o.value}
              className={`suggest-item ${i === active ? 'active' : ''}`}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(o);
              }}
            >
              {o.iconUrl && <img className="char-portrait" style={{ width: 22, height: 22 }} src={o.iconUrl} alt="" />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.label}</div>
                {o.sublabel && <div className="muted" style={{ fontSize: 11 }}>{o.sublabel}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
