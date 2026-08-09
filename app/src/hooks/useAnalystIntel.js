// app/src/hooks/useAnalystIntel.js
// SWR hook: GET /api/analyst/{sym} → { ticker, consensus, price_target, recent_actions },
// or the LOCKED sentinel below, or null.
//
// 🔴 `/api/analyst/{sym}` became `require_paid` on 2026-08-09 (it relays the
// firm's FMP Ultimate subscription). `TickerPopup` — which a FREE member reaches
// from a ticker chip on `/morning-wire`, the one free page — offers an "Analyst"
// tab that mounts `AnalystPanel`.
//
// ⛔ The old fetcher collapsed EVERY non-`ok` response to `null`, and
// `AnalystPanel` renders a skeleton on `null`. A 402 would therefore have shown a
// free member a loading state that never resolves — the paywall as a hang. A
// refusal is a FACT the panel is entitled to render, so it is kept distinct from
// "no data" and from "the request failed".
import useSWR from 'swr'

/** The server refused this caller. Distinct from `null` (unknown / failed). */
export const ANALYST_LOCKED = { locked: true }

const REFUSALS = new Set([401, 402, 403])

const fetcher = url => fetch(url)
  .then(r => (r.ok ? r.json() : (REFUSALS.has(r.status) ? ANALYST_LOCKED : null)))
  .catch(() => null)

export default function useAnalystIntel(sym) {
  return useSWR(
    sym ? `/api/analyst/${encodeURIComponent(sym)}` : null,
    fetcher,
    { refreshInterval: 10 * 60 * 1000, revalidateOnFocus: false },
  )
}
