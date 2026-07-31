import type { ParsedPasteLine } from './types.js';

export interface PasteParseResult {
  lines: ParsedPasteLine[];
  /** Lines we couldn't split into a plausible name (never a hard error on its own). */
  emptyLineNumbers: number[];
}

/** A token is a "pure number" if it's digits with optional thousand separators / decimal
 * and an optional leading `x` or trailing `x` (e.g. "x10", "10x", "1,000"). */
const NUMBER_RE = /^x?([0-9][0-9.,]*)x?$/i;

function parseQuantityToken(token: string): number | null {
  const m = NUMBER_RE.exec(token.trim());
  if (!m) return null;
  // Remove thousand separators. Treat commas and spaces as separators; a lone dot
  // could be decimal but EVE quantities are integers, so drop everything non-digit.
  const digits = m[1]!.replace(/[.,]/g, '');
  if (!/^[0-9]+$/.test(digits)) return null;
  const n = parseInt(digits, 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse a pasted bulk block into name/quantity pairs. Column order is auto-detected:
 * for each non-blank line we split by tab (if present), else comma, else whitespace,
 * then decide which cell is the quantity:
 *   - if the LAST token is a pure number -> name = the rest, qty = last  (qty-last, most common)
 *   - else if the FIRST token is a pure number -> qty = first, name = rest (qty-first)
 *   - else the whole line is the name, qty = 1
 * This never validates names against the SDE — the caller does that separately so it can
 * enforce all-or-nothing commits.
 */
export function parsePaste(text: string): PasteParseResult {
  const lines: ParsedPasteLine[] = [];
  const emptyLineNumbers: number[] = [];
  const rawLines = text.split(/\r?\n/);

  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i]!;
    const lineNumber = i + 1;
    if (raw.trim() === '') continue;

    let cells: string[];
    if (raw.includes('\t')) cells = raw.split('\t');
    else if (raw.includes(',')) cells = raw.split(',');
    else cells = raw.trim().split(/\s+/);
    cells = cells.map((c) => c.trim()).filter((c) => c.length > 0);

    if (cells.length === 0) {
      emptyLineNumbers.push(lineNumber);
      continue;
    }

    let name: string;
    let quantity: number;

    if (cells.length === 1) {
      // Single token line: it's a name with implicit qty 1 (a lone number is a weird
      // paste — treat it as a name so validation flags it rather than silently dropping).
      name = cells[0]!;
      quantity = 1;
    } else {
      const lastQty = parseQuantityToken(cells[cells.length - 1]!);
      const firstQty = parseQuantityToken(cells[0]!);
      if (lastQty !== null) {
        quantity = lastQty;
        name = cells.slice(0, -1).join(' ');
      } else if (firstQty !== null) {
        quantity = firstQty;
        name = cells.slice(1).join(' ');
      } else {
        name = cells.join(' ');
        quantity = 1;
      }
    }

    name = name.trim();
    if (name === '') {
      emptyLineNumbers.push(lineNumber);
      continue;
    }
    if (quantity <= 0) quantity = 1;
    lines.push({ raw, lineNumber, name, quantity });
  }

  return { lines, emptyLineNumbers };
}
