import useSWR from 'swr'

const postFetcher = ([url, tickers]) =>
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tickers }),
  }).then(r => (r.ok ? r.json() : { results: {} }))

// Batch primary-theme lookup for the Watchlist's optional Theme column. Theme
// membership rarely changes, so this is cached long (30 min) and fetched ONLY when
// the Theme column is visible (pass [] to disable). Response: { results: { SYM:
// '<theme name>' | null } }.
export default function useWatchlistThemes(tickers = []) {
  const sorted = [...new Set(tickers)].sort()
  const key = sorted.length ? ['/api/watchlists/themes-batch', sorted] : null
  const { data, error } = useSWR(key, postFetcher, {
    refreshInterval: 30 * 60 * 1000,
    dedupingInterval: 60 * 1000,
    revalidateOnFocus: false,
  })
  return { themeData: (data && data.results) || {}, isLoading: !data && !error && !!sorted.length }
}
