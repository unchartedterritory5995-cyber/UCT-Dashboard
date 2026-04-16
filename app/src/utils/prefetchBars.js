// Prefetch bar data into SWR cache for instant chart loading.
// Call with an array of tickers — data loads in background so
// StockChart gets a cache hit when it mounts.
import { preload } from 'swr'

const fetcher = url => fetch(url).then(r => r.json())

const BAR_COUNTS = { D: 5000, W: 2000, 5: 300, 30: 300, 60: 300 }

export function prefetchBars(tickers, tf = 'D') {
  if (!tickers?.length) return
  const bars = BAR_COUNTS[tf] ?? 5000
  for (const sym of tickers) {
    if (!sym) continue
    preload(`/api/bars/${encodeURIComponent(sym)}?tf=${tf}&bars=${bars}`, fetcher)
  }
}

// Prefetch a single ticker (convenience for hover)
export function prefetchBar(sym, tf = 'D') {
  if (!sym) return
  const bars = BAR_COUNTS[tf] ?? 5000
  preload(`/api/bars/${encodeURIComponent(sym)}?tf=${tf}&bars=${bars}`, fetcher)
}
