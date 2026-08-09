// app/src/hooks/useTranscriptQuarters.js
// SWR: GET /api/earnings/transcript-quarters/{ticker}
//
// The list of quarters FMP has a transcript for, newest first. DIS has 81,
// reaching back to 2006Q1 — all of which was unreachable from the UI because
// `useTranscript` accepted a `quarter` argument that no caller ever passed.
//
// Lazy like the transcript itself: nothing is fetched until the panel is open.
// The endpoint reads a cached index (no transcript bodies), so opening the
// dropdown is cheap.
import useSWR from 'swr'

const fetcher = url => fetch(url, { credentials: 'include' })
  .then(r => (r.ok ? r.json() : null))
  .catch(() => null)

export default function useTranscriptQuarters(ticker, { enabled = false } = {}) {
  const sym = (ticker || '').toUpperCase().trim()
  const { data, isLoading } = useSWR(
    enabled && sym ? `/api/earnings/transcript-quarters/${sym}` : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 6 * 60 * 60 * 1000 },
  )
  return { quarters: data?.quarters || [], isLoading }
}
