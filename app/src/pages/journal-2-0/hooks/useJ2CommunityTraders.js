/** Journal 2.0 — community trader summaries. Powers the trader-card grid. */

import useSWR from 'swr'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`)
    return r.json()
  })

export default function useJ2CommunityTraders() {
  const { data, error, isLoading, mutate } = useSWR(
    '/api/j2/community/traders',
    fetcher,
    { refreshInterval: 60_000, revalidateOnFocus: false, shouldRetryOnError: false },
  )
  return {
    traders: data?.traders ?? [],
    isLoading,
    error,
    refresh: () => mutate(),
  }
}
