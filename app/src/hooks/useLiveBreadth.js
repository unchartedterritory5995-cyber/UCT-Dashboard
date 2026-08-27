import { useMemo } from 'react'
import useSWR from 'swr'

const fetcher = url => fetch(url).then(r => (r.ok ? r.json() : null)).catch(() => null)

/** "2:47 PM" in ET. A moment in the session reads as provisional; a date does
 *  not. Lives here so the three surfaces that show it can't drift apart. */
export function formatLiveClock(iso) {
  if (!iso) return 'LIVE'
  try {
    return new Date(iso).toLocaleTimeString('en-US', {
      timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit',
    })
  } catch { return 'LIVE' }
}

/**
 * Breadth as of right now, as a row that can sit on top of the stored history.
 *
 * The daily collector stays authoritative: the moment it writes today's row the
 * backend flags the live read `superseded` and this returns nothing, so an
 * estimate never sits beside the number it was estimating.
 *
 * Polls on the same 60s cadence the backend caches at — asking faster would
 * return the identical payload and cost the pod a request per user.
 */
export function refreshIntervalFor(latest) {
  return !latest || latest.superseded ? 15 * 60_000 : 60_000
}

export function useLiveBreadth({ enabled = true } = {}) {
  const { data, error } = useSWR(
    enabled ? '/api/breadth-monitor/live' : null,
    fetcher,
    {
      // 60s matches the backend's own cache window — asking faster returns the
      // identical payload and costs the single-process pod a request per user.
      // Once the collector has written the day (or the read is unavailable)
      // nothing will change until tomorrow's open, so back right off: this
      // hook is mounted on the Dashboard, the busiest page in the app.
      refreshInterval: refreshIntervalFor,
      revalidateOnFocus: true,
      keepPreviousData: true,
      shouldRetryOnError: false,
    },
  )

  return useMemo(() => {
    // `degraded` means bars.db measured a materially different population than
    // the daily row does — at that point the live number is not a fresher view
    // of the same metric, it is a different metric wearing the same name. Show
    // nothing and let the stored history stand.
    if (!data?.ok || data.superseded || data.degraded || !data.row) {
      return {
        row: null, asOf: null, clock: null, degraded: !!data?.degraded,
        path: {}, openValues: {},
        // The frozen ratio-bar internals + whether the regular session is open
        // survive even when the live ROW is withheld — they are what the
        // Ratio-Bars view holds between the close and the next open.
        marketOpen: !!data?.market_open,
        frozen: data?.internals_frozen ?? null,
        frozenDate: data?.internals_frozen_date ?? null,
        meta: data ?? null, error,
      }
    }
    return {
      row: { ...data.row, _live: true },
      asOf: data.as_of,
      clock: formatLiveClock(data.as_of),
      measured: data.measured ?? null,
      frozen: data.internals_frozen ?? null,
      frozenDate: data.internals_frozen_date ?? null,
      // `{metric: [[epochSeconds, value], ...]}` for today, oldest first —
      // the session's shape, which the daily row can never carry.
      path: data.path ?? {},
      openValues: data.open ?? {},
      marketOpen: !!data.market_open,
      // Per-metric confidence, measured by replaying real sessions against the
      // stored rows. A cell that reconciles to a point should not look like one
      // that reconciles to ~8%.
      accuracy: data.accuracy ?? {},
      degraded: !!data.degraded,
      partial: new Set(data.partial_session ?? []),
      carriedFrom: data.carried_from ?? null,
      carried: new Set(Object.keys(data.carried ?? {})),
      meta: data,
      error,
    }
  }, [data, error])
}

export default useLiveBreadth
