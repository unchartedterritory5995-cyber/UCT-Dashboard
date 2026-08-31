import { useMemo, useState } from 'react'
import CompanyLogo from '../../../components/CompanyLogo'
import UIcon from '../../../components/ui/UIcon'
import useTickerMeta from '../../../hooks/useTickerMeta'
import useRealtimePrices from '../../../hooks/useRealtimePrices'
import useBreadthSymbols from '../../../hooks/useBreadthSymbols'
import styles from './MobileCharts.module.css'

const fmtPrice = (p) => (p >= 1000 ? p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : p >= 1 ? p.toFixed(2) : p.toFixed(4))

/* The tappable identity row above the phone chart: logo + ticker + company name
 * on the left, live price + day % on the right. The WHOLE strip is one button —
 * on a phone the symbol is the search door, TradingView-style, so the target is
 * the full row rather than a 60px badge.
 *
 * Synthetic pseudo-tickers (theme "$IDX:" indexes, UCT breadth symbols) have no
 * live feed and no company logo — the strip shows their curated name and skips
 * the quote subscription entirely (mirrors ChartPane's wantsQuote gate).
 */
export default function MobileSymbolStrip({ sym, onOpenSearch }) {
  const breadth = useBreadthSymbols()
  const isThemeIdx = typeof sym === 'string' && sym.startsWith('$IDX:')
  const breadthRec = breadth?.get?.(sym)
  const synthetic = isThemeIdx || !!breadthRec

  const meta = useTickerMeta(synthetic ? null : sym)
  const { prices } = useRealtimePrices(synthetic ? [] : [sym])
  const q = prices?.[sym]

  const displaySym = useMemo(() => {
    if (isThemeIdx) {
      return sym.replace(/^\$IDX:/, '').replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    }
    return sym
  }, [sym, isThemeIdx])

  const name = isThemeIdx ? 'Theme Index' : breadthRec ? breadthRec.name : (meta?.name || '')

  const price = Number.isFinite(q?.price) ? q.price : null
  const chg = Number.isFinite(q?.change_pct) ? q.change_pct : null
  const chgAbs = Number.isFinite(q?.change) ? q.change : null
  const up = (chg ?? 0) >= 0

  // Tick flash: the price takes the tick's direction color for a beat, then
  // fades back. Pure CSS animation on a per-tick `key` (the keyframes omit the
  // `to` frame, so the browser animates back to the base color — no JS timer),
  // with the direction derived by RENDER-TIME state adjustment (the repo's
  // set-state-in-effect-free pattern, same as the shell's tap-to-chart rule).
  // A symbol switch resets clean: the new symbol's first quote is not a tick.
  const [tick, setTick] = useState({ sym, price: null, dir: null, seq: 0 })
  if (tick.sym !== sym || tick.price !== price) {
    const isTick = tick.sym === sym && price != null && tick.price != null && price !== tick.price
    setTick({
      sym,
      price,
      dir: isTick ? (price > tick.price ? 'up' : 'down') : null,
      seq: tick.seq + 1,
    })
  }

  return (
    <div className={styles.symStrip}>
      <button
        type="button"
        className={styles.symBtn}
        onClick={onOpenSearch}
        aria-label={`Change symbol — showing ${displaySym}`}
      >
        {!synthetic && (
          <span className={styles.symLogo}>
            <CompanyLogo sym={sym} size={26} round />
          </span>
        )}
        <span className={styles.symMain}>
          <span className={styles.symRow}>
            <span className={styles.symTicker}>{displaySym}</span>
            <span className={styles.symCaret} aria-hidden="true">
              <UIcon name="chevronDown" size={13} gold={false} />
            </span>
          </span>
          {name ? <span className={styles.symName}>{name}</span> : null}
        </span>
      </button>
      {price != null && (
        <div className={styles.quote} aria-live="off">
          <span
            key={tick.dir ? tick.seq : 'static'}
            className={`${styles.price} ${tick.dir === 'up' ? styles.priceFlashUp : tick.dir === 'down' ? styles.priceFlashDown : ''}`}
          >{fmtPrice(price)}</span>
          {chg != null && (
            <span className={`${styles.chg} ${up ? styles.chgUp : styles.chgDown}`}>
              {chgAbs != null ? `${up ? '+' : ''}${Math.abs(chgAbs) >= 1 ? chgAbs.toFixed(2) : chgAbs.toFixed(3)} (` : ''}
              {up ? '+' : ''}{chg.toFixed(2)}%
              {chgAbs != null ? ')' : ''}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
