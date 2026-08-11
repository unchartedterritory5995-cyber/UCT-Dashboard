// Cross-session "Desk" timeline for a ticker — every session that discussed
// it, newest-first (server order; see /api/education/tickers/{sym}/mentions,
// Phase 2 spec section A). Backs the TickerPopup "Desk" tab (Phase 2B) and
// the chart marker layer (Phase 2C). `enabled` gates the fetch entirely — a
// closed popup or an inactive tab must issue zero requests.
import useSWR from 'swr'

// A failure must be an ERROR, not cached data — same fix as useTickerMeta /
// useTickerReturns: throw on !ok so SWR error-handles + retries instead of
// pinning an empty list as authoritative for the full dedupingInterval.
export async function fetcher(url) {
  const r = await fetch(url, { credentials: 'include' })
  if (!r.ok) throw new Error(`ticker-mentions ${r.status}`)
  return r.json()
}

export function useTickerMentions(sym, { enabled = true } = {}) {
  const key = sym && enabled ? `/api/education/tickers/${sym}/mentions` : null
  const { data } = useSWR(key, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 300_000,
    // Same retry cadence as useTickerMeta.js — ~4s backoff self-heals a
    // transient miss within seconds instead of sitting on SWR's unset/
    // unlimited default.
    errorRetryCount: 4,
    errorRetryInterval: 4000,
  })
  return {
    mentions: Array.isArray(data?.mentions) ? data.mentions : [],
    loading: key != null && data === undefined,
  }
}
