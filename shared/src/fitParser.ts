import { parsePaste } from './pasteParser.js';
import type { ParsedPasteLine } from './types.js';

export interface ParsedFit {
  /** Ship hull name from the header, e.g. "Loki". */
  shipName: string;
  /** Fit name from the header, e.g. "Bling Inside Link Logi". */
  fitName: string;
  /**
   * Every buyable line the fit implies, in display order: the ship hull first (qty 1),
   * then each fitted module/charge/drone. Repeated lines are kept separate (the server
   * merges + resolves them the same way it does a normal paste), so names are NOT validated
   * here.
   */
  lines: ParsedPasteLine[];
}

/** A pyfa/EFT header line: `[Ship, Fit name]`. */
const HEADER_RE = /^\[\s*(.+?)\s*,\s*(.+?)\s*\]$/;

/**
 * A bracketed placeholder in the fit body — pyfa writes `[Empty High slot]`,
 * `[Empty Med slot]`, `[Empty Rig slot]`, `[Empty Subsystem slot]` etc. for unfitted slots.
 * No item name is bracketed, so dropping every bracketed body line is safe and also covers
 * placeholder wording we haven't seen.
 */
const PLACEHOLDER_RE = /^\[.*\]$/;

/**
 * An EFT module *state* flag: pyfa appends ` /OFFLINE` to modules left offline (and the format
 * allows other `/word` suffixes). It says nothing about what to buy — an offline module is still
 * on the ship — so it's stripped and the module is kept. The leading whitespace is required:
 * a few item names contain a slash inside a word (`R.A.M.- Armor/Hull Tech`), none end in a
 * space-separated `/word`.
 */
const STATE_FLAG_RE = /\s+\/\w+\s*$/;

/**
 * Parse a pyfa/EFT fit paste into a ship + fit name + buyable lines. The first line must be
 * a `[Ship, Fit name]` header; the ship hull becomes the first line (qty 1) and the rest of
 * the block is parsed with the ordinary paste parser (blank section separators ignored,
 * `x`-suffixed counts honoured, repeated lines preserved, `[Empty ... slot]` placeholders
 * dropped). Returns null when there is no header line — i.e. the text isn't a fit.
 */
export function parseFit(text: string): ParsedFit | null {
  const raw = text.split(/\r?\n/);
  let headerIdx = -1;
  let shipName = '';
  let fitName = '';
  for (let i = 0; i < raw.length; i++) {
    const m = HEADER_RE.exec(raw[i]!.trim());
    if (m) {
      headerIdx = i;
      shipName = m[1]!.trim();
      fitName = m[2]!.trim();
      break;
    }
  }
  if (headerIdx === -1 || !shipName) return null;

  // Parse everything after the header as ordinary item lines (drops the header itself so it
  // isn't treated as an unmatched item). Empty-slot placeholders are blanked rather than
  // removed so the remaining lines keep their line numbers for error reporting; `/OFFLINE`
  // state flags are stripped off the module name they trail.
  const body = raw
    .slice(headerIdx + 1)
    .map((line) => {
      const trimmed = line.trim();
      if (PLACEHOLDER_RE.test(trimmed)) return '';
      return trimmed.replace(STATE_FLAG_RE, '');
    })
    .join('\n');
  const bodyLines = parsePaste(body).lines;

  // The hull is line 0 (qty 1). Its lineNumber is the header's own line for error reporting.
  const hullLine: ParsedPasteLine = {
    raw: raw[headerIdx]!,
    lineNumber: headerIdx + 1,
    name: shipName,
    quantity: 1,
  };

  return { shipName, fitName, lines: [hullLine, ...bodyLines] };
}
