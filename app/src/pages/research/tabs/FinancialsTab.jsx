import { useState } from 'react'
import useFinancials from '../hooks/useFinancials'
import { MetricTrendChart, SeriesChart } from '../../../components/research-kit'
import { CHART_INK } from '../../../components/research-kit/charts/echartsCore'
import {
  formatCompactTerminal, formatCurrencyIn, formatNumber, formatPercent,
  isForeignCurrency, normalizeCurrencyCode, relabelDollarText, reportingCurrencyNote,
} from '../../../lib/presentation/presentationPrimitives'
import { signedPct } from '../researchFormat'
import { themeInk } from '../themeInk'
import ResearchLoading from '../ResearchLoading'
import styles from '../ResearchPage.module.css'

const fmtBig = (v) => formatCompactTerminal(v, { money: true })
// yfinance statement frames are in the company's REPORTING currency (Yahoo
// `financialCurrency`, carried as `currency`): TSM's revenue is Taiwan dollars, and
// "$" on it was the defect. A non-USD amount carries its ISO code ("TWD 1.06T");
// USD and unknown render exactly as before. Nothing is converted.
const fmtBigIn = (v, ccy) => relabelDollarText(fmtBig(v), ccy)
const fmtMargin = (v) => formatPercent(v, { decimals: 1 })
function fmtVal(v, suffix = '') { return v == null ? '—' : `${v}${suffix}` }

// yfinance states debt/equity as a PERCENT (150 = 1.5x) -- see
// api/services/metric_disagreement.py -- so it is shown as the ratio it means.
export function fmtDebtToEquity(v) {
  const n = Number(v)
  return v == null || v === '' || !Number.isFinite(n) ? '—' : `${formatNumber(n / 100, { decimals: 2 })}×`
}

function heat(v) {
  if (v == null) return ''
  if (v >= 25) return styles.heatPos2
  if (v > 0) return styles.heatPos1
  if (v <= -25) return styles.heatNeg2
  if (v < 0) return styles.heatNeg1
  return ''
}

