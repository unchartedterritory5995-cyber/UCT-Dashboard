/**
 * SWR hook: per-setup historical performance for the live coaching panel.
 * Returns null state when accountId is null/undefined OR setup is empty/whitespace.
 *
 * Uses 60s dedupe — setup history doesn't change mid-modal.
 */

import useSWR from 'swr'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`)
    return r.json()
  })

export default function useJ2SetupStats(accountId, setup) {
  const trimmed = (setup || '').trim()
  const url = (accountId && trimmed)
    ? `/api/j2/accounts/${accountId}/setup-stats?setup=${encodeURIComponent(trimmed)}`
    : null
  const { data, error, isLoading } = useSWR(url, fetcher, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
    dedupingInterval: 60_000,
  })
  return { stats: data, isLoading, error }
}
