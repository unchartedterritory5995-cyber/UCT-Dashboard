/** SWR over /api/j2/accounts/comparison. */

import useSWR from 'swr'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`)
    return r.json()
  })

export default function useJ2AccountComparison() {
  const { data, error, isLoading, mutate } = useSWR(
    '/api/j2/accounts/comparison',
    fetcher,
    { revalidateOnFocus: false, shouldRetryOnError: false },
  )
  return {
    accounts: data?.accounts ?? [],
    isLoading,
    error,
    refresh: () => mutate(),
  }
}
