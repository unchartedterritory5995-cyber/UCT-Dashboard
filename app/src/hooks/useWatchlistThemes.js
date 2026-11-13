import useSWR from 'swr'
import { watchlistThemesKey, watchlistThemesFetcher } from './watchlistThemesKey'

// Batch primary-theme lookup for the Watchlist's optional Theme column. Theme
// membership rarely changes, so this is cached long (30 min) and fetched ONLY when
// the Theme column is visible (pass [] to disable). Response: { results: { SYM:
// '<theme name>' | null } }.
export default function useWatchlistThemes(tickers = []) {
  const key = watchlistThemesKey(tickers)
  const { data, error } = useSWR(key, watchlistThemesFetcher, {
    refreshInterval: 30 * 60 * 1000,
    dedupingInterval: 60 * 1000,
    revalidateOnFocus: false,
  })
  return { themeData: (data && data.results) || {}, isLoading: !data && !error && !!key }
}
