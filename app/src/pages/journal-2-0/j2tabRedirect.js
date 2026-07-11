/**
 * Journal 2.0 — P4 permanent `?j2tab=` redirect shim (Task A3).
 *
 * The old 8-tab shell (`JournalTwoRoot`) drove tab selection through a
 * `?j2tab=<tab>` querystring. Nine consumer sites across the app still build
 * `?j2tab=` deep-links (TradeDetailPage back-link, PlaybookSection drill-through,
 * EdgeScoreCard share, GlobalAddPositionProvider, JournalSnapshotTile, …), several
 * carrying scope (`sc_*`) or Insights sub-nav (`ins=`) params. The 8→5 nav swap
 * moves those tabs onto real nested routes, so this shim maps every legacy
 * `?j2tab=` link onto its new route while preserving the FULL querystring.
 *
 * The shim is PERMANENT — the consumer sites keep building `?j2tab=` links; this
 * mapper (wired into JournalLayout, the v5 shell) keeps them working forever.
 * Under the v8 legacy shell the redirect never runs — `JournalTwoRoot` handles
 * `?j2tab=` natively (see App.jsx `JournalShellSelector`).
 *
 * Tab → route map (research R1 §4 + spec §2 Global Constraints):
 *   positions → /journal/trades   (seg=open)     — Open Positions
 *   journal   → /journal/trades   (seg=closed)   — Closed / Trade Journal
 *   calendar  → /journal/journal  (seg=calendar) — Calendar
 *   notebook  → /journal/journal  (seg=notebook) — Notebook
 *   analytics → /journal/insights (carries ins=) — Insights hub
 *   accounts  → /journal/accounts
 *   compass   → /journal/compass
 *   community → /journal/community
 *
 * The `seg` values match the segmented surfaces built in A2:
 *   TradesSurface  reads `?seg=open|closed`   (default open)
 *   JournalSurface reads `?seg=calendar|notebook` (default calendar)
 * so `j2tab` deterministically selects the correct segment of the grouped
 * surface (the j2tab value wins over any incoming `seg`).
 *
 * Unknown `j2tab` value → `/journal/trades?seg=open` (the legacy default was the
 * `positions` tab, `searchParams.get('j2tab') || 'positions'`, so an unrecognized
 * value falls back to the same primary Trades/Open surface — never a blank).
 */

// Segmented surfaces: the j2tab maps to a surface + a specific segment.
// Non-segmented surfaces have no `seg`; all other params pass through verbatim.
const J2TAB_ROUTE_MAP = {
  positions: { path: '/journal/trades', seg: 'open' },
  journal: { path: '/journal/trades', seg: 'closed' },
  calendar: { path: '/journal/journal', seg: 'calendar' },
  notebook: { path: '/journal/journal', seg: 'notebook' },
  analytics: { path: '/journal/insights' },
  accounts: { path: '/journal/accounts' },
  compass: { path: '/journal/compass' },
  community: { path: '/journal/community' },
}

// Unknown j2tab → the legacy default (`positions` → Trades/Open). Documented
// above; kept as a named constant so the fallback is explicit + testable.
const J2TAB_FALLBACK = { path: '/journal/trades', seg: 'open' }

/**
 * Map a `?j2tab=` querystring onto the new nested route, preserving every other
 * param (scope `sc_*`, Insights `ins=`, `note=`, etc.).
 *
 * @param {URLSearchParams} searchParams — the current URL's search params (or any
 *   object exposing a `.get(name)` method + iterable of [key,value] pairs, i.e. a
 *   `URLSearchParams`). Anything else → `null` (treated as "no redirect").
 * @returns {{ path: string, search: string } | null} `null` when there is no
 *   `j2tab` param (no redirect); otherwise `{ path, search }` where `search` is a
 *   querystring with a leading `?` (or the empty string when no params remain).
 */
export function mapJ2TabToRoute(searchParams) {
  if (!searchParams || typeof searchParams.get !== 'function') return null

  const tab = searchParams.get('j2tab')
  if (!tab) return null // absent or empty → no redirect

  const mapping = J2TAB_ROUTE_MAP[tab] || J2TAB_FALLBACK

  // Clone into a fresh, mutable URLSearchParams. The URLSearchParams constructor
  // clones an existing instance (iterating its [key,value] pairs), so encoding is
  // correct + no double-encoding: a value with a literal `%2C` round-trips
  // (`.get` decodes, `.toString` re-encodes) exactly once. Preserves ALL params.
  const preserved = new URLSearchParams(searchParams)
  preserved.delete('j2tab')

  // For a segmented surface, the j2tab value authoritatively selects the segment
  // (overriding any incoming `seg`). Non-segmented surfaces leave `seg` untouched.
  if (mapping.seg) preserved.set('seg', mapping.seg)

  const qs = preserved.toString()
  return { path: mapping.path, search: qs ? `?${qs}` : '' }
}

export default mapJ2TabToRoute
