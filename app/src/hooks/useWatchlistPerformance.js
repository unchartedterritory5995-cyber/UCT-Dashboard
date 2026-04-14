import useSWR from 'swr'

const postFetcher = ([url, tickers]) =>
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tickers }),
  }).then(r => r.json())

export default function useWatchlistPerformance(tickers = []) {
  const sorted = [...new Set(tickers)].sort()
  const key = sorted.length ? ['/api/watchlist-performance', sorted] : null

  const { data, error } = useSWR(key, postFetcher, {
    refreshInterval: 5 * 60 * 1000, // 5 min
    dedupingInterval: 60 * 1000,
  })

  return { perfData: data || {}, isLoading: !data && !error && !!sorted.length }
}
