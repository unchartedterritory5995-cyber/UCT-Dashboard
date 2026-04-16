// Prefetch bar data into SWR cache for instant chart loading.
// Prefetches the QUICK bar count (250 daily / 100 weekly) that StockChart
// loads first for instant rendering. Full history backfills automatically.
import { preload } from 'swr'

const fetcher = url => fetch(url).then(r => r.json())

// Must match StockChart's quickBars values
const QUICK_BARS = { D: 250, W: 100, 5: 300, 30: 300, 60: 300 }

export function prefetchBars(tickers, tf = 'D') {
  if (!tickers?.length) return
  const bars = QUICK_BARS[tf] ?? 250
  for (const sym of tickers) {
    if (!sym) continue
    preload(`/api/bars/${encodeURIComponent(sym)}?tf=${tf}&bars=${bars}`, fetcher)
  }
}

// Prefetch a single ticker (convenience for hover)
export function prefetchBar(sym, tf = 'D') {
  if (!sym) return
  const bars = QUICK_BARS[tf] ?? 250
  preload(`/api/bars/${encodeURIComponent(sym)}?tf=${tf}&bars=${bars}`, fetcher)
}
