export interface Suggestion {
  type_id: number;
  name: string;
}

interface Props {
  items: Suggestion[];
  activeIndex: number;
  onPick: (s: Suggestion) => void;
  onHover: (index: number) => void;
}

export function SuggestModal({ items, activeIndex, onPick, onHover }: Props) {
  if (items.length === 0) return null;
  return (
    <div className="suggest-list" role="listbox">
      {items.map((s, i) => (
        <div
          key={s.type_id}
          role="option"
          aria-selected={i === activeIndex}
          className={`suggest-item ${i === activeIndex ? 'active' : ''}`}
          onMouseEnter={() => onHover(i)}
          onMouseDown={(e) => {
            // mousedown (not click) so the field's blur doesn't fire first
            e.preventDefault();
            onPick(s);
          }}
        >
          <img
            className="item-icon"
            src={`https://images.evetech.net/types/${s.type_id}/icon?size=32`}
            alt=""
            loading="lazy"
          />
          <span>{s.name}</span>
        </div>
      ))}
    </div>
  );
}
