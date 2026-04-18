/** Journal 2.0 — open positions fetch hook (SWR). */

import useSWR from 'swr'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`)
    return r.json()
  })

/**
 * @returns {{
 *   positions: Array<any>,
 *   isLoading: boolean,
 *   error: any,
 *   refresh: () => Promise<any>,
 * }}
 */
export default function useJ2Positions() {
  const { data, error, isLoading, mutate } = useSWR('/api/j2/positions', fetcher, {
    refreshInterval: 15_000,
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  })

  return {
    positions: data?.positions ?? [],
    isLoading,
    error,
    refresh: () => mutate(),
  }
}
