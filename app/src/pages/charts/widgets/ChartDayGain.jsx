import useRealtimePrices from '../../../hooks/useRealtimePrices'
import useRealtimeBarPrices, { pickFreshPrice } from '../../../hooks/useRealtimeBarPrices'
import { useWorkspace } from '../WorkspaceContext'
import styles from '../ChartsWorkspace.module.css'

/**
 * Live day gain ($ + %) shown big beside the ticker, split into TWO readouts:
 *
 *  1. The main "regular-hours" number. Pre-market → the PREVIOUS completed regular
 *     session's change (today's session hasn't happened). Once the 9:30 bell rings
 *     → today's LIVE regular change. After the 4pm close → today's regular change,
 *     now frozen (the feed's change_pct already reflects that). So it always
 *     represents whole regular sessions, never a pre/post move.
 *  2. A shaded EXTENDED-HOURS box (pre/post only) — the move from the reference
 *     regular close: pre-market vs yesterday's close, after-hours vs today's 4pm
 *     close. Hidden entirely during regular hours.
 *
 * ISOLATED on purpose: this owns the per-tick price hooks so its frequent re-renders
 * stay contained here and never re-render its parent (ChartWidget) or the heavy
 * StockChart sibling. Keep this a leaf.
 */
export default function ChartDayGain({ sym, upOverride = null, downOverride = null }) {
  const { chartsTheme } = useWorkspace()
  // User-chosen up/down colors (Chart Settings → Header); each falls back to the
  // theme's built-in green/red when unset.
  const upColor = upOverride || (chartsTheme === 'sunrise' ? '#0a5c22' : '#1ae51a')
  const downColor = downOverride || (chartsTheme === 'sunrise' ? '#7d1620' : '#ff3b47')
  const { prices: rtHdr } = useRealtimePrices(sym ? [sym] : [])
  const barHdr = useRealtimeBarPrices(sym ? [sym] : [])
  const q = rtHdr[sym] || {}
  const extSession = q.ext_session || null   // 'pre_market' | 'post_market' | null
  const isPre = extSession === 'pre_market'
  const isPost = extSession === 'post_market'
  const prevClose = q.prev_close ?? null   // yesterday's regular close
  const dayClose = q.day_close ?? null     // today's regular (4pm) close, null pre-market
  // freshest-wins across the two feeds so a gap in either never freezes the gain
  const livePx = pickFreshPrice(barHdr[sym], q)

  // ── Regular-hours readout (the original number) ──
  // The feed's SERVER-computed `change_pct` IS the last completed regular session's
  // change: it's derived from day_close vs prev_close, so in pre/post/overnight it
  // already holds the last 4pm close's move (and updates live during RTH). It is
  // NOT the (live − prevClose) subtraction that shows a spurious 0.00% after hours.
  // (`prev_change_pct` was a redundant pre-market special-case that arrives as a
  // broken 0.0 and, taken first, made the readout flash 0.00% — dropped.)
  let regAbs = null, regPct = null
  if (q.change_pct != null && Number.isFinite(q.change_pct)) {
    regPct = q.change_pct
    regAbs = (q.change != null && Number.isFinite(q.change)) ? q.change
      : (prevClose != null && prevClose !== 0 ? (prevClose * regPct) / 100 : null)
  } else if (livePx != null && prevClose != null && prevClose !== 0) {
    regAbs = livePx - prevClose
    regPct = (regAbs / prevClose) * 100
  }

  // ── Extended-hours readout (shaded box) — pre/post only ──
  // Move from the reference regular close, using the freshest live ext price (the
  // Massive bar tick the candle rides), falling back to the feed's ext_price.
  let extAbs = null, extPct = null, extLabel = null
  if (isPre || isPost) {
    const ref = isPre ? prevClose : dayClose
    const extPx = pickFreshPrice(barHdr[sym], { price: q.ext_price })
    if (ref != null && ref > 0 && extPx != null && extPx > 0) {
      extAbs = extPx - ref
      extPct = (extAbs / ref) * 100
      extLabel = isPre ? 'Pre' : 'Post'
    }
  }

  const hasReg = regAbs != null && regPct != null
  const hasExt = extAbs != null && extPct != null
  if (!hasReg && !hasExt) return null

  const regUp = (regPct ?? 0) >= 0
  const extUp = (extPct ?? 0) >= 0
  return (
    <span className={styles.chartDayGainWrap}>
      {hasReg && (
        <span className={styles.chartDayGain} style={{ color: regUp ? upColor : downColor }}>
          {regUp ? '+' : ''}{regAbs.toFixed(2)} ({regUp ? '+' : ''}{regPct.toFixed(2)}%)
        </span>
      )}
      {hasExt && (
        <span className={styles.chartDayGainExt} style={{ color: extUp ? upColor : downColor }}>
          <span className={styles.chartDayGainExtLabel}>{extLabel}</span>
          {extUp ? '+' : ''}{extAbs.toFixed(2)} ({extUp ? '+' : ''}{extPct.toFixed(2)}%)
        </span>
      )}
    </span>
  )
}
