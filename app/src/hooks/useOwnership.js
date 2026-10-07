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
import { sectionFetcher } from '../components/research/sections/sectionFetch'

/** The server refused this caller. Distinct from `null` (unknown / failed). */
export const OWNERSHIP_LOCKED = { locked: true }

const REFUSALS = new Set([401, 402, 403])

// TERM-033: a failed read THROWS (sectionFetcher: non-2xx, network, deadline, one warm retry)
// so the panel can say it failed, with a Retry. It used to resolve to `null`, which the panel
// renders as a loading state, so a 502 was a spinner that never ended. A refusal is still the
// OWNERSHIP_LOCKED sentinel, never an error: 402 arrives as `{paywalled}`, 401/403 as a thrown status.
const fetcher = (url) => sectionFetcher(url)
  .then((d) => (d?.paywalled ? OWNERSHIP_LOCKED : d))
  .catch((e) => {
    if (REFUSALS.has(e?.status)) return OWNERSHIP_LOCKED
    throw e
  })

export default function useOwnership(sym) {
  return useSWR(
    sym ? `/api/ownership/${encodeURIComponent(sym)}` : null,
    fetcher,
    { refreshInterval: 30 * 60 * 1000, revalidateOnFocus: false },
  )
}
