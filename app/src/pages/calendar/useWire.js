// app/src/pages/calendar/useWire.js
import useMobileSWR from '../../hooks/useMobileSWR'

const fetcher = (url) => fetch(url).then(r => (r.ok ? r.json() : null))

/**
 * The earnings wire.
 *
 * 10s polling, deliberately NOT a second SSE rail: the web pod is a single
 * uvicorn process with in-process stream state (the 2026-07-01 524 surface),
 * and the endpoint is a table read over price data that is already real-time.
 * At this cadence polling is indistinguishable from push here.
 *
 * useMobileSWR (not plain useSWR) so the poll pauses on a hidden tab and slows
 * on mobile — a wire left open all evening should not hammer the endpoint.
 */
export function useWire(dateStr) {
  return useMobileSWR(
    dateStr ? `/api/calendar/wire?date=${dateStr}` : '/api/calendar/wire',
    fetcher,
    { refreshInterval: 10000, revalidateOnFocus: false },
  )
}
