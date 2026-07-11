// AI chapters + ticker-moments for a Desk video (chapter rail, scrubber markers,
// ticker chips). SWR de-dups so the player and the theater panel share one fetch.
// Returns empty arrays when a video has no insights yet / isn't a session video.
import useSWR from 'swr'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => (r.ok ? r.json() : null))

const EMPTY = { chapters: [], ticker_moments: [], has_transcript: false,
  headline: '', summary: [], setups: [], has_poster: false, poster_url: null }

export function useVideoInsights(videoId) {
  const key = videoId != null ? `/api/education/videos/${videoId}/insights` : null
  const { data } = useSWR(key, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 60_000,
  })
  const d = data || EMPTY
  return {
    // `loading` is true only while the first fetch is in flight (key set, no
    // data yet) — lets the theater show skeletons instead of empty rails.
    loading: key != null && data === undefined,
    chapters: Array.isArray(d.chapters) ? d.chapters : [],
    tickerMoments: Array.isArray(d.ticker_moments) ? d.ticker_moments : [],
    hasTranscript: !!d.has_transcript,
    headline: d.headline || '',
    summary: Array.isArray(d.summary) ? d.summary : [],
    setups: Array.isArray(d.setups) ? d.setups : [],
    posterUrl: d.poster_url || null,
  }
}
