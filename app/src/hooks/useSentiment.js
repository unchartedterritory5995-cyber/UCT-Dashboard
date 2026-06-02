// app/src/hooks/useSentiment.js
// SWR hook: GET /api/earnings/sentiment/{ticker}
// Returns { score, label, rationale, drivers[] } or null.
import useSWR from 'swr'

const fetcher = url => fetch(url).then(r => r.ok ? r.json() : null).catch(() => null)

export default function useSentiment(ticker) {
  return useSWR(
    ticker ? `/api/earnings/sentiment/${ticker}` : null,
    fetcher,
    { refreshInterval: 30 * 60 * 1000, revalidateOnFocus: false },
  )
}
