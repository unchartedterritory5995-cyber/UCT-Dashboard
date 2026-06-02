// app/src/hooks/useFundamentals.js
// SWR hook: GET /api/fundamentals/{ticker}
// Returns { market_cap, forward_pe, beta, week52_high, week52_low, avg_vol, div_yield } or null.
import useSWR from 'swr'

const fetcher = url => fetch(url).then(r => r.ok ? r.json() : null).catch(() => null)

export default function useFundamentals(ticker) {
  return useSWR(
    ticker ? `/api/fundamentals/${ticker}` : null,
    fetcher,
    { refreshInterval: 10 * 60 * 1000, revalidateOnFocus: false },
  )
}
