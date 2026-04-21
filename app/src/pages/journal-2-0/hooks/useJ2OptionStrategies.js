/** Journal 2.0 — option strategies fetch hook (SWR). Account-scoped. */

import useSWR from 'swr'
import useJ2SelectedAccount from './useJ2SelectedAccount'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`)
    return r.json()
  })

/**
 * Hook for fetching option strategies.
 * @param {object} [opts]
 * @param {'open'|'closed'|'expired'|'assigned'|'rolled'} [opts.status] - filter by status
 * @param {string}  [opts.dateFrom] - YYYY-MM-DD inclusive
 * @param {string}  [opts.dateTo]   - YYYY-MM-DD inclusive
 */
export default function useJ2OptionStrategies(opts = {}) {
  const { accountId } = useJ2SelectedAccount()
  const params = new URLSearchParams()
  if (accountId) params.set('account_id', accountId)
  if (opts.status) params.set('status', opts.status)
  if (opts.dateFrom) params.set('date_from', opts.dateFrom)
  if (opts.dateTo) params.set('date_to', opts.dateTo)
  const qs = params.toString()
  const url = qs ? `/api/j2/options?${qs}` : '/api/j2/options'

  const { data, error, isLoading, mutate } = useSWR(url, fetcher, {
    refreshInterval: 15_000,
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  })

  return {
    strategies: data?.strategies ?? [],
    isLoading,
    error,
    refresh: () => mutate(),
  }
}
