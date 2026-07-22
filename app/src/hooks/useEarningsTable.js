// app/src/hooks/useEarningsTable.js
// SWR hook: GET /api/fundamentals/earnings-table?sym=TICKER
// Returns { ticker, annual: [...], quarterly: [...] } or null.
import useSWR from 'swr'

const fetcher = url => fetch(url).then(r => (r.ok ? r.json() : null)).catch(() => null)

const FAST_MS = 60 * 1000        // inside an earnings window — pick up the print fast
const SLOW_MS = 5 * 60 * 1000    // normal cadence (backend owns freshness)

// 60s polling while the ticker is inside its earnings window (an unreported
// quarter's scheduled report date within ~±1.5 days) so a just-released
// quarter flips on screen within a minute of the server refreshing; relaxed
// 5-min poll otherwise. Exported for tests.
export function earningsRefreshInterval(data) {
  const rows = data?.quarterly
  if (!Array.isArray(rows)) return SLOW_MS
  const now = Date.now()
  for (const q of rows) {
    if (q?.reported || !q?.report_date) continue
    const t = Date.parse(`${q.report_date}T12:00:00Z`)
    if (Number.isFinite(t) && Math.abs(t - now) <= 36 * 3600 * 1000) return FAST_MS
  }
  return SLOW_MS
}

export default function useEarningsTable(ticker) {
  return useSWR(
    ticker ? `/api/fundamentals/earnings-table?sym=${encodeURIComponent(ticker)}` : null,
    fetcher,
    { refreshInterval: earningsRefreshInterval, revalidateOnFocus: false },
  )
}
