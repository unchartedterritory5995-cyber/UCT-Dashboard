/** Journal 2.0 — trades list fetch hook. Account-scoped. */

import useSWR from 'swr'
import useJ2SelectedAccount from './useJ2SelectedAccount'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`)
    return r.json()
  })

export default function useJ2Trades() {
  const { accountId } = useJ2SelectedAccount()
  const url = accountId
    ? `/api/j2/trades?account_id=${encodeURIComponent(accountId)}`
    : '/api/j2/trades'
  const { data, error, isLoading, mutate } = useSWR(url, fetcher, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  })

  return {
    trades: data?.trades ?? [],
    isLoading,
    error,
    refresh: () => mutate(),
    mutate,
  }
}
