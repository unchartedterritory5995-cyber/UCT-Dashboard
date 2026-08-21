// app/src/components/ui/UIcon.jsx
//
// UCT Intelligence branded icon set — the single source of truth for UI
// iconography across the dashboard. Replaces generic/system emoji with a
// cohesive, custom line-icon family in the brand's clean geometric style.
//
// - Stroke-based, `currentColor` → each icon inherits its surface's color
//   (e.g. nav active = green, muted elsewhere, gold on premium surfaces).
// - 24×24 viewBox, round caps/joins, ~1.7 stroke for an engraved, premium feel.
//
// Usage:  <UIcon name="journal" size={18} />
//         <UIcon name="flag" className={styles.icon} />
//
// When a surface wants an emoji, reach for a name here instead. Add new glyphs
// to ICONS below rather than introducing a one-off emoji.

const ICONS = {
  // ── Navigation ──────────────────────────────────────────────────────────
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.6" />
      <rect x="14" y="3" width="7" height="7" rx="1.6" />
      <rect x="3" y="14" width="7" height="7" rx="1.6" />
      <rect x="14" y="14" width="7" height="7" rx="1.6" />
    </>
  ),
  wire: (
    <>
      <path d="M4 5.5h11v13.5H5.2A1.2 1.2 0 0 1 4 17.8z" />
      <path d="M15 8.5h3.8a1.2 1.2 0 0 1 1.2 1.2v8.1a1.2 1.2 0 0 1-1.2 1.2" />
      <path d="M7 9h5M7 12h5M7 15h3" />
    </>
  ),
  star: <path d="M12 3.6l2.5 5.2 5.7.8-4.1 4 1 5.7-5.1-2.7-5.1 2.7 1-5.7-4.1-4 5.7-.8z" />,
  'star-fill': (
    <path
      d="M12 3.6l2.5 5.2 5.7.8-4.1 4 1 5.7-5.1-2.7-5.1 2.7 1-5.7-4.1-4 5.7-.8z"
      fill="currentColor"
      stroke="none"
    />
  ),
  breadth: <path d="M5 13.5v5.5M10 9.5v9.5M15 6v13M20 11v8" strokeWidth="2.1" />,
  markets: (
    <>
      <path d="M3.5 20.5V4M3.5 20.5h17" />
      <path d="M7 15l3.4-3.6 2.7 2 4.4-5.2" />
      <path d="M15.4 8.2h2.4v2.4" />
    </>
  ),
  more: (
    <>
      <circle cx="5.2" cy="12" r="1.7" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none" />
      <circle cx="18.8" cy="12" r="1.7" fill="currentColor" stroke="none" />
    </>
  ),
  chart: (
    <>
      <rect x="4.5" y="8" width="5" height="8" rx="1" />
      <path d="M7 4.5V8M7 16v3.5" />
      <rect x="14.5" y="9.5" width="5" height="5.5" rx="1" />
      <path d="M17 6v3.5M17 15v3" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.2" />
      <path d="M3.5 9.5h17M8 3.5v3M16 3.5v3" />
    </>
  ),
  screener: <path d="M3.5 5h17l-6.5 7.5V19l-4 2v-8.5z" />,
  patterns: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3.5" />
      <circle cx="12" cy="12" r="0.6" fill="currentColor" stroke="none" />
    </>
  ),
  flow: (
    <>
      <path d="M12 3.2l8.2 4.6-8.2 4.6-8.2-4.6z" />
      <path d="M3.8 12.2l8.2 4.6 8.2-4.6" />
      <path d="M3.8 16.6l8.2 4.6 8.2-4.6" />
    </>
  ),
  moon: <path d="M20.5 14.8A8.2 8.2 0 1 1 9.2 3.5a6.6 6.6 0 0 0 11.3 11.3z" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2.6M12 19.4V22M4.2 4.2l1.9 1.9M17.9 17.9l1.9 1.9M2 12h2.6M19.4 12H22M4.2 19.8l1.9-1.9M17.9 6.1l1.9-1.9" />
    </>
  ),
  book: (
    <>
      <path d="M12 6.6C10.4 5 7 4.6 4 5.1v13.2c3-.5 6.4-.1 8 1.5 1.6-1.6 5-2 8-1.5V5.1c-3-.5-6.4-.1-8 1.5z" />
      <path d="M12 6.6v13.7" />
    </>
  ),
  library: (
    <>
      <rect x="4" y="4" width="4" height="16" rx="1" />
      <rect x="9" y="4" width="4" height="16" rx="1" />
      <path d="M14.4 5.4l3.7.7L16 20.4l-3.4-.6" />
    </>
  ),
  journal: (
    <>
      <rect x="5" y="3.5" width="14" height="17" rx="2.2" />
      <path d="M9 3.5v17M12 8.5h4M12 11.5h4" />
    </>
  ),
  community: (
    <>
      <circle cx="9" cy="8.5" r="3" />
      <path d="M3.5 19c.6-3.2 2.9-5 5.5-5s4.9 1.8 5.5 5" />
      <circle cx="16.5" cy="9.5" r="2.4" />
      <path d="M15.2 14.3c2.6.2 4.6 1.8 5.2 4.7" />
    </>
  ),
  pin: (
    <>
      <path d="M9.2 3.5h5.6l-.8 6 2.8 2.6v1.7H7.2v-1.7L10 9.5z" />
      <path d="M12 13.8v6.7" />
    </>
  ),
  flame: (
    <path d="M12 3.5c.3 2.5 1.9 4 3.5 5.7 1.5 1.6 2.9 3.3 2.9 5.5a6.4 6.4 0 0 1-12.8 0c0-1.6.6-3 1.6-4.3.5 1 1.3 1.7 2.3 2.1-.5-3.2.6-6.5 2.5-9z" />
  ),
  education: (
    <>
      <path d="M12 4 2.5 8.5 12 13l9.5-4.5z" />
      <path d="M6.5 10.8v4.4c0 1.3 2.5 2.6 5.5 2.6s5.5-1.3 5.5-2.6v-4.4" />
      <path d="M21.5 8.5v5" />
    </>
  ),
  desk: (
    <>
      <rect x="3" y="4" width="18" height="12" rx="1.8" />
      <path d="M7 9.5h6M7 12h4" />
      <path d="M8 20h8M12 16v4" />
    </>
  ),
  chat: <path d="M21 11.4a7.6 7.6 0 0 1-11 6.8L4.5 19.8l1.6-4.9A7.6 7.6 0 1 1 21 11.4z" />,
  shield: (
    <>
      <path d="M12 3l7 2.8v5.4c0 4.4-3 7.8-7 9.3-4-1.5-7-4.9-7-9.3V5.8z" />
      <path d="M9 11.6l2.1 2.1 3.7-3.9" />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3.1" />
      <path d="M12 2.5v2.6M12 18.9v2.6M21.5 12h-2.6M5.1 12H2.5M18.7 5.3l-1.8 1.8M7.1 16.9l-1.8 1.8M18.7 18.7l-1.8-1.8M7.1 7.1L5.3 5.3" />
    </>
  ),
  // Two horizontal sliders — the "filter / criteria" control.
  sliders: (
    <>
      <path d="M4 8h2M10 8h10M4 16h10M18 16h2" />
      <circle cx="8" cy="8" r="2.1" />
      <circle cx="16" cy="16" r="2.1" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.5 2.4 2.5 14.6 0 17M12 3.5c-2.5 2.4-2.5 14.6 0 17" />
    </>
  ),

  // ── Common UI ───────────────────────────────────────────────────────────
  bell: (
    <>
      <path d="M6 9.5a6 6 0 0 1 12 0c0 4.5 1.8 5.8 1.8 5.8H4.2S6 14 6 9.5z" />
      <path d="M10 19.5a2 2 0 0 0 4 0" />
    </>
  ),
  flag: <path d="M5.5 21V3.8M5.5 3.8h10.5l-2 4 2 4H5.5" />,
  check: <path d="M5 12.5l4.5 4.5L19 6.5" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  expand: (
    <>
      <path d="M14 4h6v6" />
      <path d="M20 4l-7 7" />
      <path d="M10 20H4v-6" />
      <path d="M4 20l7-7" />
    </>
  ),
  collapse: (
    <>
      <path d="M20 10h-6V4" />
      <path d="M14 10l6-6" />
      <path d="M4 14h6v6" />
      <path d="M10 14l-6 6" />
    </>
  ),
  link: (
    <>
      <path d="M9.5 14.5l5-5" />
      <path d="M11.5 6.5l1-1a3.8 3.8 0 0 1 5.4 5.4l-1 1" />
      <path d="M12.5 17.5l-1 1a3.8 3.8 0 0 1-5.4-5.4l1-1" />
    </>
  ),
  mic: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5v3.5" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    </>
  ),
  unlock: (
    <>
      <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
      <path d="M8 10.5V8a4 4 0 0 1 7.6-1.7" />
    </>
  ),
  edit: <path d="M14 4.8l5.2 5.2M4 20l1-4.2L16 4.8a2.1 2.1 0 0 1 3 3L8 19z" />,
  volume: (
    <>
      <path d="M4 9.5v5h3.5L13 19V5L7.5 9.5z" />
      <path d="M16.5 9a4 4 0 0 1 0 6" />
    </>
  ),
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  download: <path d="M12 3.5v11.5M7.5 11l4.5 4.5 4.5-4.5M5 20h14" />,
  upload: <path d="M12 15V3.5M7.5 8l4.5-4.5L16.5 8M5 20h14" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.2V12l3.2 2" />
    </>
  ),
  warning: (
    <>
      <path d="M12 4l9 16H3z" />
      <path d="M12 10v4.2M12 17.4v.2" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 10.8v5.4" />
      <path d="M12 7.6v.5" />
    </>
  ),
  sparkle: (
    <path d="M12 3l1.9 5.6L19 10l-5.1 1.5L12 17l-1.9-5.5L5 10l5.1-1.4z" />
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M15.8 15.8l4.7 4.7" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  chevronDown: <path d="M6 9.5l6 6 6-6" />,
  chevronUp: <path d="M6 14.5l6-6 6 6" />,
  chevronRight: <path d="M9.5 6l6 6-6 6" />,
  compass: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M15.6 8.4l-2 5.2-5.2 2 2-5.2z" fill="currentColor" stroke="none" />
    </>
  ),
  refresh: (
    <path d="M4 9a8 8 0 0 1 13.4-3.4L20 8M20 3.5V8h-4.5M20 15a8 8 0 0 1-13.4 3.4L4 16M4 20.5V16h4.5" />
  ),
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  // The struck-through eye. Same lid geometry as `eye` so the two read as one
  // control's two states rather than two different glyphs.
  eyeOff: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="3" />
      <path d="M4 20L20 4" />
    </>
  ),
  trash: <path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13" />,
  equity: <path d="M3.5 20.5h17M5 15l4-4 3.5 2.5L20 6M16 6h4v4" />,
  paperclip: (
    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
  ),

  // ── Domain / misc ───────────────────────────────────────────────────────
  rocket: (
    <>
      <path d="M12 3c3.5 1.5 5 5 5 8.5l-2.5 3h-5L7 11.5C7 8 8.5 4.5 12 3z" />
      <circle cx="12" cy="9.5" r="1.6" />
      <path d="M9.5 17.5C8 18 7 19.5 7 21c1.5 0 3-1 3.5-2.5M14.5 17.5c1.5.5 2.5 2 2.5 3.5-1.5 0-3-1-3.5-2.5" />
    </>
  ),
  dollar: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M14.6 9a3 3 0 0 0-2.6-1.4c-1.7 0-2.9 1-2.9 2.3 0 3 5.8 1.6 5.8 4.7 0 1.3-1.2 2.4-2.9 2.4A3.3 3.3 0 0 1 9.2 15M12 6v1.6M12 16.4V18" />
    </>
  ),
  document: (
    <>
      <path d="M6.5 3.5h6.5l4.5 4.5v12H6.5z" />
      <path d="M13 3.5V8h4.5M9 12.5h6M9 15.5h6" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5.5 20a6.5 6.5 0 0 1 13 0" />
    </>
  ),
  pill: (
    <>
      <rect x="3" y="8" width="18" height="8" rx="4" />
      <path d="M12 8v8" />
    </>
  ),
  scale: <path d="M12 4v16M6.5 20h11M5 8.5h14l-2.6 5a2.9 2.9 0 0 1-4.8 0zM5 8.5l-2.6 5a2.9 2.9 0 0 0 4.8 0z" />,
  thumbsUp: (
    <>
      <path d="M4.5 11h2.5v9H4.5z" />
      <path d="M7 11l3.4-6.6a2 2 0 0 1 1.9 2.6L11.5 11h5.6a1.8 1.8 0 0 1 1.8 2.2l-1.3 5.5a2 2 0 0 1-2 1.3H7" />
    </>
  ),
  thumbsDown: (
    <>
      <path d="M19.5 13H17V4h2.5z" />
      <path d="M17 13l-3.4 6.6a2 2 0 0 1-1.9-2.6L12.5 13H6.9a1.8 1.8 0 0 1-1.8-2.2l1.3-5.5a2 2 0 0 1 2-1.3H17" />
    </>
  ),
  wave: <path d="M3 13c2-3 4-3 6 0s4 3 6 0 4-3 6 0M3 18c2-3 4-3 6 0s4 3 6 0 4-3 6 0" />,
  factory: <path d="M4 20V10l5 3.5V10l5 3.5V10l5 3.5V20zM4 20h16" />,
  copy: (
    <>
      <rect x="8" y="8" width="11" height="11" rx="2" />
      <path d="M5 15.5V5a1 1 0 0 1 1-1h9.5" />
    </>
  ),
  magnet: (
    <>
      <path d="M6 3v9a6 6 0 0 0 12 0V3h-3.6v9a2.4 2.4 0 0 1-4.8 0V3z" />
      <path d="M6 6.6h4.6M13.4 6.6H18" />
    </>
  ),
  play: <path d="M7.5 5.2l10.5 6.8-10.5 6.8z" />,
  pause: (
    <>
      <rect x="7" y="5" width="3.4" height="14" rx="1" />
      <rect x="13.6" y="5" width="3.4" height="14" rx="1" />
    </>
  ),
  skipBack: <path d="M18 6v12l-9-6zM7.5 6v12" />,
  skipForward: <path d="M6 6v12l9-6zM16.5 6v12" />,
  bolt: <path d="M13 2.5L5 13h5.2l-1.2 8.5L19 10.5h-5.3z" />,
  volumeOff: (
    <>
      <path d="M4 9.5v5h3.5L13 19V5L7.5 9.5z" />
      <path d="M16.5 9.5l5 5M21.5 9.5l-5 5" />
    </>
  ),
  tag: (
    <>
      <path d="M3.5 4.5h7.2l9 9-7.2 7.2-9-9z" />
      <circle cx="8" cy="8" r="1.4" fill="currentColor" stroke="none" />
    </>
  ),
  ruler: (
    <>
      <path d="M4 13.5l9.5-9.5 6 6-9.5 9.5z" />
      <path d="M8 6l1.8 1.8M10.6 8.6l2.5 2.5M6.5 9.5l1.8 1.8" />
    </>
  ),
  wrench: <path d="M14.6 6.3a4 4 0 0 0-5 5.1l-6 6 2.5 2.5 6-6a4 4 0 0 0 5.1-5l-2.6 2.6-2-2z" />,
  noEntry: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M7 12h10" />
    </>
  ),
  // Three vertical panes — the "column layout / choose columns" control.
  columns: (
    <>
      <rect x="3.5" y="4" width="5" height="16" rx="1.2" />
      <rect x="9.5" y="4" width="5" height="16" rx="1.2" />
      <rect x="15.5" y="4" width="5" height="16" rx="1.2" />
    </>
  ),
  // Three horizontal bars — the "row density / list layout" control.
  rows: (
    <>
      <rect x="3.5" y="4" width="17" height="4.5" rx="1.2" />
      <rect x="3.5" y="9.75" width="17" height="4.5" rx="1.2" />
      <rect x="3.5" y="15.5" width="17" height="4.5" rx="1.2" />
    </>
  ),

  // ── Note connectors (Microsoft Graph wave) ─────────────────────────────
  // Generic four-square "Microsoft family" mark — filled squares (not
  // outlined, unlike `dashboard` above) so it reads as a distinct glyph
  // rather than a re-skinned dashboard icon.
  microsoft: (
    <>
      <rect x="3.5" y="3.5" width="7.4" height="7.4" fill="currentColor" stroke="none" />
      <rect x="13.1" y="3.5" width="7.4" height="7.4" fill="currentColor" stroke="none" />
      <rect x="3.5" y="13.1" width="7.4" height="7.4" fill="currentColor" stroke="none" />
      <rect x="13.1" y="13.1" width="7.4" height="7.4" fill="currentColor" stroke="none" />
    </>
  ),
  // Spiral notebook — a page with binding dots down the left edge, distinct
  // from `document` (folded-corner page) and `journal` (plain ruled page).
  onenote: (
    <>
      <rect x="6" y="3.5" width="14" height="17" rx="1.6" />
      <circle cx="4.2" cy="7" r="1" fill="currentColor" stroke="none" />
      <circle cx="4.2" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="4.2" cy="17" r="1" fill="currentColor" stroke="none" />
      <path d="M10 8.5h6M10 12h6M10 15.5h4" />
    </>
  ),
  // Generic cloud-storage outline.
  onedrive: (
    <path d="M18 10.3h-1.3a8 8 0 1 0-7.7 10.2h9a5 5 0 0 0 0-10.2z" />
  ),
}

