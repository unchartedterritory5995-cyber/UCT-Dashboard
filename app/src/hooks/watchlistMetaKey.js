// The per-symbol meta of a SMALL set of tickers (POST /api/research/snapshot-batch: average volume, IPO date and the snapshot's own fields): its ONE key and ONE fetcher.
// `useWatchlistMeta` asks under this key with this fetcher; a chart header that shows the field also
// has the rows a member is about to reach asked for ahead under the same two
// (`components/chart/pane/useHeaderExtrasWarm.js`, lib/symbolResourceWarm.js), so a warm can
// never land under a key, or in a shape, the hook would not have produced itself.

/** The SWR key for the per-symbol path. The caller passes the list already de-duplicated and sorted. Null for none. */
export function snapshotBatchKey(perSymbol = []) {
  return perSymbol.length ? ['/api/research/snapshot-batch', perSymbol] : null
}

/** The fetcher of both of the hook's POSTs (this one and the bulk one). */
export const watchlistMetaFetcher = ([url, tickers]) =>
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tickers }),
  }).then(r => (r.ok ? r.json() : {}))
