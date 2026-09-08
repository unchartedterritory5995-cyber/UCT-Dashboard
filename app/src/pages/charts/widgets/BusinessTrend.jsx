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

const fmtMoney = (v) => {
  const a = Math.abs(v)
  if (a >= 1e12) return `${v < 0 ? '-' : ''}$${(a / 1e12).toFixed(2)}T`
  if (a >= 1e9) return `${v < 0 ? '-' : ''}$${(a / 1e9).toFixed(1)}B`
  if (a >= 1e6) return `${v < 0 ? '-' : ''}$${(a / 1e6).toFixed(0)}M`
  return `${v < 0 ? '-' : ''}$${a.toFixed(0)}`
}
const fmtEps = (v) => `${v < 0 ? '-' : ''}$${Math.abs(v).toFixed(2)}`

/**
 * @param annual  { reported: [...], estimates: [...] } from /api/earnings-intel
 * @param years   how many fiscal years of history to draw
 */
export default function BusinessTrend({ annual, years = 5 }) {
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
      <Strip title="Revenue" rows={revRows} format={fmtMoney} />
      <Strip title="EPS" rows={epsRows} format={fmtEps} />
      <div className={styles.btAxis} style={{ gridTemplateColumns: `repeat(${axis.length}, 1fr)` }}>
        {axis.map((a, i) => (
          <span key={a + i} className={`${styles.btYear}${rows[i].estimate ? ' ' + styles.btYearEst : ''}`}>{a}</span>
        ))}
      </div>
    </section>
  )
}
