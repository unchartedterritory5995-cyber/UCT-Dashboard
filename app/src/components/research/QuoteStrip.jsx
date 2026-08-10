// app/src/components/research/QuoteStrip.jsx
//
// The session line, directly under the identity row: price, change, and the
// OHLC/volume context that says whether today is ordinary or not.
//
// The banner already carries a live price. This is the surrounding numbers —
// a +2% that opened at the high and faded is a different day from a +2% that
// closed on it, and the single number cannot tell you which.
import useMobileSWR from '../../hooks/useMobileSWR'
import { toNum } from '../research-kit'
import styles from './QuoteStrip.module.css'

const fetcher = (u) => fetch(u).then((r) => (r.ok ? r.json() : null)).catch(() => null)

// The shared coercion — see toNum's comment for why the obvious
// one-liner turns every missing value into a real zero.
const n = toNum

export function fmtPrice(v) {
  const x = n(v)
  return x == null ? '—' : `$${x.toFixed(2)}`
}

export function fmtVol(v) {
  const x = n(v)
  if (x == null) return '—'
  if (x >= 1e9) return `${(x / 1e9).toFixed(2)}B`
  if (x >= 1e6) return `${(x / 1e6).toFixed(2)}M`
  if (x >= 1e3) return `${(x / 1e3).toFixed(1)}K`
  return String(Math.round(x))
}

/** Where today's price sits in the 52-week range, 0-100, or null. */
export function rangePct(price, low, high) {
  const p = n(price); const lo = n(low); const hi = n(high)
  if (p == null || lo == null || hi == null || hi <= lo) return null
  return Math.max(0, Math.min(100, ((p - lo) / (hi - lo)) * 100))
}

export default function QuoteStrip({ sym }) {
  // useMobileSWR, not bare useSWR: this polls, and the opt-in wrapper is what
  // backs off when the tab is hidden, stretches the interval 10x once the
  // market is fully closed, and doubles it on mobile. A quote that re-fetches
  // every 60s all weekend is pure battery and API spend for a number that
  // cannot change.
  const { data } = useMobileSWR(sym ? `/api/research/quote/${sym}` : null, fetcher, {
    refreshInterval: 60_000,
    marketHoursOnly: true,
    revalidateOnFocus: false,
  })
  if (!sym || !data || data.price == null) return null

  const chg = n(data.change)
  const pct = n(data.change_pct)
  const dir = chg == null ? '' : chg > 0 ? styles.up : chg < 0 ? styles.down : ''
  const pos = rangePct(data.price, data.year_low, data.year_high)

  return (
    <div className={styles.strip} data-testid="quote-strip">
      <span className={styles.price}>{fmtPrice(data.price)}</span>
      {chg != null && (
        <span className={`${styles.chg} ${dir}`}>
          {chg > 0 ? '▲' : chg < 0 ? '▼' : '·'} {fmtPrice(Math.abs(chg))}
          {pct != null ? ` (${pct > 0 ? '+' : ''}${pct.toFixed(2)}%)` : ''}
        </span>
      )}
      <span className={styles.cells}>
        <b>O</b> {fmtPrice(data.open)}
        <b>H</b> {fmtPrice(data.high)}
        <b>L</b> {fmtPrice(data.low)}
        <b>PC</b> {fmtPrice(data.prev_close)}
        <b>VOL</b> {fmtVol(data.volume)}
      </span>
      {pos != null && (
        <span className={styles.range} title={`52-week ${fmtPrice(data.year_low)} – ${fmtPrice(data.year_high)}`}>
          <span className={styles.rangeTrack}>
            <span className={styles.rangeDot} style={{ left: `${pos}%` }} />
          </span>
          <span className={styles.rangeCap}>{Math.round(pos)}% of 52w range</span>
        </span>
      )}
    </div>
  )
}
