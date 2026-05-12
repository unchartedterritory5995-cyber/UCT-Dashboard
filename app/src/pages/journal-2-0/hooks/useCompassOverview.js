/**
 * Compass Overview — SWR hook for the unified state card.
 */
import useSWR from 'swr'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`)
    return r.json()
  })

export default function useCompassOverview(accountId) {
  const url = accountId
    ? `/api/j2/accounts/${accountId}/coach/overview`
    : null
  const { data, error, isLoading, mutate } = useSWR(url, fetcher, {
    revalidateOnFocus: true,
    refreshInterval: 60000,
    shouldRetryOnError: false,
  })
  return { overview: data, isLoading, error, refresh: mutate }
}
