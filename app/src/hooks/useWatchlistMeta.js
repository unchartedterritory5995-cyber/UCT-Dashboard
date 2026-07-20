import useSWR from 'swr'

const postFetcher = ([url, tickers]) =>
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tickers }),
  }).then(r => (r.ok ? r.json() : {}))

// Batch market cap / next earnings / UCT rating for the Watchlist's optional
// Market Cap / Next Earnings / UCT Rating columns. Fundamentals are heavy per
// ticker, so this is fetched ONLY when at least one of those columns is visible
// (pass [] to disable) and SWR-cached for 10 min (the backend caches per ticker).
export default function useWatchlistMeta(tickers = []) {
  const sorted = [...new Set(tickers)].sort()
  const key = sorted.length ? ['/api/research/snapshot-batch', sorted] : null
  const { data, error } = useSWR(key, postFetcher, {
    refreshInterval: 10 * 60 * 1000,
    dedupingInterval: 60 * 1000,
    revalidateOnFocus: false,
  })
  return { metaData: data || {}, isLoading: !data && !error && !!sorted.length }
}
