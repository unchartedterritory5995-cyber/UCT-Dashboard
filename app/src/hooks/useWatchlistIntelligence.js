import useSWR from 'swr'

// Unlike useWatchlistPerformance/useWatchlistMeta/useWatchlistThemes, a fetch
// failure here does NOT collapse to `{}` -- every requested symbol reads
// status:"unavailable" instead, so the UI can tell "we checked and nothing is
// notable" apart from "we couldn't check" (Phase A flagged the silent-`{}`
// pattern in the sibling hooks as a real gap; this hook does not repeat it).
//
// Seam 8 (2026-09-07): `priceObservedAt` is optional (defaults to {}) -- a
// caller that only ever passed `changes` (every caller before Seam 8) keeps
// working byte-identically. It's deliberately NOT part of the SWR key (same
// reason `changes` itself rides the POST body rather than the key, per the
// comment on Watchlists.jsx's own changesForIntel: it ticks with the live
// quote feed, and keying on it would refetch the whole batch every tick) --
// the fetcher closes over it fresh each render, so SWR always POSTs
// whatever the LATEST value was as of its next scheduled fetch, never a
// value stale enough to matter.
export default function useWatchlistIntelligence(tickers = [], changes = {}, priceObservedAt = {}) {
  const sorted = [...new Set(tickers)].sort()
  const key = sorted.length ? ['/api/watchlists/intelligence', sorted, changes] : null

  const postFetcher = ([url]) =>
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tickers: sorted, changes, price_observed_at: priceObservedAt }),
    }).then(r => r.ok ? r.json() : null)

  const { data, error } = useSWR(key, postFetcher, {
    refreshInterval: 2 * 60 * 1000,
    dedupingInterval: 60 * 1000,
  })

  const failed = !!error || data === null
  const intelData = {}
  if (data) {
    Object.assign(intelData, data)
  } else if (failed) {
    // A failed fetch (network error, or a non-ok response the fetcher turned
    // into `null`) marks every requested symbol "unavailable" explicitly --
    // never silently absent from the map, and never confused with the
    // still-loading state below (which returns an empty map + isLoading:true).
    for (const sym of sorted) intelData[sym] = { status: 'unavailable', notable: false, facts: [], context: {} }
  }

  return { intelData, isLoading: data === undefined && !error && !!sorted.length }
}
