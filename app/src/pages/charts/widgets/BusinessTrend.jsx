/**
 * PROTOTYPE — Overview "Business trend".
 *
 * Two micro bar strips, Revenue above EPS, sharing ONE year axis. Deliberately
 * not a dual-axis line: revenue is in billions and EPS in dollars, and drawing
 * them on one scale would invent a crossing point that means nothing. Stacking
 * two strips against a shared axis keeps the only comparison that is real —
 * "do these two shapes agree?" — and makes it a single glance.
 *
 * Bars, not lines, because these are magnitudes at discrete fiscal years, not a
 * continuous series; a line implies values between the years that do not exist.
 *
 * REPORTED YEARS ONLY — see the note on `rows`. The estimate-as-outline
 * treatment survives in the CSS/geometry in case that decision is revisited.
 *
 * Reuses the panel's own tokens; no chart library, ~90px total.
 */
import { useMemo } from 'react'
import MiniBars from './MiniBars'
import styles from './dockPanels.module.css'
import { currencyPrefix, formatCompact, isForeignCurrency, normalizeCurrencyCode } from '../../../lib/presentation/presentationPrimitives'

const shortFy = (label, year) =>
  (label ? String(label).replace(/^FY(\d{2})(\d{2})/, 'FY$2') : `FY${String(year).slice(2)}`)

/** One metric's strip: a label over the shared MiniBars grammar. */
function Strip({ title, rows, format }) {
  return (
    <div className={styles.btStrip}>
      <div className={styles.btLabel}>{title}</div>
      <MiniBars
        values={rows.map(r => r.value)}
        labels={rows.map(r => r.label)}
        format={format}
      />
    </div>
  )
}

// TERM-066: the K/M/B/T decision lives in lib/presentation (formatCompact); this keeps its
// own ladder and sign rule (formatCompact only sees the magnitude). Exported for the
// frozen-oracle test (widgetFormatters.term066.test.js).
const MONEY_TIERS = [
  { at: 1e12, suffix: 'T', decimals: 2 },
  { at: 1e9, suffix: 'B', decimals: 1 },
  { at: 1e6, suffix: 'M', decimals: 0 },
]
// `ccy` = the earnings-intel payload's reporting currency (TSM -> "TWD"). Revenue prints in it,
// never "$"; EPS prints WITHOUT a symbol for a non-USD filer, because its EPS leg can be a
// per-ADR figure in another currency -- the same rule EE/FA follow (earnings_intel
// `_reporting_currency`). USD or unknown renders exactly as before (accuracy follow-up 7).
export const fmtMoney = (v, ccy) => {
  const prefix = currencyPrefix(ccy)
  const a = Math.abs(v)
  const s = v < 0 ? '-' : ''
  if (a < 1e6) return `${s}${prefix}${a.toFixed(0)}`
  return `${s}${formatCompact(a, { tiers: MONEY_TIERS, prefix })}`
}
export const fmtEps = (v, ccy) => `${v < 0 ? '-' : ''}${isForeignCurrency(ccy) ? '' : '$'}${Math.abs(v).toFixed(2)}`

/**
 * @param annual  { reported: [...], estimates: [...] } from /api/earnings-intel
 * @param years   how many fiscal years of history to draw
 * @param currency the payload's reporting currency (`currency`), null = unknown
 */
export default function BusinessTrend({ annual, years = 5, currency = null }) {
  const rows = useMemo(
    // REPORTED YEARS ONLY. A forward estimate was prototyped here and removed
    // after looking at it: on Micron the FY26 consensus is ~3.5x the largest
    // actual, so putting it on the same scale squashed every reported year into
    // a ~4px sliver and made FY23's revenue HALVING invisible. A chart whose job
    // is "is the business getting stronger" cannot hide the year it got weaker.
    // Forward expectations already have a home — the Earnings tab's Estimates.
    () => (annual?.reported || []).slice(0, years).reverse(),
    [annual, years])

  if (rows.length < 3) return null      // two points is not a trend

  const axis = rows.map(r => shortFy(r.label, r.fiscal_year))
  const revRows = rows.map(r => ({ value: r.revenue, label: r.label, estimate: r.estimate }))
  const epsRows = rows.map(r => ({ value: r.eps, label: r.label, estimate: r.estimate }))

  return (
    <section className={`${styles.section} ${styles.layerBreak}`}>
      <div className={styles.secHead}>Business trend</div>
      <Strip title={isForeignCurrency(currency) ? `Revenue (${normalizeCurrencyCode(currency)})` : 'Revenue'}
        rows={revRows} format={(v) => fmtMoney(v, currency)} />
      <Strip title="EPS" rows={epsRows} format={(v) => fmtEps(v, currency)} />
      <div className={styles.btAxis} style={{ gridTemplateColumns: `repeat(${axis.length}, 1fr)` }}>
        {axis.map((a, i) => (
          <span key={a + i} className={`${styles.btYear}${rows[i].estimate ? ' ' + styles.btYearEst : ''}`}>{a}</span>
        ))}
      </div>
    </section>
  )
}
