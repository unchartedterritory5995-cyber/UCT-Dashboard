import { useMemo } from 'react'
import useMobileSWR from './useMobileSWR'

const fetcher = (url) => fetch(url).then((r) => (r.ok ? r.json() : {}))

/**
 * Returns { TICKER: count } for the given list of tickers, in last 24h.
 * Memoizes the URL based on a sorted/joined ticker list so swap-order
 * inputs don't double-fetch.
 */
export default function useBatchTweetCounts(tickers, { hours = 24 } = {}) {
  const url = useMemo(() => {
    if (!tickers || tickers.length === 0) return null
    const csv = [...new Set(tickers.map((t) => t.toUpperCase()))].sort().join(',')
    return `/api/tweets/has-tweets-batch?tickers=${csv}&hours=${hours}`
  }, [tickers, hours])

  return useMobileSWR(url, fetcher, {
    refreshInterval: 30000,
    marketHoursOnly: true,
  })
}
