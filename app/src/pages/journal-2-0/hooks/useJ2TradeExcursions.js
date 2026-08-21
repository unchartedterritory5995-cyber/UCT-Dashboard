/** Journal 2.0 — True Risk Engine readout.
 *
 * {tradeId: {maeDollar, maePct, mfeDollar, mfePct, efficiencyPct, trueR}} for
 * closed trades — MAE/MFE replayed from our own bars server-side, so
 * broker-imported trades get a real risk profile with no stop required.
 * Values are static once computed; no polling.
 */

import useSWR from 'swr'
import useJ2SelectedAccount from './useJ2SelectedAccount'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`)
    return r.json()
  })

export default function useJ2TradeExcursions() {
  const { accountId } = useJ2SelectedAccount()
  const url = accountId
    ? `/api/j2/trades/excursions?account_id=${accountId}`
    : '/api/j2/trades/excursions'
  const { data, error } = useSWR(url, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 60000,
  })
  return { excursions: data?.excursions || null, isError: !!error }
}
