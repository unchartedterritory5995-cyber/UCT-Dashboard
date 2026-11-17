import useSWR from 'swr'
import { useMemo } from 'react'

// The Watchlist column library's nightly-snapshot fields (owner 11-14) —
// POST /api/watchlists/column-facts {tickers, fields} → {results: {SYM: {field: v}}}.
// Asked for ONLY while a fact column is showing, and only for the fields those columns
// need. The snapshot is rebuilt nightly, so there is no polling interval: the cells that
// move intraday are re-based on the live price on the client (watchlistColumnCatalog).
const factsFetcher = ([url, tickers, fields]) =>
  fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tickers, fields }),
  }).then((r) => (r.ok ? r.json() : {}))

/** The SWR key for a ticker set + field set (both de-duplicated and sorted). Null when either is empty. */
export function watchlistFactsKey(tickers = [], fields = []) {
  const syms = [...new Set(tickers)].sort()
  const flds = [...new Set(fields)].sort()
  return syms.length && flds.length ? ['/api/watchlists/column-facts', syms, flds] : null
}

// `isPaused` (optional): the chart header passes its rest gate (components/chart/restedReaders.js), so a
// symbol the member is racing past is not asked for. Without it this is an ordinary read.
export default function useWatchlistFacts(tickers = [], fields = [], isPaused) {
  const syms = useMemo(() => [...new Set(tickers)].sort(), [tickers])
  const flds = useMemo(() => [...new Set(fields)].sort(), [fields])
  const key = syms.length && flds.length ? ['/api/watchlists/column-facts', syms, flds] : null
  const { data } = useSWR(key, factsFetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 5 * 60 * 1000,
    keepPreviousData: true,
    ...(isPaused && { isPaused }),
  })
  return data?.results || {}
}
