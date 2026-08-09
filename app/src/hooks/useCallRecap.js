// app/src/hooks/useCallRecap.js
// SWR hook: GET /api/earnings/call-recap/{ticker}
// Returns { headline, sentiment, bullets[], quotes[], guidance, qa_highlights[],
//           webcast_url, rating_changes[] } or null.
import useSWR from 'swr'

const fetcher = url => fetch(url).then(r => r.ok ? r.json() : null).catch(() => null)

export default function useCallRecap(ticker, quarter = null) {
  const qs = quarter ? `?quarter=${encodeURIComponent(quarter)}` : ''
  return useSWR(
    ticker ? `/api/earnings/call-recap/${ticker}${qs}` : null,
    fetcher,
    {
      // A warmed recap is a SQLite point-read and arrives with the first
      // response. A cold one returns null and triggers a background
      // generation server-side, so poll every 5s until it lands (~40s) and
      // then fall back to the slow cadence — a 30-minute interval would leave
      // the first reader of a cold symbol staring at an empty panel.
      refreshInterval: latest => (latest?.recap ? 30 * 60 * 1000 : 5000),
      revalidateOnFocus: false,
    },
  )
}
