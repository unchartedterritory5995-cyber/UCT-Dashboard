/** Single mega-endpoint analytics fetch. Account + date-range scoped. */

import useSWR from 'swr'
import useJ2SelectedAccount from './useJ2SelectedAccount'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`)
    return r.json()
  })

export default function useJ2Analytics({ from, to } = {}) {
  const { accountId } = useJ2SelectedAccount()
  const params = new URLSearchParams()
  if (accountId) params.set('account_id', accountId)
  if (from) params.set('date_from', from)
  if (to) params.set('date_to', to)
  const qs = params.toString()
  const url = `/api/j2/analytics${qs ? `?${qs}` : ''}`

  const { data, error, isLoading, mutate } = useSWR(url, fetcher, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  })

  return { data, isLoading, error, refresh: () => mutate() }
}
