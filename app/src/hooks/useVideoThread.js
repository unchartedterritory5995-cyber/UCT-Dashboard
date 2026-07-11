// Community discussion thread for a video: whether Community is on + the
// existing thread id (the thread is created on demand when the user clicks
// Discuss, not on view).
import useSWR from 'swr'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => (r.ok ? r.json() : null))

export function useVideoThread(videoId) {
  const key = videoId != null ? `/api/education/videos/${videoId}/community-thread` : null
  const { data } = useSWR(key, fetcher, { revalidateOnFocus: false })
  return { enabled: !!data?.enabled, threadId: data?.thread_id ?? null }
}
