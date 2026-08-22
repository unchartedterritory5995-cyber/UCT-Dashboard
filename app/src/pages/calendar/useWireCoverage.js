// app/src/pages/calendar/useWireCoverage.js
import useMobileSWR from '../../hooks/useMobileSWR'

const fetcher = (url) => fetch(url).then(r => (r.ok ? r.json() : null))

/**
 * The wire's completeness reading — `GET /api/calendar/wire-coverage`.
 *
 * Server-side it is provider truth (Finnhub + FMP, in-universe, actuals
 * published) diffed against the wire store, cached 5 minutes; polling at that
 * same cadence costs nothing extra. The trust line this powers is what lets a
 * member read the feed as "complete and total" rather than taking it on faith
 * — and when it is NOT complete, the missing tickers are named instead of the
 * line going quietly green (the check can also answer "unmeasured", which the
 * UI must render as unknown, never as clean).
 */
export function useWireCoverage(dateStr) {
  return useMobileSWR(
    dateStr ? `/api/calendar/wire-coverage?date=${dateStr}` : '/api/calendar/wire-coverage',
    fetcher,
    { refreshInterval: 300000, revalidateOnFocus: false },
  )
}
