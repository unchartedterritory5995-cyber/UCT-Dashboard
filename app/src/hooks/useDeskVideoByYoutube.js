// Resolve a Desk library video from a bare YouTube id — lets a surface that
// only holds a YouTube URL (the Notebook's video-note hero) find the video row
// and then reuse useVideoInsights / useVideoTranscript. `video` stays null for
// external videos that aren't in the library (the caller renders nothing).
import useSWR from 'swr'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => (r.ok ? r.json() : null))

export function useDeskVideoByYoutube(youtubeId) {
  const key = youtubeId ? `/api/education/by-youtube/${youtubeId}` : null
  const { data } = useSWR(key, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 300_000,
  })
  return {
    loading: key != null && data === undefined,
    video: data?.video || null,
  }
}
