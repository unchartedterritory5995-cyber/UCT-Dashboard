import useSWR from 'swr'

// The newest RS Exit Warning per ticker (POST /api/watchlists/rs-exit-batch) for the Watchlist's
// optional "RS Exit" column. The values come from the nightly screener build (`rs_exit_last` /
// `rs_exit_bars_ago`, the chart's rsExit maths), so the answer changes once a night: there is NO
// poll here, only the fetch when the column is shown (pass [] to disable) and when the ticker set
// changes. Response: { results: { SYM: { last, bars_ago, asof } }, missing: [...] }.

/** The SWR key for a ticker set: de-duplicated and sorted, so order never refetches. Null for none. */
export function watchlistRsExitKey(tickers = []) {
  const sorted = [...new Set(tickers)].sort()
  return sorted.length ? ['/api/watchlists/rs-exit-batch', sorted] : null
}

export const watchlistRsExitFetcher = ([url, tickers]) =>
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tickers }),
  }).then(r => (r.ok ? r.json() : { results: {} }))

export default function useWatchlistRsExit(tickers = []) {
  const key = watchlistRsExitKey(tickers)
  const { data, error } = useSWR(key, watchlistRsExitFetcher, {
    dedupingInterval: 5 * 60 * 1000,
    revalidateOnFocus: false,
    keepPreviousData: true,
  })
  return { rsExitData: (data && data.results) || {}, isLoading: !data && !error && !!key }
}
