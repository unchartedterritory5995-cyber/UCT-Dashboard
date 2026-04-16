// Prefetch bar data into SWR cache for instant chart loading.
// Uses full bar counts matching StockChart's request so SWR cache keys align.
// Server-side disk cache makes these fast (~10ms) for pre-warmed tickers.
import { preload } from 'swr'

const fetcher = url => fetch(url).then(r => r.json())

// Must match StockChart's barCount (5000 for all timeframes)
const BAR_COUNTS = { D: 5000, W: 5000, 5: 5000, 30: 5000, 60: 5000 }
const ALL_TFS = ['D', 'W', '5', '30', '60']

// Prefetch a list of tickers for a specific timeframe
export function prefetchBars(tickers, tf = 'D') {
  if (!tickers?.length) return
  const bars = BAR_COUNTS[tf] ?? 5000
  for (const sym of tickers) {
    if (!sym) continue
    preload(`/api/bars/${encodeURIComponent(sym)}?tf=${tf}&bars=${bars}`, fetcher)
  }
}

// Prefetch a single ticker for one timeframe (hover)
export function prefetchBar(sym, tf = 'D') {
  if (!sym) return
  const bars = BAR_COUNTS[tf] ?? 5000
  preload(`/api/bars/${encodeURIComponent(sym)}?tf=${tf}&bars=${bars}`, fetcher)
}

// Prefetch ALL timeframes for a single ticker — call when a ticker is selected
// so switching between 5min/30min/1hr/Daily/Weekly tabs is instant
export function prefetchAllTimeframes(sym) {
  if (!sym) return
  for (const tf of ALL_TFS) {
    preload(`/api/bars/${encodeURIComponent(sym)}?tf=${tf}&bars=${BAR_COUNTS[tf]}`, fetcher)
  }
}
