import { useState } from 'react';

/**
 * The image server serves blueprints under the `bp` variant, not `icon` — `/types/683/icon`
 * is an HTTP 400, which is why blueprints rendered as broken images. The name suffix picks
 * the likely variant up front, and the other one is tried on error, since neither signal is
 * airtight: ~160 special-edition blueprints aren't named "… Blueprint", and a handful of
 * ordinary commodities are ("Research Abstract: Project Blueprint").
 */
function variantsFor(name: string | undefined): Array<'icon' | 'bp'> {
  return name && /\bblueprint$/i.test(name.trim()) ? ['bp', 'icon'] : ['icon', 'bp'];
}

/**
 * 32px EVE type icon (item or ship hull) from the public image server. Pass `name` when it's
 * known so the right variant is tried first. Types the server has no art for under any
 * variant (every SKIN) end up as an empty tile rather than a broken-image glyph.
 */
export function ItemIcon({ typeId, name }: { typeId: number; name?: string }) {
  // Tracked with the type id so a recycled row (same component, new item) restarts at the
  // first variant instead of inheriting the previous item's failures.
  const [attempt, setAttempt] = useState<{ typeId: number; step: number }>({ typeId, step: 0 });
  const step = attempt.typeId === typeId ? attempt.step : 0;

  const variant = variantsFor(name)[step];
  if (!variant) return <span className="item-icon" aria-hidden="true" />;

  return (
    <img
      // Remount on variant change so the browser actually re-requests the new src.
      key={variant}
      className="item-icon"
      src={`https://images.evetech.net/types/${typeId}/${variant}?size=32`}
      alt=""
      loading="lazy"
      onError={() => setAttempt({ typeId, step: step + 1 })}
    />
  );
}
