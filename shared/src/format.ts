// ISK formatting and Multibuy export helpers.

/**
 * Format an ISK amount to 3 significant digits with a b/m/k suffix.
 *   1_234_567_890 -> "1.23b"
 *          45_600 -> "45.6k"
 *             999 -> "999"
 *            0.5  -> "0.5"
 * Negative values keep their sign. null/NaN render as an em-dash.
 */
export function formatIsk(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  if (value === 0) return '0';
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);

  const units: Array<[number, string]> = [
    [1_000_000_000, 'b'],
    [1_000_000, 'm'],
    [1_000, 'k'],
  ];
  for (const [scale, suffix] of units) {
    if (abs >= scale) {
      return sign + threeSigFigs(abs / scale) + suffix;
    }
  }
  return sign + threeSigFigs(abs);
}

/**
 * Format a volume (in m³) for display alongside ISK.
 *   742      -> "742 m³"        (up to three plain-m³ digits)
 *   5.2      -> "5.2 m³"
 *   12_300   -> "12.3k m³"      (rounds to 'k' once it reaches a thousand)
 *   742_000  -> "742k m³"       (three-digit k)
 *   1_500_000-> "1500k m³"      (above three-digit k, digits just keep growing — no 'M')
 * Negative values keep their sign. null/NaN render as an em-dash.
 */
export function formatVolume(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  if (value === 0) return '0 m³';
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  if (abs < 1000) return sign + threeSigFigs(abs) + ' m³';
  const k = abs / 1000;
  // Below a thousand-k, keep three significant figures; above it, let the digit count grow.
  const body = k < 1000 ? threeSigFigs(k) : String(Math.round(k));
  return sign + body + 'k m³';
}

/** Render a number to 3 significant figures, trimming trailing zeros. */
function threeSigFigs(n: number): string {
  if (n === 0) return '0';
  const digitsBeforePoint = Math.floor(Math.log10(n)) + 1;
  const decimals = Math.max(0, 3 - digitsBeforePoint);
  // toFixed then strip trailing zeros / trailing dot.
  let s = n.toFixed(decimals);
  if (s.includes('.')) s = s.replace(/\.?0+$/, '');
  return s;
}

/**
 * Build an EVE Multibuy block: one "Item Name Quantity" line per entry.
 * Entries with quantity <= 0 are omitted.
 */
export function toMultibuy(items: Array<{ name: string; quantity: number }>): string {
  return items
    .filter((it) => it.quantity > 0)
    .map((it) => `${it.name} ${it.quantity}`)
    .join('\n');
}
