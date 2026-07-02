/**
 * SWR hook: fetches /api/j2/accounts/{id}/discipline/state.
 * Refreshes every 5s while the consumer is mounted (i.e., while a J2 modal
 * is open). Returns null state when accountId is null/undefined (e.g., the
 * "All Accounts" aggregate view, where no per-account lock applies).
 */

import useSWR from 'swr'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`)
    return r.json()
  })

export default function useJ2DisciplineState(accountId) {
  const url = accountId ? `/api/j2/accounts/${accountId}/discipline/state` : null
  const { data, error, isLoading, mutate } = useSWR(url, fetcher, {
    // Discipline state changes on trade events, not sub-second — 5s was needless
    // network + re-render churn. 20s is plenty (mutate() still refreshes it
    // immediately after a trade action). (2026-07-01 perf pass)
    refreshInterval: 20_000,
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  })
  return {
    state: data,
    isLoading,
    error,
    refresh: () => mutate(),
  }
}
