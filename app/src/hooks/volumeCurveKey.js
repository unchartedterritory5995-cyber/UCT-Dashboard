// The time-of-day volume curve (GET /api/screener/volume-curve): its ONE key and ONE fetcher.
// `useVolumeCurve` asks under this key with this fetcher; a chart header that shows the field also
// has the rows a member is about to reach asked for ahead under the same two
// (`components/chart/pane/useHeaderExtrasWarm.js`, lib/symbolResourceWarm.js), so a warm can
// never land under a key, or in a shape, the hook would not have produced itself.

/** The SWR key for a symbol set: sorted + de-duplicated, so order never refetches. */
export function volumeCurveKey(tickers = []) {
  const syms = [...new Set((tickers || []).map(t => String(t || '').trim().toUpperCase()).filter(Boolean))].sort()
  return syms.length
    ? `/api/screener/volume-curve?tickers=${encodeURIComponent(syms.join(','))}`
    : '/api/screener/volume-curve'
}

// A failed fetch throws, so SWR keeps `data` undefined and every RVOL reads blank rather
// than a guess.
export const volumeCurveFetcher = url => fetch(url).then(r => {
  if (!r.ok) throw new Error(`volume curve ${r.status}`)
  return r.json()
})
