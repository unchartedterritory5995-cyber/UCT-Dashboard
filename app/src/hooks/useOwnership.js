// app/src/hooks/useOwnership.js
// SWR hook: GET /api/ownership/{sym} → { ticker, inst_pct, top_holders, biggest_buyers,
// biggest_sellers, ... }, or the LOCKED sentinel below, or null.
//
// 🔴 Same change and same reason as `useAnalystIntel.js`: `/api/ownership/{sym}`
// became `require_paid` on 2026-08-09 (the 13F book, relayed off the firm's FMP
// Ultimate subscription), and `TickerPopup`'s "Ownership" tab is reachable by a
// FREE member from a ticker chip on `/morning-wire`.
//
// ⛔ `OwnershipPanel` renders "Loading {sym}…" on `null`, so collapsing a 402
// into `null` would have shown a free member a spinner forever. A refusal is
// reported as a refusal.
import useSWR from 'swr'

/** The server refused this caller. Distinct from `null` (unknown / failed). */
export const OWNERSHIP_LOCKED = { locked: true }

const REFUSALS = new Set([401, 402, 403])

const fetcher = url => fetch(url)
  .then(r => (r.ok ? r.json() : (REFUSALS.has(r.status) ? OWNERSHIP_LOCKED : null)))
  .catch(() => null)

export default function useOwnership(sym) {
  return useSWR(
    sym ? `/api/ownership/${encodeURIComponent(sym)}` : null,
    fetcher,
    { refreshInterval: 30 * 60 * 1000, revalidateOnFocus: false },
  )
}
