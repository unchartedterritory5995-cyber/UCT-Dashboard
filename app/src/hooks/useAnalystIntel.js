// app/src/hooks/useAnalystIntel.js
// SWR hook: GET /api/analyst/{sym} → { ticker, consensus, price_target, recent_actions } or null.
import useSWR from 'swr'

const fetcher = url => fetch(url).then(r => (r.ok ? r.json() : null)).catch(() => null)

export default function useAnalystIntel(sym) {
  return useSWR(
    sym ? `/api/analyst/${encodeURIComponent(sym)}` : null,
    fetcher,
    { refreshInterval: 10 * 60 * 1000, revalidateOnFocus: false },
  )
}
