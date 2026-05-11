/**
 * SWR hook: per-account nudge state (Phase F).
 * 60s refresh. Returns null state when accountId is null/undefined.
 */

import useSWR from 'swr'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`)
    return r.json()
  })

export default function useJ2Nudges(accountId) {
  const url = accountId ? `/api/j2/accounts/${accountId}/nudges` : null
  const { data, error, isLoading } = useSWR(url, fetcher, {
    refreshInterval: 60_000,
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  })
  return { nudges: data, isLoading, error }
}
