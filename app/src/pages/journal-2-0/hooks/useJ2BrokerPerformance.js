/** SWR over /api/j2/broker/performance for one account + period window. */

import useSWR from 'swr'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`)
    return r.json()
  })

export default function useJ2BrokerPerformance(accountId, period = 'ALL') {
  const key = accountId
    ? `/api/j2/broker/performance?accountId=${encodeURIComponent(accountId)}&period=${period}`
    : null
  const { data, error, isLoading, mutate } = useSWR(key, fetcher, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  })
  return { data, isLoading, error, refresh: () => mutate() }
}
