/** Journal 2.0 — live-ish option marks for open broker strategies.
 *
 * `brokerCurrentValue` refreshes only at sync (daily), so between syncs the
 * hero's net-liq and "Today" were blind to option day moves. This polls
 * `GET /api/j2/broker/option-marks` (Massive option daily aggs, server-cached)
 * and returns the marks map keyed by strategy id. Consumers fall back to the
 * sync-time brokerCurrentValue for any strategy absent from the map.
 */

import useMobileSWR from '../../../hooks/useMobileSWR'
import useJ2SelectedAccount from './useJ2SelectedAccount'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`)
    return r.json()
  })

/**
 * @param {object} [opts]
 * @param {boolean} [opts.enabled=true] pass false when there are no open
 *   option strategies — skips the request entirely.
 */
export default function useJ2OptionMarks(opts = {}) {
  const { enabled = true } = opts
  const { accountId } = useJ2SelectedAccount()
  const params = new URLSearchParams()
  if (accountId) params.set('account_id', accountId)
  const qs = params.toString()
  const url = enabled
    ? (qs ? `/api/j2/broker/option-marks?${qs}` : '/api/j2/broker/option-marks')
    : null

  const { data, error, isLoading } = useMobileSWR(url, fetcher, {
    refreshInterval: 15000,
    marketHoursOnly: true,
    revalidateOnFocus: false,
  })

  return {
    marks: data?.marks || null,
    isLoading,
    isError: !!error,
  }
}
