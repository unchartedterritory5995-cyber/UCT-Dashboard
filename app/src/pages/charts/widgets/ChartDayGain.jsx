import useRealtimePrices from '../../../hooks/useRealtimePrices'
import useRealtimeBarPrices from '../../../hooks/useRealtimeBarPrices'
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
export default function ChartDayGain({ sym }) {
  const { prices: rtHdr } = useRealtimePrices(sym ? [sym] : [])
  const barHdr = useRealtimeBarPrices(sym ? [sym] : [])
  const livePx = barHdr[sym]?.price ?? rtHdr[sym]?.price ?? null
  const prevClose = rtHdr[sym]?.prev_close ?? null
  const gainAbs = (livePx != null && prevClose != null && prevClose !== 0) ? (livePx - prevClose) : null
  if (gainAbs == null) return null
  const gainPct = (gainAbs / prevClose) * 100
  const gainUp = gainAbs >= 0
  return (
    <span className={styles.chartDayGain} style={{ color: gainUp ? '#1ae51a' : '#ff3b47' }}>
      {gainUp ? '+' : ''}{gainAbs.toFixed(2)} ({gainUp ? '+' : ''}{gainPct.toFixed(2)}%)
    </span>
  )
}
