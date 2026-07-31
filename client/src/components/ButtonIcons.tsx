/**
 * Small feather-style glyphs for button labels (mono/flat line icons, not emoji). Stroke uses
 * currentColor so the parent button controls color; size + alignment come from `.btn-ico` in
 * theme.css. Match the drawing style of EyeIcon (24×24 viewBox, round caps, strokeWidth 2).
 */
const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  className: 'btn-ico',
  'aria-hidden': true,
} as const;

/** Feather "user" — the API-assets (per-character) affordance. */
export function PersonIcon() {
  return (
    <svg {...base}>
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

/** Feather "copy" — the Multibuy-copy affordance. */
export function CopyIcon() {
  return (
    <svg {...base}>
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

/** Feather "refresh-cw" — the pull-from-ESI affordance. */
export function RefreshIcon() {
  return (
    <svg {...base}>
      <path d="M23 4v6h-6" />
      <path d="M1 20v-6h6" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10" />
      <path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14" />
    </svg>
  );
}

/** Feather "clipboard" — the manual-paste affordance. */
export function ClipboardIcon() {
  return (
    <svg {...base}>
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
    </svg>
  );
}
