import useSWR from 'swr'
import { watchlistPerformanceKey, watchlistPerformanceFetcher } from './watchlistPerformanceKey'

export default function useWatchlistPerformance(tickers = [], isPaused) {
  const key = watchlistPerformanceKey(tickers)

  // `isPaused` (optional): a chart passes its rest gate, so a symbol the member is racing past is not
  // asked for (components/chart/restedReaders.js). Without it this is an ordinary read.
  const { data, error } = useSWR(key, watchlistPerformanceFetcher, {
    refreshInterval: 5 * 60 * 1000,
    dedupingInterval: 60 * 1000,
    ...(isPaused && { isPaused }),
  })

  return { perfData: data || {}, isLoading: !data && !error && !!key }
}
