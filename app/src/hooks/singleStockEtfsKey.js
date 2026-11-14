// A symbol's leveraged and inverse single-stock ETFs (GET /api/single-stock-etfs/{sym}): its ONE key and ONE fetcher.
// `useSingleStockEtfs` asks under this key with this fetcher; the chart widget that shows the control also
// has the rows a member is about to reach asked for ahead under the same two
// (`pages/charts/widgets/ChartWidget.jsx`, lib/symbolResourceWarm.js), so a warm can
// never land under a key, or in a shape, the hook would not have produced itself.

/** The SWR key for a symbol. Null for none and for a synthetic pseudo-ticker ($IDX:...). */
export function singleStockEtfsKey(sym) {
  const skip = !sym || String(sym).startsWith('$IDX:')
  return skip ? null : `/api/single-stock-etfs/${encodeURIComponent(String(sym).toUpperCase())}`
}

export const singleStockEtfsFetcher = (url) => fetch(url, { credentials: 'include' }).then(r => {
  if (!r.ok) throw new Error(`single-stock-etfs ${r.status}`)  // transient -> SWR keeps last-good + retries
  return r.json()
})
