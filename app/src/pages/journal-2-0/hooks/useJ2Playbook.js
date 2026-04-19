/** Playbook entries SWR hook. */

import useSWR from 'swr'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`)
    return r.json()
  })

export default function useJ2Playbook({ symbol, status } = {}) {
  const params = new URLSearchParams()
  if (symbol) params.set('symbol', symbol)
  if (status) params.set('status', status)
  const qs = params.toString()
  const url = `/api/j2/playbook${qs ? `?${qs}` : ''}`
  const { data, error, isLoading, mutate } = useSWR(url, fetcher, {
    revalidateOnFocus: true,
    shouldRetryOnError: false,
  })
  return {
    entries: data?.entries ?? [],
    isLoading,
    error,
    refresh: () => mutate(),
  }
}
