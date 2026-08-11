// Since-session % for a Desk video's ticker moments + the session anchor date.
// ONE fetch per video (chips, anchored popups and the follow-along pane share
// it via SWR). anchor_date is server-derived — never re-derive it client-side.
import useSWR from 'swr'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => (r.ok ? r.json() : null))

const EMPTY = Object.freeze({ anchorDate: null, returns: Object.freeze({}) })

export function useTickerReturns(videoId) {
  const key = videoId != null ? `/api/education/videos/${videoId}/ticker-returns` : null
  const { data } = useSWR(key, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 300_000,
  })
  if (!data || typeof data !== 'object') return EMPTY
  return {
    anchorDate: data.anchor_date || null,
    returns: data.returns && typeof data.returns === 'object' ? data.returns : {},
  }
}
