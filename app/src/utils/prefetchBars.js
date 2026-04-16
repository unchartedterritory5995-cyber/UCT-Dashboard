// Prefetch bar data into SWR cache for instant chart loading.
// Prefetches the QUICK bar count (250 daily / 100 weekly) that StockChart
// loads first for instant rendering. Full history backfills automatically.
import { preload } from 'swr'

const fetcher = url => fetch(url).then(r => r.json())

// Must match StockChart's quickBars values
const QUICK_BARS = { D: 250, W: 100, 5: 300, 30: 300, 60: 300 }
const ALL_TFS = ['D', 'W', '5', '30', '60']

// Prefetch a list of tickers for a specific timeframe
export function prefetchBars(tickers, tf = 'D') {
  if (!tickers?.length) return
  const bars = QUICK_BARS[tf] ?? 250
  for (const sym of tickers) {
    if (!sym) continue
    preload(`/api/bars/${encodeURIComponent(sym)}?tf=${tf}&bars=${bars}`, fetcher)
  }
}

// Prefetch a single ticker for one timeframe (hover)
export function prefetchBar(sym, tf = 'D') {
  if (!sym) return
  const bars = QUICK_BARS[tf] ?? 250
  preload(`/api/bars/${encodeURIComponent(sym)}?tf=${tf}&bars=${bars}`, fetcher)
}

// Prefetch ALL timeframes for a single ticker — call when a ticker is selected
// so switching between 5min/30min/1hr/Daily/Weekly tabs is instant
export function prefetchAllTimeframes(sym) {
  if (!sym) return
  for (const tf of ALL_TFS) {
    preload(`/api/bars/${encodeURIComponent(sym)}?tf=${tf}&bars=${QUICK_BARS[tf]}`, fetcher)
  }
}
