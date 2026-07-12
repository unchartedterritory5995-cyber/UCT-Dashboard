/** Journal 2.0 — open positions fetch hook (SWR). Account-scoped. */

import useMobileSWR from '../../../hooks/useMobileSWR'
import useJ2SelectedAccount from './useJ2SelectedAccount'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`)
    return r.json()
  })

export default function useJ2Positions() {
  const { accountId } = useJ2SelectedAccount()
  const url = accountId
    ? `/api/j2/positions?account_id=${encodeURIComponent(accountId)}`
    : '/api/j2/positions'
  // Live P&L cadence: 15s during market hours; useMobileSWR's marketHoursOnly
  // slows it 10x off-hours (positions don't move overnight/weekends) and pauses
  // on a hidden tab — mirrors the live-price poller. (P0 launch-load hardening)
  const { data, error, isLoading, mutate } = useMobileSWR(url, fetcher, {
    refreshInterval: 15_000,
    marketHoursOnly: true,
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  })

  return {
    positions: data?.positions ?? [],
    isLoading,
    error,
    refresh: () => mutate(),
  }
}
