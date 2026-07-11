// Other library videos that covered any of the now-playing video's tickers.
import useSWR from 'swr'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => (r.ok ? r.json() : null))

export function useVideoRelated(videoId) {
  const key = videoId != null ? `/api/education/videos/${videoId}/related` : null
  const { data } = useSWR(key, fetcher, { revalidateOnFocus: false, dedupingInterval: 120_000 })
  return { related: Array.isArray(data?.videos) ? data.videos : [] }
}
