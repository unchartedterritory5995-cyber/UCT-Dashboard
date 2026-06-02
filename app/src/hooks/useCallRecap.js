// app/src/hooks/useCallRecap.js
// SWR hook: GET /api/earnings/call-recap/{ticker}
// Returns { headline, sentiment, bullets[], quotes[], guidance, qa_highlights[],
//           webcast_url, rating_changes[] } or null.
import useSWR from 'swr'

const fetcher = url => fetch(url).then(r => r.ok ? r.json() : null).catch(() => null)

export default function useCallRecap(ticker) {
  return useSWR(
    ticker ? `/api/earnings/call-recap/${ticker}` : null,
    fetcher,
    { refreshInterval: 30 * 60 * 1000, revalidateOnFocus: false },
  )
}
