/**
 * Journal 2.0 — `useJ2Playbook`: per-setup Playbook aggregate, Scope-aware.
 *
 * SWR over the B1 endpoint `GET /api/j2/accounts/{accountId}/playbook`, driven
 * by the global Scope's snake_case `apiParams` (from `useScope().apiParams`).
 * Returns the dedicated per-setup shape (PF / expectancy / exit-efficiency /
 * lastFive) — NOT the lighter `analytics.attribution.bySetup`.
 *
 * ── The "all accounts" case ──────────────────────────────────────────────────
 * The route is PER-ACCOUNT: it needs a concrete `{account_id}` path segment.
 * When the active account is the "all accounts" aggregate (`useJ2SelectedAccount`
 * yields `null` / the `'_all_'` sentinel), there is no single account to key the
 * path on — so we SKIP the fetch (null SWR key) and return
 * `{stats: [], allAccounts: true}`. PlaybookSection then shows a friendly
 * "select one account" note instead of a misleading empty playbook.
 *
 * ── Querystring (encode-once) ────────────────────────────────────────────────
 * Built with `URLSearchParams`, which encodes each value EXACTLY ONCE — the A6
 * codec already member-encodes multi-value facets (a literal comma inside a
 * setup rides the wire as `%2C`); never hand-concatenate. `account_id` is
 * DROPPED from the query — it lives in the path segment (and the scope's account
 * facet already equals the live account), so passing it again would be
 * redundant.
 *
 * @param {Object} [apiParams] snake_case scope params (`date_from`/`date_to`/
 *   `symbol`/`sides`/`setups`/`tags`/`account_id`).
 * @returns {{stats: Array, isLoading: boolean, error: any, allAccounts: boolean}}
 */

import { useMemo } from 'react'
import useSWR from 'swr'
import useJ2SelectedAccount from './useJ2SelectedAccount'

const ALL_ACCOUNTS = '_all_'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`)
    return r.json()
  })

export default function useJ2Playbook(apiParams) {
  const { accountId } = useJ2SelectedAccount()

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
    return `/api/j2/accounts/${concreteId}/playbook${qs ? `?${qs}` : ''}`
  }, [concreteId, apiParams])

  const { data, error, isLoading } = useSWR(url, fetcher, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  })

  return {
    stats: Array.isArray(data) ? data : [],
    isLoading: !!url && isLoading,
    error,
    allAccounts,
  }
}
