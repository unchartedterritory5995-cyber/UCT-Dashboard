import useSWR from 'swr'

// The time-of-day volume curve + today's session window (GET /api/screener/volume-curve).
// Fetched only while a field that needs it is shown (pass enabled=false otherwise). A
// failed fetch throws, so SWR keeps `data` undefined and every RVOL reads blank rather
// than a guess.
//
// APPROACH B: pass the symbols on screen as `tickers` and the payload also carries each
// one's OWN curve (`ticker_knots`). ONE request per chart symbol change, ONE batch request
// per watchlist — never one per row and never per tick (the key is the sorted symbol set,
// so a re-render with the same symbols is the same request). A symbol without its own
// curve reads the market curve in the same payload.
const fetchCurve = url => fetch(url).then(r => {
  if (!r.ok) throw new Error(`volume curve ${r.status}`)
  return r.json()
})

/** The SWR key for a symbol set: sorted + de-duplicated, so order never refetches. */
export function volumeCurveKey(tickers = []) {
  const syms = [...new Set((tickers || []).map(t => String(t || '').trim().toUpperCase()).filter(Boolean))].sort()
  return syms.length
    ? `/api/screener/volume-curve?tickers=${encodeURIComponent(syms.join(','))}`
    : '/api/screener/volume-curve'
}

export default function useVolumeCurve(enabled = true, tickers = []) {
  const { data } = useSWR(enabled ? volumeCurveKey(tickers) : null, fetchCurve, {
    refreshInterval: 10 * 60 * 1000,
    dedupingInterval: 5 * 60 * 1000,
    revalidateOnFocus: false,
    keepPreviousData: true,
  })
  return data || null
}
