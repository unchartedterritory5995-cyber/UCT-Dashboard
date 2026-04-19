/** Journal 2.0 — calendar aggregation feed. SWR-backed, auth-guarded. */

import useSWR from 'swr'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`)
    return r.json()
  })

/**
 * @param {Object} opts
 * @param {'year'|'month'|'week'} opts.view
 * @param {number} opts.year
 * @param {number} [opts.month]
 * @param {number} [opts.week]
 * @param {string|null} [opts.accountId]   - Phase 2 hook
 */
export default function useJ2Calendar({ view, year, month, week, accountId } = {}) {
  const params = new URLSearchParams()
  if (view) params.set('view', view)
  if (year) params.set('year', String(year))
  if (month) params.set('month', String(month))
  if (week) params.set('week', String(week))
  if (accountId) params.set('account_id', accountId)
  const key = view && year ? `/api/j2/calendar?${params.toString()}` : null

  const { data, error, isLoading, mutate } = useSWR(key, fetcher, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  })

  return {
    days: data?.days ?? [],
    totals: data?.totals ?? null,
    view: data?.view ?? view,
    year: data?.year ?? year,
    month: data?.month ?? month,
    week: data?.week ?? week,
    isLoading,
    error,
    refresh: () => mutate(),
  }
}
