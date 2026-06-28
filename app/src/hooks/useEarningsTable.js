// app/src/hooks/useEarningsTable.js
// SWR hook: GET /api/fundamentals/earnings-table?sym=TICKER
// Returns { ticker, annual: [...], quarterly: [...] } or null.
import useSWR from 'swr'

const fetcher = url => fetch(url).then(r => (r.ok ? r.json() : null)).catch(() => null)

export default function useEarningsTable(ticker) {
  return useSWR(
    ticker ? `/api/fundamentals/earnings-table?sym=${encodeURIComponent(ticker)}` : null,
    fetcher,
    { refreshInterval: 5 * 60 * 1000, revalidateOnFocus: false },
  )
}
