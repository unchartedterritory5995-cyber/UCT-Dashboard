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
import { sectionFetcher } from '../components/research/sections/sectionFetch'

/** The server refused this caller. Distinct from `null` (unknown / failed). */
export const ANALYST_LOCKED = { locked: true }

const REFUSALS = new Set([401, 402, 403])

// TERM-033: a failed read THROWS (sectionFetcher: non-2xx, network, deadline, one warm retry)
// so the panel can say it failed, with a Retry. It used to resolve to `null`, which the panel
// renders as a loading state, so a 502 was a spinner that never ended. A refusal is still the
// ANALYST_LOCKED sentinel, never an error: 402 arrives as `{paywalled}`, 401/403 as a thrown status.
const fetcher = (url) => sectionFetcher(url)
  .then((d) => (d?.paywalled ? ANALYST_LOCKED : d))
  .catch((e) => {
    if (REFUSALS.has(e?.status)) return ANALYST_LOCKED
    throw e
  })

export default function useAnalystIntel(sym) {
  return useSWR(
    sym ? `/api/analyst/${encodeURIComponent(sym)}` : null,
    fetcher,
    { refreshInterval: 10 * 60 * 1000, revalidateOnFocus: false },
  )
}
