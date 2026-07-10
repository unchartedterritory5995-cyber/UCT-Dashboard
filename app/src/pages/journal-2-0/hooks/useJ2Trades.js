/** Journal 2.0 — trades list fetch hook. Scope-aware, reads the paginated envelope. */

import { useMemo } from 'react'
import useSWR from 'swr'
import useJ2SelectedAccount from './useJ2SelectedAccount'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`)
    return r.json()
  })

/**
 * Fetch the current user's closed trades from `GET /api/j2/trades`, reading the
 * P1a additive envelope `{trades, total, limit, offset}`.
 *
 * @param {Object} [apiParams] snake_case scope params from `useScope().apiParams`
 *   (`account_id` / `date_from` / `date_to` / `symbol` / `sides` / `setups` /
 *   `tags` / `limit` / `offset`). When provided, the SCOPE owns the whole query
 *   — including `account_id` (the scope's account facet). When omitted (the
 *   trade-detail / chart-marker consumers that only need the account's trades),
 *   the hook falls back to account-only scoping via the live selected account.
 *
 * The querystring is built with `URLSearchParams`, which encodes each value
 * exactly ONCE. The A6 scope codec already member-encodes multi-value facets (a
 * literal comma inside a setup name rides the wire as `%2C`); a manual
 * string-concat here would double-encode and the backend split/unquote would
 * not restore it — so never hand-concatenate the query.
 *
 * @returns {{trades: any[], total: number, isLoading: boolean, error: any,
 *   refresh: () => void, mutate: import('swr').KeyedMutator<any>}}
 *   `mutate` is preserved for the optimistic inline setup-tag write.
 */
export default function useJ2Trades(apiParams) {
  const { accountId } = useJ2SelectedAccount()

  const url = useMemo(() => {
    const params = new URLSearchParams()
    if (apiParams != null) {
      // Scope owns the query (incl. account_id). `useScope` memoizes apiParams,
      // so this reference is stable across renders (no refetch churn).
      for (const [k, v] of Object.entries(apiParams)) {
        if (v == null || v === '') continue
        params.set(k, String(v))
      }
    } else if (accountId) {
      params.set('account_id', accountId)
    }
    const qs = params.toString()
    return qs ? `/api/j2/trades?${qs}` : '/api/j2/trades'
  }, [apiParams, accountId])

  const { data, error, isLoading, mutate } = useSWR(url, fetcher, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  })

  return {
    trades: data?.trades ?? [],
    total: data?.total ?? 0,
    isLoading,
    error,
    refresh: () => mutate(),
    mutate,
  }
}
