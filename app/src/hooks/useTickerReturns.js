// Since-session % for a Desk video's ticker moments + the session anchor date.
// ONE fetch per video (chips, anchored popups and the follow-along pane share
// it via SWR). anchor_date is server-derived — never re-derive it client-side.
import useSWR from 'swr'

// A failure must be an ERROR, not cached data (same defect class fixed in
// useTickerMeta.js — see its comment). The old `r.ok ? r.json() : null`
// resolved a transient 5xx to a "successful" null, which SWR then pinned as
// authoritative for the full 5-minute dedupingInterval below. Throw on !ok
// so SWR error-handles + retries instead; the hook still degrades to EMPTY
// while loading/erroring.
export async function fetcher(url) {
  const r = await fetch(url, { credentials: 'include' })
  if (!r.ok) throw new Error(`ticker-returns ${r.status}`)
  return r.json()
}

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
