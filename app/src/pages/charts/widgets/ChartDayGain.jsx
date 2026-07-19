import useRealtimePrices from '../../../hooks/useRealtimePrices'
import useRealtimeBarPrices, { pickFreshPrice } from '../../../hooks/useRealtimeBarPrices'
import { useWorkspace } from '../WorkspaceContext'
import styles from '../ChartsWorkspace.module.css'

/**
 * Live day gain ($ + %) shown big beside the ticker.
 *
 * ISOLATED on purpose: this owns the per-tick price hooks so its frequent
 * re-renders stay contained here and never re-render its parent (ChartWidget)
 * or the heavy StockChart sibling — which is NOT memoized, so a per-tick state
 * update in the parent would re-render the whole chart every tick and jank the
 * main thread. Keep this a leaf.
 *
 * Tick price from the Massive bars WS (same reliable feed as the candle);
 * official prev_close from REST. Change = live − prev_close.
 */
export default function ChartDayGain({ sym, upOverride = null, downOverride = null }) {
  const { chartsTheme } = useWorkspace()
  // User-chosen up/down colors (Chart Settings → Header); each falls back to the
  // theme's built-in green/red when unset.
  const upColor = upOverride || (chartsTheme === 'sunrise' ? '#0a5c22' : '#1ae51a')
  const downColor = downOverride || (chartsTheme === 'sunrise' ? '#7d1620' : '#ff3b47')
  const { prices: rtHdr } = useRealtimePrices(sym ? [sym] : [])
  const barHdr = useRealtimeBarPrices(sym ? [sym] : [])
  // freshest-wins across the two feeds so a gap in either never freezes the gain
  const livePx = pickFreshPrice(barHdr[sym], rtHdr[sym])
  const prevClose = rtHdr[sym]?.prev_close ?? null
  // Prefer the feed's SERVER-computed today % (change_pct / change). Deriving the
  // gain from (livePx − prevClose) reads 0.00% on weekends / after-hours, where
  // the live price sits at the reference close — the recurring "goes to 0.00%"
  // bug. Fall back to the subtraction only when the feed lacks a change_pct.
  const feedPct = rtHdr[sym]?.change_pct
  const feedChg = rtHdr[sym]?.change
  let gainAbs, gainPct
  if (feedPct != null && Number.isFinite(feedPct)) {
    gainPct = feedPct
    gainAbs = (feedChg != null && Number.isFinite(feedChg)) ? feedChg
      : (prevClose != null && prevClose !== 0 ? (prevClose * feedPct) / 100 : null)
  } else if (livePx != null && prevClose != null && prevClose !== 0) {
    gainAbs = livePx - prevClose
    gainPct = (gainAbs / prevClose) * 100
  }
  if (gainAbs == null || gainPct == null) return null
  const gainUp = gainPct >= 0
  return (
    <span className={styles.chartDayGain} style={{ color: gainUp ? upColor : downColor }}>
      {gainUp ? '+' : ''}{gainAbs.toFixed(2)} ({gainUp ? '+' : ''}{gainPct.toFixed(2)}%)
    </span>
  )
}
