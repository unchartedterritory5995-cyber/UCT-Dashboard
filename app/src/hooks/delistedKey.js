// Whether a ticker is delisted (GET /api/delisted/{sym}): its ONE key and ONE fetcher.
// `useDelisted` asks under this key with this fetcher; a chart header also
// has the rows a member is about to reach asked for ahead under the same two
// (`components/chart/pane/useHeaderExtrasWarm.js`, lib/symbolResourceWarm.js), so a warm can
// never land under a key, or in a shape, the hook would not have produced itself.

/** The SWR key for a symbol. Null for none and for a synthetic pseudo-ticker ($IDX:...). */
export function delistedKey(sym) {
  return sym && !String(sym).startsWith('$IDX:') ? `/api/delisted/${encodeURIComponent(sym)}` : null
}

/** The registry record when the ticker is delisted, else null (a live ticker, or a failed read). */
export const delistedFetcher = async (url) => {
  const r = await fetch(url)
  if (!r.ok) return null
  const d = await r.json()
  return d && d.delisted ? d : null
}
