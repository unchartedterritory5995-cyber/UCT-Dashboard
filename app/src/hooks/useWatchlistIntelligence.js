import useSWR from 'swr'

const postFetcher = ([url, tickers, changes]) =>
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tickers, changes }),
  }).then(r => r.ok ? r.json() : null)

// Unlike useWatchlistPerformance/useWatchlistMeta/useWatchlistThemes, a fetch
// failure here does NOT collapse to `{}` -- every requested symbol reads
// status:"unavailable" instead, so the UI can tell "we checked and nothing is
// notable" apart from "we couldn't check" (Phase A flagged the silent-`{}`
// pattern in the sibling hooks as a real gap; this hook does not repeat it).
export default function useWatchlistIntelligence(tickers = [], changes = {}) {
  const sorted = [...new Set(tickers)].sort()
  const key = sorted.length ? ['/api/watchlists/intelligence', sorted, changes] : null

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
