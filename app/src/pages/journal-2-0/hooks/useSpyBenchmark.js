/** Journal 2.0 — SPY benchmark closes for the equity-curve overlay.
 *
 * Rides the SAME `/api/bars/SPY?tf=D` endpoint every chart uses (3-layer
 * server cache; SPY daily is permanently warm), so the overlay adds no new
 * data path. Returns a sorted [["YYYY-MM-DD", close], ...] array — the
 * consumer resolves each curve date to the latest close at-or-before it
 * (holiday/weekend exits carry the prior session's close forward).
 */

import { useMemo } from 'react'
import useMobileSWR from '../../../hooks/useMobileSWR'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`)
    return r.json()
  })

/** @param {boolean} enabled — false skips the request entirely. */
export default function useSpyBenchmark(enabled) {
  const { data, error, isLoading } = useMobileSWR(
    enabled ? '/api/bars/SPY?tf=D&bars=1500' : null,
    fetcher,
    { revalidateOnFocus: false, refreshInterval: 0 },
  )

  // Daily bars carry ISO "YYYY-MM-DD" in `t` — lexicographic compare works.
  const closes = useMemo(() => {
    const bars = data?.bars
    if (!Array.isArray(bars) || bars.length === 0) return null
    return bars
      .filter((b) => typeof b.t === 'string' && Number.isFinite(b.c))
      .map((b) => [b.t, b.c])
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
  }, [data])

  return { closes, isLoading, isError: !!error }
}

/** Latest SPY close at-or-before `date` (ISO day). Null when none. */
export function closeAtOrBefore(closes, date) {
  if (!closes || !closes.length) return null
  let lo = 0
  let hi = closes.length - 1
  let best = null
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (closes[mid][0] <= date) {
      best = closes[mid][1]
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return best
}
