import useSWR from 'swr'
import { watchlistPerformanceKey, watchlistPerformanceFetcher } from './watchlistPerformanceKey'

export default function useWatchlistPerformance(tickers = []) {
  const key = watchlistPerformanceKey(tickers)

  const { data, error } = useSWR(key, watchlistPerformanceFetcher, {
    refreshInterval: 5 * 60 * 1000,
    dedupingInterval: 60 * 1000,
  })

  return { perfData: data || {}, isLoading: !data && !error && !!key }
}
