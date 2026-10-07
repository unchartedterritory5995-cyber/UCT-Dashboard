// app/src/components/research/QuoteStrip.jsx
//
// The session line, directly under the identity row: the OHLC/volume context
// that says whether today is ordinary or not.
//
// ⛔ THIS STRIP DOES NOT PRINT THE PRICE. The banner does, and it is the one
// authority — its `useLivePrices` read is deliberately un-debounced so the
// header number never lags the header name (see the shell's §4.4 amendment
// note). This component reads a DIFFERENT endpoint (/api/research/quote), so
// when it also rendered price + change the modal showed the same quote twice,
// 20px apart, rounded two ways: the banner's "▼8.1%" directly above this
// strip's "▼$1.56 (-8.07%)". Two authorities over one value, and it read as a
// disagreement. The strip keeps only what the banner CANNOT say: a +2% that
// opened at the high and faded is a different day from a +2% that closed on
// it, and a single number cannot tell you which.
//
// The 52-week position track also lived here (an 86px rail, a 7px dot, a
// 10.5px caption) directly above SetupSection's own labelled 52-week
// RangeSlider. Removed in favour of the labelled one — see that section.
import useMobileSWR from '../../hooks/useMobileSWR'
import { sectionFetcher } from './sections/sectionFetch'
import { toNum } from '../research-kit'
import { formatCompactTerminal, formatCurrency } from '../../lib/presentation/presentationPrimitives'
import styles from './QuoteStrip.module.css'

// TERM-033: the fetcher THROWS on a failed read (sectionFetcher: non-2xx, network, deadline,
// one warm retry). It used to resolve `null`, so one failed 60 s refresh REPLACED the last good
// quote and the strip vanished mid-session. SWR records a throw as `error` and keeps the last
// good quote on screen; a first-load failure still renders nothing (there is no quote to show).
export const quoteFetcher = sectionFetcher

// The shared coercion — see toNum's comment for why the obvious
// one-liner turns every missing value into a real zero.
const n = toNum

export function fmtPrice(v) {
  const x = n(v)
  return x == null ? '—' : formatCurrency(x)
}

export function fmtVol(v) {
  const x = n(v)
  return x == null ? '—' : formatCompactTerminal(x)
}

export default function QuoteStrip({ sym }) {
  // useMobileSWR, not bare useSWR: this polls, and the opt-in wrapper is what
  // backs off when the tab is hidden, stretches the interval 10x once the
  // market is fully closed, and doubles it on mobile. A quote that re-fetches
  // every 60s all weekend is pure battery and API spend for a number that
  // cannot change.
  const { data } = useMobileSWR(sym ? `/api/research/quote/${sym}` : null, quoteFetcher, {
    refreshInterval: 60_000,
    marketHoursOnly: true,
    revalidateOnFocus: false,
  })
  // `data.price` still gates the render even though the price is no longer
  // DRAWN: it is the field that says this payload is a real quote rather than
  // an empty shell, and OHLC without it is not worth a row of chrome.
  if (!sym || !data || data.price == null) return null

  return (
    <div className={styles.strip} data-testid="quote-strip">
      <span className={styles.cells}>
        <span className={styles.cell}><b>O</b> {fmtPrice(data.open)}</span>
        <span className={styles.cell}><b>H</b> {fmtPrice(data.high)}</span>
        <span className={styles.cell}><b>L</b> {fmtPrice(data.low)}</span>
        <span className={styles.cell}><b>PC</b> {fmtPrice(data.prev_close)}</span>
        <span className={styles.cell}><b>VOL</b> {fmtVol(data.volume)}</span>
      </span>
    </div>
  )
}
