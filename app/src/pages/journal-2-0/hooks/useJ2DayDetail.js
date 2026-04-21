/** Day-detail SWR — metrics + trades + saved notes for one ET date. */

import useSWR from 'swr'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`)
    return r.json()
  })

export default function useJ2DayDetail(date, accountId) {
  const params = new URLSearchParams()
  if (accountId) params.set('account_id', accountId)
  const qs = params.toString() ? `?${params.toString()}` : ''
  const key = date ? `/api/j2/calendar/day/${date}${qs}` : null
  const { data, error, isLoading, mutate } = useSWR(key, fetcher, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  })
  return {
    metrics: data?.metrics ?? null,
    trades: data?.trades ?? [],
    strategies: data?.strategies ?? { closed: [], expiring: [] },
    notes: data?.notes ?? null,
    isLoading,
    error,
    refresh: () => mutate(),
  }
}
