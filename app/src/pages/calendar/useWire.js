// app/src/pages/calendar/useWire.js
import useSWR from 'swr'
import useMobileSWR from '../../hooks/useMobileSWR'

import { withDeadline } from '../../utils/withDeadline'

// The probe's fetcher maps a failure to `null` on purpose: the view ladder latches its first
// answer, and `null` reads as "nothing on the Wire" (land elsewhere), never as a stuck probe.
const fetcher = (url) => fetch(url).then(r => (r.ok ? r.json() : null))

// The WIRE VIEW's fetcher THROWS (quality pass 2026-10-05): a 502 mapped to `null` rendered
// "No reporters scheduled" -- a statement about the session made from a read that failed --
// and a request that never answered sat on that same line forever.
const wireFetcher = (url) => withDeadline(fetch(url), url).then((r) => {
  if (!r.ok) throw new Error(`wire ${r.status}`)
  return r.json()
})

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
    wireFetcher,
    // marketHoursOnly: 10x slower only when the market is fully shut (overnight,
    // weekends); pre-market and after-hours keep the 10s cadence.
    { refreshInterval: 10000, revalidateOnFocus: false, marketHoursOnly: true },
  )
}

/**
 * A ONE-SHOT read of today's wire for the view ladder (TERM-074): "is there
 * anything on the Wire right now?" — asked only while a landing is undecided.
 *
 * Same key as `useWire()` with no date, so the payload lands in the cache the
 * WireView then renders from. No polling and no focus/reconnect revalidation:
 * the ladder latches its first answer, and a later print must not move a
 * member off the view they are reading. `enabled=false` ⇒ `null` key ⇒ no
 * request at all (an explicit v3 choice, a deep link, or prefs not loaded).
 */
export function useWireProbe(enabled) {
  return useSWR(enabled ? '/api/calendar/wire' : null, fetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
  })
}
