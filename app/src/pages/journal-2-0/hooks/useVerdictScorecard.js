/**
 * Journal 2.0 — `useVerdictScorecard`: Compass GO/HOLD/SKIP verdict-vs-outcome
 * scorecard, Scope-aware (P6-3).
 *
 * SWR over the P6-2 endpoint
 * `GET /api/j2/accounts/{accountId}/verdict-scorecard`, driven by the global
 * Scope's snake_case `apiParams` (from `useScope().apiParams`). Mirrors
 * `useJ2Playbook`'s account+apiParams shape exactly:
 *   - The route is PER-ACCOUNT (`{account_id}` path segment). When the active
 *     account is the "all accounts" aggregate (`null` / the `'_all_'` sentinel)
 *     there is no single account to key the path on, so we SKIP the fetch (null
 *     SWR key) and return `{data: null, allAccounts: true}`. The section then
 *     shows a "select one account" note instead of a misleading empty scorecard.
 *   - `account_id` is DROPPED from the query — it lives in the path segment (and
 *     the scope's account facet already equals the live account), so passing it
 *     again would be redundant. Every other facet rides the wire via
 *     `URLSearchParams` (encode-once).
 *
 * @param {string|null} accountId  live account id (null / '_all_' → skip).
 * @param {Object} [apiParams]     snake_case scope params (`date_from`/`date_to`/
 *   `symbol`/`sides`/`setups`/`tags`/`account_id`).
 * @returns {{data: Object|null, isLoading: boolean, error: any, allAccounts: boolean}}
 */

import { useMemo } from 'react'
import useSWR from 'swr'

const ALL_ACCOUNTS = '_all_'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`)
    return r.json()
  })

export default function useVerdictScorecard(accountId, apiParams) {
  // null / '_all_' → the aggregate "all accounts" view has no path segment.
  const allAccounts = accountId == null || accountId === ALL_ACCOUNTS
  const concreteId = allAccounts ? null : accountId

  const url = useMemo(() => {
    if (!concreteId) return null
    const params = new URLSearchParams()
    if (apiParams != null) {
      // `useScope` memoizes apiParams → stable reference, no refetch churn.
      for (const [k, v] of Object.entries(apiParams)) {
        if (v == null || v === '') continue
        // account_id is in the PATH — skip it in the query.
        if (k === 'account_id') continue
        params.set(k, String(v))
      }
    }
    const qs = params.toString()
    return `/api/j2/accounts/${concreteId}/verdict-scorecard${qs ? `?${qs}` : ''}`
  }, [concreteId, apiParams])

  const { data, error, isLoading } = useSWR(url, fetcher, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  })

  return {
    data: data || null,
    isLoading: !!url && isLoading,
    error,
    allAccounts,
  }
}
