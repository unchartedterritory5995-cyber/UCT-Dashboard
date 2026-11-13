import useSWR from 'swr'
import { volumeCurveKey, volumeCurveFetcher as fetchCurve } from './volumeCurveKey'

export { volumeCurveKey }

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
export default function useVolumeCurve(enabled = true, tickers = []) {
  const { data } = useSWR(enabled ? volumeCurveKey(tickers) : null, fetchCurve, {
    refreshInterval: 10 * 60 * 1000,
    dedupingInterval: 5 * 60 * 1000,
    revalidateOnFocus: false,
    keepPreviousData: true,
  })
  return data || null
}
