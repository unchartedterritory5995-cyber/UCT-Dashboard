// app/src/hooks/useSentiment.js
// SWR hook: GET /api/earnings/sentiment/{ticker}
// Returns { score, label, rationale, drivers[] } or null.
import useSWR from 'swr'

const fetcher = url => fetch(url).then(r => r.ok ? r.json() : null).catch(() => null)

export default function useSentiment(ticker) {
  return useSWR(
    ticker ? `/api/earnings/sentiment/${ticker}` : null,
    fetcher,
    // A cold name's read is generated in the background now (S2, 2026-10-05): the first
    // answer is null while it runs, so ask again in a minute rather than half an hour.
    { refreshInterval: (data) => (data == null ? 60 * 1000 : 30 * 60 * 1000), revalidateOnFocus: false },
  )
}
