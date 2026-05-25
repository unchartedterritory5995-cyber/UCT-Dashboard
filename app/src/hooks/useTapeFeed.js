import useMobileSWR from './useMobileSWR'

const fetcher = (url) => fetch(url).then((r) => (r.ok ? r.json() : []))

/**
 * Tickers mentioned in tweets in the last `hours`, NOT in current movers.
 * Polled at 30s on MoversSidebar — matches the movers feed cadence.
 */
export default function useTapeFeed({ hours = 12, limit = 15 } = {}) {
  return useMobileSWR(
    `/api/tweets/tape?hours=${hours}&limit=${limit}`,
    fetcher,
    { refreshInterval: 30000, marketHoursOnly: true },
  )
}
