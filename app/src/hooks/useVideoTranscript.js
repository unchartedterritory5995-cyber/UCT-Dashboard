// Timed transcript cues [{t, text}] for a Desk session video — lazy: only
// fetches once `enabled` (the panel is opened), so we don't pull a long
// transcript for every viewer. SWR de-dups + caches for the session.
import useSWR from 'swr'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => (r.ok ? r.json() : null))

export function useVideoTranscript(videoId, enabled) {
  const key = enabled && videoId != null
    ? `/api/education/videos/${videoId}/transcript`
    : null
  const { data } = useSWR(key, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 300_000,
  })
  return {
    loading: key != null && data === undefined,
    cues: Array.isArray(data?.cues) ? data.cues : [],
  }
}
