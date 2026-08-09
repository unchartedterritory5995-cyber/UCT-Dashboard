// app/src/hooks/useCallRecap.js
// SWR hook: GET /api/earnings/call-recap/{ticker}
// Returns { headline, sentiment, bullets[], quotes[], guidance, qa_highlights[],
//           webcast_url, rating_changes[] } or null.
import useSWR from 'swr'

const fetcher = url => fetch(url).then(r => r.ok ? r.json() : null).catch(() => null)

export const FAST_POLL_MS = 5000
export const SLOW_POLL_MS = 30 * 60 * 1000

/** Poll fast ONLY while the server says it is still writing the recap. */
export function pollInterval(latest) {
  return latest?.recap_status === 'generating' ? FAST_POLL_MS : SLOW_POLL_MS
}

export default function useCallRecap(ticker, quarter = null) {
  const qs = quarter ? `?quarter=${encodeURIComponent(quarter)}` : ''
  return useSWR(
    ticker ? `/api/earnings/call-recap/${ticker}${qs}` : null,
    fetcher,
    {
      // A warmed recap is a SQLite point-read and arrives with the first
      // response. A cold one returns null and triggers a background
      // generation server-side, so poll every 5s until it lands (~40s) — a
      // 30-minute interval would leave the first reader of a cold symbol
      // staring at an empty panel.
      //
      // Poll ONLY while the server says it is generating. Polling on `!recap`
      // hammered every ticker that will never have a recap — no transcript, or
      // the daily cap reached — twelve times a minute for as long as the tab
      // stayed open, for an answer that cannot change.
      refreshInterval: pollInterval,
      revalidateOnFocus: false,
    },
  )
}
