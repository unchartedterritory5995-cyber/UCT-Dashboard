// AI chapters + ticker-moments for a Desk video (chapter rail, scrubber markers,
// ticker chips). SWR de-dups so the player and the theater panel share one fetch.
// Returns empty arrays when a video has no insights yet / isn't a session video.
import useSWR from 'swr'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => (r.ok ? r.json() : null))

const EMPTY = { chapters: [], ticker_moments: [], has_transcript: false }

export function useVideoInsights(videoId) {
  const key = videoId != null ? `/api/education/videos/${videoId}/insights` : null
  const { data } = useSWR(key, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 60_000,
  })
  const d = data || EMPTY
  return {
    chapters: Array.isArray(d.chapters) ? d.chapters : [],
    tickerMoments: Array.isArray(d.ticker_moments) ? d.ticker_moments : [],
    hasTranscript: !!d.has_transcript,
  }
}
