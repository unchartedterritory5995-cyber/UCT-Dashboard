// The primary theme of a set of tickers (POST /api/watchlists/themes-batch): its ONE key and ONE fetcher.
// `useWatchlistThemes` asks under this key with this fetcher; a chart header that shows the field also
// has the rows a member is about to reach asked for ahead under the same two
// (`components/chart/pane/useHeaderExtrasWarm.js`, lib/symbolResourceWarm.js), so a warm can
// never land under a key, or in a shape, the hook would not have produced itself.

/** The SWR key for a ticker set: de-duplicated and sorted, so order never refetches. Null for none. */
export function watchlistThemesKey(tickers = []) {
  const sorted = [...new Set(tickers)].sort()
  return sorted.length ? ['/api/watchlists/themes-batch', sorted] : null
}

export const watchlistThemesFetcher = ([url, tickers]) =>
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tickers }),
  }).then(r => (r.ok ? r.json() : { results: {} }))
