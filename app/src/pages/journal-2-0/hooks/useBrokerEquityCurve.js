/** Journal 2.0 — real broker net-liquidation equity curve (SWR). */
import useSWR from 'swr'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => (r.ok ? r.json() : { points: [] }))

/**
 * Daily broker net-liq equity points (cash + equity MV + option MV), aggregated
 * across the user's connected accounts. Empty for users without a broker link.
 * @param {number} days lookback window
 */
export default function useBrokerEquityCurve(days = 365) {
  const { data, error, isLoading, mutate } = useSWR(
    `/api/j2/broker/equity-curve?days=${days}`,
    fetcher,
    { refreshInterval: 60_000, revalidateOnFocus: false, shouldRetryOnError: false },
  )
  return { points: data?.points ?? [], isLoading, error, refresh: () => mutate() }
}
