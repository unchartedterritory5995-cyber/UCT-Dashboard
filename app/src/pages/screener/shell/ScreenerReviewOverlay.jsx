import { useCallback, useEffect, useState } from 'react'
import StockChart from '../../../components/StockChart'
import Sheet from '../../../components/mobile/Sheet'
import UIcon from '../../../components/ui/UIcon'
import styles from './ScannerShell.module.css'

// ── ScreenerReviewOverlay — flip through the screened charts WITHOUT leaving ──
//
// The old "Review charts" button navigated to /charts and entered a review
// session there. The member wanted to stay on the screener: this is a
// full-screen overlay over the results that shows ONE chart at a time and walks
// the list IN THE ORDER SHOWN, driven by the keyboard.
//
// ⛔ IT WALKS `symbols` AS GIVEN — the caller passes displayRows' tickers, i.e.
// the order (and live re-sort) the member is looking at, so "1 / 100 → next"
// matches the list they just read. No re-derivation here.
//
// Keyboard: Space / ↓ / → / j = next · ↑ / ← / k = prev · Esc = close (Sheet
// owns Escape). Keys are ignored while focus is in a text field.
//
// ⭐ ONE StockChart instance, `sym` swapped per step (no `key`), so flipping is
// instant — StockChart updates in place on a ticker change rather than
// re-mounting. `backgroundWarm={false}` keeps a fast flip from firing the
// all-timeframe warm chain (the same rule GridChartCell / ReviewFeedCard hold).
export default function ScreenerReviewOverlay({ symbols = [], open, onClose, startIndex = 0 }) {
  const n = symbols.length
  const [i, setI] = useState(startIndex)
  // Re-anchor whenever the overlay (re)opens or the list changes under it.
  useEffect(() => {
    if (open) setI(Math.min(Math.max(startIndex, 0), Math.max(n - 1, 0)))
  }, [open, startIndex, n])

  const next = useCallback(() => setI(v => Math.min(v + 1, n - 1)), [n])
  const prev = useCallback(() => setI(v => Math.max(v - 1, 0)), [])

  useEffect(() => {
    if (!open) return undefined
    const onKey = e => {
      const t = e.target
      if (t && /^(input|textarea|select)$/i.test(t.tagName)) return
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight' || e.key === ' ' || e.key === 'j') {
        e.preventDefault(); next()
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft' || e.key === 'k') {
        e.preventDefault(); prev()
      }
      // Escape is handled by Sheet.
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, next, prev])

  if (!open || !n) return null
  const idx = Math.min(i, n - 1)
  const sym = symbols[idx]

  return (
    <Sheet open={open} onClose={onClose} variant="fullscreen"
      ariaLabel={`Review charts — ${sym}, ${idx + 1} of ${n}`}>
      <div className={styles.reviewOverlay}>
        <div className={styles.reviewHead}>
          <span className={styles.reviewSym}>{sym}</span>
          <span className={styles.reviewCount}>{idx + 1} / {n}</span>
          <span className={styles.reviewNavBtns}>
            <button type="button" className={styles.reviewNav} onClick={prev}
              disabled={idx === 0} aria-label="Previous chart"><UIcon name="chevronUp" size={15} /></button>
            <button type="button" className={styles.reviewNav} onClick={next}
              disabled={idx === n - 1} aria-label="Next chart"><UIcon name="chevronDown" size={15} /></button>
          </span>
          <span className={styles.reviewHint}>Space / ↓ next · ↑ prev · Esc close</span>
          <button type="button" className={styles.reviewClose} onClick={onClose} aria-label="Close review">
            <UIcon name="x" size={14} />
          </button>
        </div>
        <div className={styles.reviewChart}>
          <StockChart sym={sym} tf="D"
            showDrawingTools={false} showSavedDrawings
            hideReplay hidePatterns hideCompare hideCountdown disablePatterns
            backgroundWarm={false} liveUpdates
            boldCandles userCandleColors colorByNetChange candlesOnTop
            markVolumeExtremes hideWatermark hideJournalOverlay
            rightPadBars={4} dailyDefaultBars={126}
            volumeSeparatePane volumePaneHeightPct={9}
            priceScaleTopMargin={0.12} priceScaleBottomMargin={0.10} />
        </div>
      </div>
    </Sheet>
  )
}
