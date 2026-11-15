// The N-day performance of a set of tickers (POST /api/watchlist-performance): its ONE key and ONE fetcher.
// `useWatchlistPerformance` asks under this key with this fetcher; a chart header that shows the field also
// has the rows a member is about to reach asked for ahead under the same two
// (`components/chart/pane/useHeaderExtrasWarm.js`, lib/symbolResourceWarm.js), so a warm can
// never land under a key, or in a shape, the hook would not have produced itself.

/** The SWR key for a ticker set: de-duplicated and sorted, so order never refetches. Null for none. */
export function watchlistPerformanceKey(tickers = []) {
  const sorted = [...new Set(tickers)].sort()
  return sorted.length ? ['/api/watchlist-performance', sorted] : null
}

export const watchlistPerformanceFetcher = ([url, tickers]) =>
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tickers }),
  }).then(r => r.ok ? r.json() : {})
