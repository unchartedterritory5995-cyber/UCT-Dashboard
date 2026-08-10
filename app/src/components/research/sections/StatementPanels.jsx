// app/src/components/research/sections/StatementPanels.jsx
//
// Six statement panels over 24 quarters — the shape a fundamentals page wants:
// small multiples you can scan in one pass, rather than a grid of numbers.
//
// Fed by /api/research/financial-history, which reads FMP (24q / 12y). The
// older /api/research/financials reads yfinance and returns about five
// quarters; five points cannot show a cycle, so a business compounding for six
// years and one that just bounced look identical.
//
// Pairs share a panel where the RELATIONSHIP is the point — revenue against
// operating income, gross profit against opex, assets against liabilities.
import { useState } from 'react'
import useSWR from 'swr'
import { SeriesChart } from '../../research-kit'
import { SkeletonBlock } from '../../Skeleton'
import styles from './StatementPanels.module.css'

const fetcher = (u) => fetch(u).then((r) => (r.ok ? r.json() : null)).catch(() => null)

const INK = {
  revenue: '#5aa9e6',
  opinc: '#e8a33d',
  net: '#c9a84c',
  cash: '#3ec9c9',
  gross: '#5aa9e6',
  opex: '#e57373',
  eps: '#a97bd6',
  assets: '#7ed957',
  liab: '#e57373',
}

/** $1.59B / $48.8M / -$450M — a statement axis spans nine orders of magnitude. */
export function money(v) {
  if (v == null || !Number.isFinite(Number(v))) return '—'
  const n = Number(v)
  const a = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (a >= 1e12) return `${sign}$${(a / 1e12).toFixed(2)}T`
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(1)}M`
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(1)}K`
  return `${sign}$${a.toFixed(0)}`
}

const eps = (v) => (v == null ? '—' : `$${Number(v).toFixed(2)}`)

/** The six panels, declared as data so the grid cannot drift from the legend. */
export const PANEL_SPECS = [
  { key: 'income', title: 'Income statement', fmt: money, series: [
    ['revenue', 'Revenue', INK.revenue], ['operating_income', 'Operating income', INK.opinc]] },
  { key: 'net', title: 'Net income', fmt: money, series: [
    ['net_income', 'Net income', INK.net]] },
  { key: 'cash', title: 'Cash flow', fmt: money, series: [
    ['free_cash_flow', 'Free cash flow', INK.cash]] },
  { key: 'gross', title: 'Gross profit & opex', fmt: money, series: [
    ['gross_profit', 'Gross profit', INK.gross], ['operating_expenses', 'Operating expenses', INK.opex]] },
  { key: 'eps', title: 'Earnings per share', fmt: eps, series: [
    ['eps', 'EPS', INK.eps]] },
  { key: 'balance', title: 'Balance sheet', fmt: money, series: [
    ['total_assets', 'Total assets', INK.assets], ['total_liabilities', 'Total liabilities', INK.liab]] },
]


/**
 * The same period one year earlier, aligned to each point.
 *
 * Quarterly statements are seasonal — a retailer's Q4 dwarfs its Q1 every year,
 * so consecutive bars mostly measure the calendar. Against the year-ago bar the
 * question becomes "is this quarter better than the comparable one", which is
 * the one worth asking.
 *
 * Offset by FOUR for quarters and ONE for years. The first four quarters have
 * no comparison and get null — a gap, never a zero, since a zero bar reads as
 * a business that earned nothing.
 */
export function yoyShift(values, period) {
  const back = period === 'annual' ? 1 : 4
  const v = values || []
  return v.map((_, i) => (i >= back ? v[i - back] : null))
}

export default function StatementPanels({ sym }) {
  const [period, setPeriod] = useState('quarter')
  const [yoy, setYoy] = useState(true)
  const { data } = useSWR(
    sym ? `/api/research/financial-history/${sym}?period=${period}` : null,
    fetcher,
    { revalidateOnFocus: false },
  )

  const periods = data?.periods || []
  const series = data?.series || {}
  if (!sym) return null

  if (!periods.length) {
    // `data === undefined` is still in flight; a resolved payload with no
    // periods is a real absence. Only the first deserves a skeleton — showing
    // one for the second would promise content that is never coming.
    if (data === undefined) {
      return (
        <div className={styles.wrap}>
          <div className={styles.grid} aria-hidden="true">
            {PANEL_SPECS.map((spec) => (
              <section key={spec.key} className={styles.panel}>
                <div className={styles.title}>{spec.title}</div>
                <SkeletonBlock height={168} />
              </section>
            ))}
          </div>
        </div>
      )
    }
    return (
      <div className={styles.wrap}>
        <p className={styles.note}>Statement history is unavailable for this ticker.</p>
      </div>
    )
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <span className={styles.count}>
          {periods.length} {period === 'annual' ? 'years' : 'quarters'} ·{' '}
          {periods[0]} – {periods[periods.length - 1]}
        </span>
        <label className={styles.yoy}>
          <input type="checkbox" checked={yoy} onChange={e => setYoy(e.target.checked)} />
          Year-ago
        </label>
        <div className={styles.toggle} role="group" aria-label="Reporting period">
          <button type="button" aria-pressed={period === 'quarter'}
                  className={period === 'quarter' ? styles.on : styles.off}
                  onClick={() => setPeriod('quarter')}>Quarterly</button>
          <button type="button" aria-pressed={period === 'annual'}
                  className={period === 'annual' ? styles.on : styles.off}
                  onClick={() => setPeriod('annual')}>Annual</button>
        </div>
      </div>

      <div className={styles.grid}>
        {PANEL_SPECS.map((spec) => (
          <section key={spec.key} className={styles.panel}>
            <div className={styles.title}>{spec.title}</div>
            <SeriesChart
              periods={periods}
              mode="bars"
              height={168}
              valueFormatter={spec.fmt}
              ariaLabel={`${spec.title} by period`}
              series={[
                // Ghost first so the current bar draws IN FRONT of it — the
                // comparison is context, not the subject.
                ...(yoy ? spec.series.map(([field, name]) => ({
                  name: `${name} (yr ago)`,
                  color: 'rgba(255,255,255,.20)',
                  values: yoyShift(series[field] || [], period),
                })) : []),
                ...spec.series.map(([field, name, color]) => ({
                  name, color, values: series[field] || [],
                })),
              ]}
            />
          </section>
        ))}
      </div>
    </div>
  )
}
