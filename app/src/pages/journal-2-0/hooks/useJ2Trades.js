/** Journal 2.0 — trades list fetch hook. Used for mutation revalidation
    in Phase 4; the full Trade Journal tab consumes this in Phase 5. */

import useSWR from 'swr'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`)
    return r.json()
  })

/**
 * @returns {{
 *   trades: Array<any>,
 *   isLoading: boolean,
 *   error: any,
 *   refresh: () => Promise<any>,
 * }}
 */
export default function useJ2Trades() {
  const { data, error, isLoading, mutate } = useSWR('/api/j2/trades', fetcher, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  })

  return {
    trades: data?.trades ?? [],
    isLoading,
    error,
    refresh: () => mutate(),
  }
}
