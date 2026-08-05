import { useMemo } from 'react'
import useSWR from 'swr'

const fetcher = url => fetch(url).then(r => (r.ok ? r.json() : null)).catch(() => null)

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
export function useLiveBreadth({ enabled = true } = {}) {
  const { data, error } = useSWR(
    enabled ? '/api/breadth-monitor/live' : null,
    fetcher,
    {
      refreshInterval: 60_000,
      revalidateOnFocus: true,
      keepPreviousData: true,
      shouldRetryOnError: false,
    },
  )

  return useMemo(() => {
    if (!data?.ok || data.superseded || !data.row) {
      return { row: null, asOf: null, meta: data ?? null, error }
    }
    return {
      row: { ...data.row, _live: true },
      asOf: data.as_of,
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
