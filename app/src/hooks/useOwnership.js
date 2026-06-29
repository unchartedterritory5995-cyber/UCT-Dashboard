// app/src/hooks/useOwnership.js
// SWR hook: GET /api/ownership/{sym} → { ticker, inst_pct, top_holders, biggest_buyers, biggest_sellers, ... } or null.
import useSWR from 'swr'

const fetcher = url => fetch(url).then(r => (r.ok ? r.json() : null)).catch(() => null)

export default function useOwnership(sym) {
  return useSWR(
    sym ? `/api/ownership/${encodeURIComponent(sym)}` : null,
    fetcher,
    { refreshInterval: 30 * 60 * 1000, revalidateOnFocus: false },
  )
}
