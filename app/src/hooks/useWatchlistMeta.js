import useSWR from 'swr'
import { useEffect, useMemo, useRef, useState } from 'react'

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
//
// ── TWO SOURCES, AND WHICH ONE ANSWERS ───────────────────────────────────────
//
// ⛔ `/api/research/snapshot-batch` IS HARD-CAPPED AT 100 TICKERS, AND THE CAP IS
// NOT ARBITRARY — it is what makes the endpoint survivable. Its floor is one
// yfinance `.info` HTTP call PER SYMBOL plus one SQLite query per symbol for
// average volume; it measured 10,031 ms for 100 tickers on prod 2026-09-20. But it
// also meant rows 101+ of a 1,872-name Russell 2000 could NEVER show Name, Market
// Cap, Rating, Earnings or Sector. Not slow hydration — a permanent truncation,
// with nothing telling the member those cells would never fill.
//
// ⭐ So a list longer than the cap goes to `/api/watchlists/bulk-meta`, which reads
// the same fields out of `screener_rows` — the nightly whole-universe snapshot the
// Screener and the Market Map already sit on — in ONE indexed query, ~7 ms for
// 2,000 tickers. `scatter.bundle()` has read that table this way on the request
// path at a 2,500 cap for months: the same pattern, not a new one.
//
// ⚠️ THEY ARE NOT INTERCHANGEABLE, WHICH IS WHY A SMALL LIST KEEPS THE OLD PATH.
// The snapshot universe has a ~$300M market-cap floor (3,745 names), so a few
// hundred Russell 2000 micro-caps have no row in it. `bulk-meta` reports those as
// `missing` rather than null, and they fall back to `snapshot-batch` — bounded by
// the same cap, so the fallback can never become the storm the bulk path exists to
// avoid. A list at or under the cap is unchanged: `snapshot-batch` is
// live-fundamentals fresh where the snapshot is nightly.
const CAP = 100

export default function useWatchlistMeta(tickers = []) {
  const sorted = useMemo(() => [...new Set(tickers)].sort(), [tickers])
  const isLarge = sorted.length > CAP

  const bulkKey = isLarge ? ['/api/watchlists/bulk-meta', sorted] : null
  const { data: bulk, error: bulkErr } = useSWR(bulkKey, postFetcher, {
    refreshInterval: 10 * 60 * 1000,
    dedupingInterval: 60 * 1000,
    revalidateOnFocus: false,
  })

  // The per-symbol path takes the whole list when it is small, and otherwise ONLY
  // the symbols the snapshot does not cover — still bounded by the endpoint's cap.
  const perSymbol = useMemo(
    () => (isLarge ? (bulk?.missing || []).slice(0, CAP) : sorted),
    [isLarge, sorted, bulk],
  )

  const key = perSymbol.length ? ['/api/research/snapshot-batch', perSymbol] : null
  const { data, error } = useSWR(key, postFetcher, {
    refreshInterval: 10 * 60 * 1000,
    dedupingInterval: 60 * 1000,
    revalidateOnFocus: false,
  })

  const accRef = useRef({})
  const [acc, setAcc] = useState({})
  useEffect(() => {
    // Both sources merge into the one accumulator. `snapshot-batch` is applied
    // second so a live fundamental wins over the nightly snapshot wherever both
    // cover a symbol.
    let changed = false
    const next = { ...accRef.current }
    for (const src of [bulk?.results, data]) {
      if (!src || typeof src !== 'object') continue
      for (const k in src) {
        if (src[k] && next[k] !== src[k]) { next[k] = { ...next[k], ...src[k] }; changed = true }
      }
    }
    if (changed) { accRef.current = next; setAcc(next) }
  }, [data, bulk])

  const waiting = isLarge ? (!bulk && !bulkErr) : (!data && !error && !!sorted.length)
  return { metaData: acc, isLoading: waiting }
}
