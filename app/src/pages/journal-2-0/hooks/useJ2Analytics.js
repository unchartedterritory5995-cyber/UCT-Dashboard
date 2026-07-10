/** Single mega-endpoint analytics fetch. Scope-driven (full FilterSpec). */

import { useMemo } from 'react'
import useSWR from 'swr'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`)
    return r.json()
  })

/**
 * Fetch analytics from `GET /api/j2/analytics`, driven by the global Scope.
 *
 * @param {Object} [apiParams] snake_case scope params from `useScope().apiParams`
 *   (`account_id` / `date_from` / `date_to` / `symbol` / `sides` / `setups` /
 *   `tags`). The SCOPE owns the whole query — including `account_id` (the scope's
 *   account facet) and the date range (analytics HONORS the Scope date facet,
 *   unlike the calendar). The querystring is built with `URLSearchParams`, which
 *   encodes each value exactly ONCE. The A6 codec already member-encodes
 *   multi-value facets (a literal comma inside a setup rides the wire as `%2C`);
 *   a manual string-concat would double-encode and the backend split/unquote
 *   would not restore it — so never hand-concatenate the query.
 *
 * @returns {{data: any, isLoading: boolean, error: any, refresh: () => void}}
 */
export default function useJ2Analytics(apiParams) {
  const url = useMemo(() => {
    const params = new URLSearchParams()
    if (apiParams != null) {
      // `useScope` memoizes apiParams, so this reference is stable across
      // renders (no refetch churn).
      for (const [k, v] of Object.entries(apiParams)) {
        if (v == null || v === '') continue
        params.set(k, String(v))
      }
    }
    const qs = params.toString()
    return `/api/j2/analytics${qs ? `?${qs}` : ''}`
  }, [apiParams])

  const { data, error, isLoading, mutate } = useSWR(url, fetcher, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  })

  return { data, isLoading, error, refresh: () => mutate() }
}
