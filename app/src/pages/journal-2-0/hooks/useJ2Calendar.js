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
 * @param {string|null} [opts.accountId]
 * @param {'closed'|'account'} [opts.basis]  - P&L basis (account-balance is broker-only)
 * @param {Object} [opts.scopeParams] - NON-date global Scope facets in snake_case
 *   (`account_id` / `symbol` / `sides` / `setups` / `tags`) from
 *   `useScope().apiParams` with `date_from`/`date_to` OMITTED. The calendar
 *   navigates its OWN dates via view/year/month/week, so the Scope date facet
 *   does NOT apply here — the caller strips it before passing.
 */
export default function useJ2Calendar({ view, year, month, week, accountId, basis, scopeParams } = {}) {
  const params = new URLSearchParams()
  if (view) params.set('view', view)
  if (year) params.set('year', String(year))
  if (month) params.set('month', String(month))
  if (week) params.set('week', String(week))
  if (accountId) params.set('account_id', accountId)
  if (basis) params.set('basis', basis)
  // Non-date global Scope facets (symbol/sides/setups/tags + account_id). Build
  // the query with URLSearchParams so each value is encoded exactly ONCE — the
  // A6 codec already member-encodes multi-value facets (a comma in a setup rides
  // the wire as `%2C`); a manual concat would double-encode. date_from/date_to
  // are deliberately absent (the caller omits them).
  if (scopeParams) {
    for (const [k, v] of Object.entries(scopeParams)) {
      if (v == null || v === '') continue
      params.set(k, String(v))
    }
  }
  const key = view && year ? `/api/j2/calendar?${params.toString()}` : null

  const { data, error, isLoading, mutate } = useSWR(key, fetcher, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  })

  return {
    days: data?.days ?? [],
    totals: data?.totals ?? null,
    basis: data?.basis ?? basis,
    view: data?.view ?? view,
    year: data?.year ?? year,
    month: data?.month ?? month,
    week: data?.week ?? week,
    isLoading,
    error,
    refresh: () => mutate(),
  }
}
