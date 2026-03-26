import useMobileSWR from './useMobileSWR'

const fetcher = url => fetch(url).then(r => r.json())

/**
 * Fetch live prices for a list of tickers.
 * Returns { prices, isLoading, error, refresh }
 * where prices = { AAPL: { price: 195.23, change_pct: 1.45 }, ... }
 */
export default function useLivePrices(tickers = []) {
  // Sort and dedupe tickers for stable cache key
  const key = tickers.length > 0
    ? `/api/live-prices?tickers=${[...new Set(tickers)].sort().join(',')}`
    : null  // null key = don't fetch

  const { data, error, isLoading, mutate } = useMobileSWR(key, fetcher, {
    refreshInterval: 15000,  // 15s (will be 30s on mobile via useMobileSWR)
  })

  return {
    prices: data || {},
    isLoading,
    error,
    refresh: mutate,
  }
}
