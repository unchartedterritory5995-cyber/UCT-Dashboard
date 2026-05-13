/**
 * P5-M — list of trade_ids that have a Compass post-mortem review,
 * for rendering the 🧭 indicator on trade rows. Polls every 60s so a
 * fresh review from TradeDrawer surfaces quickly.
 *
 * Returns: { reviewedIds: Set<string>, isLoading, error }
 */
import { useMemo } from 'react'
import useSWR from 'swr'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`)
    return r.json()
  })

export default function useReviewedTradeIds(accountId) {
  const { data, error, isLoading } = useSWR(
    accountId ? `/api/j2/accounts/${accountId}/coach/trade-reviews` : null,
    fetcher,
    { refreshInterval: 60_000, revalidateOnFocus: true },
  )

  const reviewedIds = useMemo(() => {
    const s = new Set()
    const list = data?.reviews || []
    for (const r of list) {
      if (r?.trade_id) s.add(String(r.trade_id))
    }
    return s
  }, [data])

  return { reviewedIds, isLoading, error }
}
