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

// `enabled` defaults to true so every existing caller (all ~30 of them, every
// one inside <AuthGuard/> where `user` is already resolved by the time they
// mount) is unaffected. It exists for root-mounted callers — components that
// render for EVERY visitor, signed in or not — so they can hold off this
// fetch until a member is actually signed in. `null` is SWR's own "don't
// fetch" key; a `false` here costs nothing but the key swap.
export default function useJ2Accounts(enabled = true) {
  const { data, error, isLoading, mutate } = useMobileSWR(
    enabled ? '/api/j2/accounts' : null,
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
