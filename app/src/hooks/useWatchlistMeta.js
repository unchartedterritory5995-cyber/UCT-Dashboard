import useSWR from 'swr'
import { useEffect, useRef, useState } from 'react'

const postFetcher = ([url, tickers]) =>
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tickers }),
  }).then(r => (r.ok ? r.json() : {}))

// Batch market cap / next earnings / UCT rating / sector / industry for the Watchlist's
// optional columns. Fundamentals are heavy per ticker, so this is fetched ONLY when at
// least one of those columns is visible (pass [] to disable) and SWR-cached for 10 min.
//
// The SWR key is the (sorted) ticker list, so scrolling a virtualized scan changes the
// key and `data` goes briefly undefined — which made EVERY meta cell flash to "—" for a
// moment. So the results ACCUMULATE into a persistent map: once a ticker's meta is
// fetched it stays, and a new window only fills in the rows it adds. Never drops prior data.
export default function useWatchlistMeta(tickers = []) {
  const sorted = [...new Set(tickers)].sort()
  const key = sorted.length ? ['/api/research/snapshot-batch', sorted] : null
  const { data, error } = useSWR(key, postFetcher, {
    refreshInterval: 10 * 60 * 1000,
    dedupingInterval: 60 * 1000,
    revalidateOnFocus: false,
  })

  const accRef = useRef({})
  const [acc, setAcc] = useState({})
  useEffect(() => {
    if (!data || typeof data !== 'object') return
    let changed = false
    const next = { ...accRef.current }
    for (const k in data) {
      if (data[k] && next[k] !== data[k]) { next[k] = data[k]; changed = true }
    }
    if (changed) { accRef.current = next; setAcc(next) }
  }, [data])

  return { metaData: acc, isLoading: !data && !error && !!sorted.length }
}