export const UICON_NAMES = Object.keys(ICONS)

let _gid = 0

/**
 * UIcon — branded UI icon.
 *
 * Default ("line") = currentColor stroke, so it inherits its surface's color
 * (use for semantic icons: check=green, warning=red, etc.).
 *
 * Brand treatment (DEFAULT for non-semantic icons) = a STATIC metallic gold
 * gradient with a soft gold glow and a touch more weight — an embossed, premium
 * UCT feel. (No animated shimmer — the icons stay perfectly still.)
 *
 * `gold` is undefined by default → ALL icons get the gold treatment. Pass
 * `gold={false}` to force currentColor for a specific use (e.g. an icon whose
 * color must stay semantic green/red on a given surface).
 */
export default function UIcon({ name, size = 18, strokeWidth = 1.7, gold, className, title, style, ...rest }) {
  const glyph = ICONS[name]
  if (!glyph) {
    if (typeof console !== 'undefined') console.warn(`UIcon: unknown name "${name}"`)
    return null
  }
  const useGold = gold === undefined ? true : gold
  const gid = useGold ? `uig${(_gid = (_gid + 1) % 1e6)}` : null
  const goldStyle = useGold
    ? {
        color: '#e6cd8a',
        filter: 'drop-shadow(0 0 1.6px rgba(201,168,76,0.32))',
      }
    : null
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={useGold ? `url(#${gid})` : 'currentColor'}
      strokeWidth={useGold ? Math.max(strokeWidth, 1.85) : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : 'true'}
      role={title ? 'img' : undefined}
      focusable="false"
      style={goldStyle ? { ...goldStyle, ...style } : style}
      {...rest}
    >
      {useGold && (
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#a8823a" />
            <stop offset="40%" stopColor="#d4b25a" />
            <stop offset="50%" stopColor="#e8d18c" />
            <stop offset="60%" stopColor="#cba954" />
            <stop offset="100%" stopColor="#8f6f2c" />
          </linearGradient>
        </defs>
      )}
      {title ? <title>{title}</title> : null}
      {glyph}
    </svg>
  )
}