function GrowthGrid({ title, rows, ccy }) {
  if (!rows?.length) return null
  return (
    <section className={styles.card}>
      <div className={styles.ct}>{title}</div>
      <div className={styles.gridScroll}>
        <table className={styles.fgrid} aria-label={title}>
          <thead>
            <tr>
              <th scope="col">Period</th><th scope="col">Revenue</th><th scope="col">Rev YoY</th>
              <th scope="col">{isForeignCurrency(ccy) ? `EPS, ${normalizeCurrencyCode(ccy)}` : 'EPS'}</th><th scope="col">EPS YoY</th>
              <th scope="col">Gross</th><th scope="col">Op</th><th scope="col">Net</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.period}>
                <td className={styles.fperiod}>{r.period}</td>
                <td>{fmtBigIn(r.revenue, ccy)}</td>
                <td className={heat(r.revenue_yoy)}>{signedPct(r.revenue_yoy)}</td>
                <td>{formatNumber(r.eps, { decimals: 2 })}</td>
                <td className={heat(r.eps_yoy)}>{signedPct(r.eps_yoy)}</td>
                <td>{fmtMargin(r.gross_margin)}</td>
                <td>{fmtMargin(r.operating_margin)}</td>
                <td>{fmtMargin(r.net_margin)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}


const B = (v) => (v == null ? null : v / 1e9)

/**
 * Revenue and EPS as trends, above the grid that carries the exact figures.
 *
 * The rows arrive NEWEST FIRST, which is right for a table and wrong for a
 * chart — plotted as given, time runs backwards and every trend reads inverted.
 * Reversed once, here, rather than in each chart.
 */
function TrendPair({ quarterly, annual, ccy }) {
  // Both series are already fetched; only quarterly was ever charted. A
  // quarterly/annual toggle is the TradingView pattern and costs no extra
  // request — quarters show the near-term shape, years show whether the
  // business is actually compounding.
  const [basis, setBasis] = useState('quarterly')
  const rows = basis === 'annual' ? annual : quarterly
  const other = basis === 'annual' ? quarterly : annual
  const list = Array.isArray(rows) ? [...rows].reverse() : []
  // Offer the toggle only for a basis that HAS data, so it can never switch to
  // an empty chart.
  const canToggle = (other || []).length >= 2
  if (list.length < 2) {
    // The requested basis is empty but the other one is not — fall back rather
    // than render nothing at all.
    if (!canToggle) return null
    return (
      <section className={styles.card}>
        <div className={styles.ct}>Trend</div>
        <button type="button" className={styles.basisBtn}
                onClick={() => setBasis(basis === 'annual' ? 'quarterly' : 'annual')}>
          Show {basis === 'annual' ? 'quarterly' : 'annual'}
        </button>
      </section>
    )
  }
  const periods = list.map(r => r.period)
  return (
    <section className={styles.card}>
      <div className={styles.trendHead}>
        <div className={styles.ct}>{basis === 'annual' ? 'Annual trend' : 'Quarterly trend'}</div>
        {canToggle && (
          <div className={styles.basisToggle} role="group" aria-label="Reporting basis">
            <button type="button" aria-pressed={basis === 'quarterly'}
                    className={basis === 'quarterly' ? styles.basisOn : styles.basisOff}
                    onClick={() => setBasis('quarterly')}>Quarterly</button>
            <button type="button" aria-pressed={basis === 'annual'}
                    className={basis === 'annual' ? styles.basisOn : styles.basisOff}
                    onClick={() => setBasis('annual')}>Annual</button>
          </div>
        )}
      </div>
      <div className={styles.grid}>
        <MetricTrendChart
          periods={periods}
          values={list.map(r => B(r.revenue))}
          label={isForeignCurrency(ccy) ? `Revenue (${normalizeCurrencyCode(ccy)} B)` : 'Revenue ($B)'}
          valueFormatter={(v) => (v == null ? '—' : `${formatCurrencyIn(v, ccy, { decimals: 1 })}B`)}
          ariaLabel="Revenue by period"
        />
        <MetricTrendChart
          periods={periods}
          values={list.map(r => r.eps)}
          label={isForeignCurrency(ccy) ? `EPS (${normalizeCurrencyCode(ccy)})` : 'EPS'}
          valueFormatter={(v) => formatCurrencyIn(v, ccy)}
          ariaLabel="Earnings per share by period"
        />
      </div>
      {/* Margins share one axis because the question is whether the SPREAD
          between them is widening — three separate charts would hide exactly
          that. Colours are explicit per series, never PALETTE[i]. */}
      <SeriesChart
        periods={periods}
        mode="line"
        label="Margins"
        valueFormatter={fmtMargin}
        ariaLabel="Gross, operating and net margin by period"
        series={[
          // Canvas inks resolved from the app tokens (themeInk), never hexes, so the
          // three margins follow the member's theme: gold, info blue, gain green.
          { name: 'Gross', color: themeInk('--ut-gold', CHART_INK.gold), values: list.map(r => r.gross_margin) },
          { name: 'Operating', color: themeInk('--info', CHART_INK.text), values: list.map(r => r.operating_margin) },
          { name: 'Net', color: themeInk('--gain', CHART_INK.gain), values: list.map(r => r.net_margin) },
        ]}
      />
    </section>
  )
}

export default function FinancialsTab({ sym, showGrids = true }) {
  const { data, isLoading, error, mutate } = useFinancials(sym)

  if (isLoading) {
    return <ResearchLoading label="Loading financials" />
  }

  // TERM-088 -- a failed read is not an empty statement history. Render the
  // error distinctly so a backend hiccup never reads as "no financials
  // available".
  if (error) {
    return (
      <div className={styles.fnote} data-testid="financials-error">
        Couldn't load financials for this ticker.
        {' '}
        <button type="button" className={styles.basisBtn} onClick={() => mutate()}>Retry</button>
      </div>
    )
  }

  const fin = data || {}
  const bal = fin.balance || {}
  const met = fin.metrics || {}
  const hasGrids = (fin.quarterly?.length || fin.annual?.length)
  const ccy = fin.currency ?? null
  const ccyNote = reportingCurrencyNote(ccy)
  // tq-panels: the route marks a fund (`not_applicable: 'fund'` + `reason`, e910f8ff6);
  // say that instead of a generic "unavailable" that reads like a gap.
  if (!hasGrids && fin.not_applicable) {
    return <div className={styles.fnote} data-testid="financials-na">Not applicable to funds — {fin.reason || `${sym} is a fund`}.</div>
  }

  return (
    <div className={styles.finWrap}>
      {/* S3 continuation (owner authorization, 2026-09-03): entity
          resolution now flows through get_financials(), reported honestly
          when it hasn't happened yet -- but NO <Provenance>/<FreshnessBadge>
          UI on this tab this pass. Unlike Estimates, none of this tab's
          displayed VALUES are D1-sourced yet (see useFinancials.js's
          backend, financials.py's own module docstring: the FMP statement
          endpoints are an explicitly deferred enhancement, their field
          shapes unverified anywhere in this codebase) -- attaching a trust
          badge to a number D1 didn't actually produce would be exactly the
          fabricated-provenance failure S8 exists to prevent. */}
      {fin.entity && fin.entity.status !== 'resolved' && (
        <div className={styles.entityNote} data-testid="entity-unresolved-note">
          This symbol is not yet linked to a company record, so some sources below may not match it.
        </div>
      )}
      {/* ⚠️ These grids are yfinance-derived and label CALENDAR quarters. FMP,
          which feeds StatementPanels, returns the FISCAL period — so for a
          September-fiscal-year company like AAPL the same quarter appears as
          "Q3 2026" in the panels and "Q2 2026" here, with identical revenue.
          Two names for one quarter on one screen is worse than one fewer
          table, so the composite Financials section turns them off; the panels
          supersede them with 24 quarters instead of 5. Standalone callers keep
          them until the label source is fixed. */}
      {showGrids && hasGrids && ccyNote && (
        <div className={styles.fnote} data-testid="financials-currency" data-currency={normalizeCurrencyCode(ccy)}>{ccyNote}</div>
      )}
      {showGrids && <TrendPair quarterly={fin.quarterly} annual={fin.annual} ccy={ccy} />}
      {showGrids && <GrowthGrid title="Quarterly — revenue, EPS & margins (YoY)" rows={fin.quarterly} ccy={ccy} />}
      {showGrids && <GrowthGrid title="Annual — revenue, EPS & margins (YoY)" rows={fin.annual} ccy={ccy} />}
      <div className={styles.grid}>
        <section className={styles.card}>
          <div className={styles.ct}>Balance sheet</div>
          <div className={styles.kv}><span>Cash</span><b>{fmtVal(bal.cash)}</b></div>
          <div className={styles.kv}><span>Total debt</span><b>{fmtVal(bal.total_debt)}</b></div>
          <div className={styles.kv}><span>Debt / equity</span><b data-testid="debt-to-equity">{fmtDebtToEquity(bal.debt_to_equity)}</b></div>
          <div className={styles.kv}><span>Current ratio</span><b>{fmtVal(bal.current_ratio)}</b></div>
          <div className={styles.kv}><span>Free cash flow</span><b>{fmtVal(bal.fcf)}</b></div>
        </section>
        <section className={styles.card}>
          <div className={styles.ct}>Profitability</div>
          <div className={styles.kv}><span>ROE</span><b>{fmtVal(met.roe, '%')}</b></div>
          <div className={styles.kv}><span>ROA</span><b>{fmtVal(met.roa, '%')}</b></div>
          <div className={styles.kv}><span>Gross margin</span><b>{fmtVal(met.gross_margin, '%')}</b></div>
          <div className={styles.kv}><span>Operating margin</span><b>{fmtVal(met.operating_margin, '%')}</b></div>
          <div className={styles.kv}><span>Net margin</span><b>{fmtVal(met.net_margin, '%')}</b></div>
        </section>
      </div>
      {!hasGrids && <div className={styles.fnote}>Statement history is unavailable for this ticker.</div>}
    </div>
  )
}
