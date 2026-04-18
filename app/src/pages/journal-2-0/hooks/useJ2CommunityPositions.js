/** Journal 2.0 — community open positions feed. SWR-backed, auth-guarded. */

import useSWR from 'swr'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`)
    return r.json()
  })

export default function useJ2CommunityPositions() {
  const { data, error, isLoading, mutate } = useSWR(
    '/api/j2/community/positions',
    fetcher,
    { refreshInterval: 30_000, revalidateOnFocus: false, shouldRetryOnError: false },
  )
  return {
    positions: data?.positions ?? [],
    isLoading,
    error,
    refresh: () => mutate(),
  }
}
