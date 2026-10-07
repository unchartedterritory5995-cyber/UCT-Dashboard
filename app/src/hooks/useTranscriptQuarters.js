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
import { sectionFetcher } from '../components/research/sections/sectionFetch'

// TERM-033: a failed read THROWS, so the panel can say the earlier quarters could not be listed
// (with a Retry) instead of quietly showing only the newest call as if it were all there is.
// A 402 stays an absent answer.
const fetcher = (url) => sectionFetcher(url).then((d) => (d?.paywalled ? null : d))

export default function useTranscriptQuarters(ticker, { enabled = false } = {}) {
  const sym = (ticker || '').toUpperCase().trim()
  const { data, isLoading, error, mutate } = useSWR(
    enabled && sym ? `/api/earnings/transcript-quarters/${sym}` : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 6 * 60 * 60 * 1000 },
  )
  return {
    quarters: data?.quarters || [],
    isLoading,
    // Failed with no earlier list to stand on (SWR keeps a good list through a failed refresh).
    error: Boolean(error) && !data,
    retry: () => mutate(),
  }
}
