# shared — pure DTOs + logic

The only workspace with unit tests. Everything here is **pure** (no I/O), imported by both
server and client as `@viator/shared`. Compiled by `tsc` to `dist/` (ESM); consumers import
the built output, so relative imports inside end in `.js`.

## Files

- `src/types.ts` — all DTOs crossing the API boundary: `Settings`, `ListSummary`,
  `ListOverview` (the lists-index card: totals + capped value-sorted `top_items`/`top_fits`
  previews), `PricedItem`/`PricedList`, `CharacterSummary`, `LocationSummary`, `FilterRow`,
  `SdeStatus`, `AssetRefreshStatus`, etc. Change a shape here and both sides see it.
- `src/format.ts`
  - `formatIsk(n)` — 3 significant figures + `b`/`m`/`k` suffix; `null`/`NaN` → `—`;
    keeps sign. (`184500` → `185k` because it rounds at 3 sig figs — intentional.)
  - `formatVolume(n)` — m³ with only a `k` suffix: plain `m³` below 1000 (`742 m³`), 3-sig-fig
    `k m³` from a thousand up (`12.3k m³`), and **above 999k it keeps `k` and just grows digits**
    (`1_500_000` → `1500k m³` — deliberately no `M`). `null`/`NaN` → `—`; keeps sign.
  - `toMultibuy(items)` — `Name<space>Qty` per line, **omits qty ≤ 0**. Used for the
    clipboard export.
- `src/pasteParser.ts` — `parsePaste(text)`. Per non-blank line: split by tab, else comma,
  else whitespace. Quantity is the last pure-number token, else the first, else absent
  (qty 1). Accepts `x`-prefix and thousand separators. **Never validates names** — the
  server resolves names against the SDE so it can enforce all-or-nothing commits.
- `src/fitParser.ts` — `parseFit(text)`. Splits a pyfa/EFT fit: the first `[Ship, Fit name]`
  header gives the hull + fit name; the hull becomes line 0 (qty 1) and the body is run through
  `parsePaste` (blank section separators ignored, `x`-suffixes honoured, repeated lines kept).
  Returns `null` when there is no header line. Like `parsePaste`, it **never validates names**.
  Body lines wrapped in brackets are **empty-slot placeholders** (`[Empty High slot]`, …) and
  are dropped — no item name is bracketed, so the whole `^\[.*\]$` shape is filtered, which
  also covers placeholder wording we haven't seen. They're **blanked in place**, not spliced
  out, so the surviving lines keep their line numbers for unmatched-name error reporting.

## Tests

`src/*.test.ts` (vitest). Cover formatIsk boundaries, every paste column-order case
(tab/comma/space, qty-first vs qty-last, `Hobgoblin II` roman-numeral safety, x-prefix), and
`parseFit` (header extraction, hull line, repeated-line/`x`-suffix handling, hyphenated
subsystem names, empty-slot placeholders, no-header → null).
Run via `npm test` from the root or `npm -w shared run test`.

Excluded from the build via `tsconfig.json` `exclude: ["**/*.test.ts"]`.
