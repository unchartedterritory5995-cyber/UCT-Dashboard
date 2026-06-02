// app/src/hooks/useEarningsAudio.js
// SWR hook: GET /api/earnings/audio/{ticker}
// Returns { stream_url, kind, transcript_url } or null when no audio provider configured.
import useSWR from 'swr'

const fetcher = url => fetch(url).then(r => r.ok ? r.json() : null).catch(() => null)

export default function useEarningsAudio(ticker) {
  return useSWR(
    ticker ? `/api/earnings/audio/${ticker}` : null,
    fetcher,
    { refreshInterval: 2 * 60 * 1000, revalidateOnFocus: false },
  )
}
