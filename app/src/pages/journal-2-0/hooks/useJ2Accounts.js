/** SWR over /api/j2/accounts. Refreshes on focus + polls during market hours
 * so `brokerCashLive` (the backend's fill-derived cash) tracks intraday
 * trades — the positions list polls at 15s, and the hero pairs those live
 * positions with THIS payload's cash, so a static accounts fetch would
 * reintroduce the stale-cash/live-book vintage mix. */

import useMobileSWR from '../../../hooks/useMobileSWR'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`)
    return r.json()
  })

export default function useJ2Accounts() {
  const { data, error, isLoading, mutate } = useMobileSWR(
    '/api/j2/accounts',
    fetcher,
    {
      refreshInterval: 30_000,
      marketHoursOnly: true,
      revalidateOnFocus: true,
      shouldRetryOnError: false,
    },
  )
  return {
    accounts: data?.accounts ?? [],
    isLoading,
    error,
    refresh: () => mutate(),
  }
}
