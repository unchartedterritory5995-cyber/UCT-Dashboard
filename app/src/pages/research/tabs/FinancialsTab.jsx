import { useState } from 'react'
import useFinancials from '../hooks/useFinancials'
import { MetricTrendChart, SeriesChart } from '../../../components/research-kit'
import { CHART_INK } from '../../../components/research-kit/charts/echartsCore'
import {
  formatCompactTerminal, formatCurrencyIn, formatNumber, formatPercent,
  isForeignCurrency, isKnownCurrency, normalizeCurrencyCode, relabelDollarText, reportingCurrencyNote,
} from '../../../lib/presentation/presentationPrimitives'
import { signedPct } from '../researchFormat'
import { themeInk } from '../themeInk'
import ResearchLoading from '../ResearchLoading'
import SourceLine from '../../../components/research/fmpDepth/SourceLine'
import styles from '../ResearchPage.module.css'

const fmtBig = (v) => formatCompactTerminal(v, { money: true })
// Statement amounts are in the company's REPORTING currency, carried as `currency`
// from whichever source supplied the grids: TSM's revenue is Taiwan dollars, and
// "$" on it was the defect. A non-USD amount carries its ISO code ("TWD 1.06T");
// known USD renders "$"; an UNKNOWN currency renders no symbol and the tab says
// "Currency not reported." (owner decision 2026-10-07 -- never a guessed "$").
// Nothing is converted.
const UNKNOWN_CCY = { unknown: 'none' }
const fmtBigIn = (v, ccy) => relabelDollarText(fmtBig(v), ccy, UNKNOWN_CCY)
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
            {rows.map((r, i) => (
              // Position in the key: two period ends can share one label (a 53-week
              // year puts two in one calendar quarter).
              <tr key={`${r.period}-${i}`}>
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
          label={isForeignCurrency(ccy) ? `Revenue (${normalizeCurrencyCode(ccy)} B)` : isKnownCurrency(ccy) ? 'Revenue ($B)' : 'Revenue (B)'}
          valueFormatter={(v) => (v == null ? '—' : `${formatCurrencyIn(v, ccy, { decimals: 1, ...UNKNOWN_CCY })}B`)}
          ariaLabel="Revenue by period"
        />
        <MetricTrendChart
          periods={periods}
          values={list.map(r => r.eps)}
          label={isForeignCurrency(ccy) ? `EPS (${normalizeCurrencyCode(ccy)})` : 'EPS'}
          valueFormatter={(v) => formatCurrencyIn(v, ccy, UNKNOWN_CCY)}
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

// The vendor name the route uses for the FMP statements feed.
const FMP = 'FMP'
const BASIS_LABEL = { quarterly: 'Quarterly', annual: 'Annual' }

/**
 * Which source supplied the grids for THIS ticker, in words, under them.
 *
 * Read off the payload (`sources.statements`), never assumed from the caller: the
 * route reads the FMP statements first and the Yahoo frames only for a
 * ticker that feed returned nothing for, so the answer differs per ticker. A
 * payload that names no source (no grid rows at all) gets no line.
 */
function StatementsSource({ fin }) {
  const vendor = fin.sources?.statements
  if (!vendor) return null
  if (vendor === FMP) {
    return (
      <SourceLine vendor={vendor}
                  activity="FMP quarterly and annual income statements"
                  fetchedAt={fin.sources.statements_fetched_at}
                  detail="Revenue, EPS and margin grids · fiscal periods" />
    )
  }
  return (
    <SourceLine vendor={vendor} fallback
                activity="Yahoo Finance quarterly and annual income statements"
                reason={fin.fmp_unavailable
                  ? 'FMP statement history could not be read right now; showing Yahoo Finance (about 5 years / 5 quarters, calendar-quarter labels).'
                  : 'FMP holds no statement history for this ticker; showing Yahoo Finance (about 5 years / 5 quarters, calendar-quarter labels).'} />
  )
}

/**
 * One grid has rows and this one does not: say which, and whether that is a
 * finding or a failed read (`unread`), instead of leaving a silent hole.
 */
function GridGap({ basis, fin }) {
  // On the fallback, `unread` lists the fallback's own failed reads; an FMP
  // read that failed first (`fmp_unavailable`) leaves this grid just as unread.
  const fmpFailed = fin.fmp_unavailable === true && fin.sources?.statements !== FMP
  const unread = (fin.unread || []).includes(basis) || fmpFailed
  return (
    <div className={styles.fnote} data-testid={`financials-gap-${basis}`} data-unread={unread ? 'true' : 'false'}>
      {unread
        ? `${BASIS_LABEL[basis]} statements could not be read right now.`
        : `${BASIS_LABEL[basis]} statements are not available for this ticker.`}
    </div>
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
  // A failed read is not a finding: the route marks the grids it could not read
  // (`unread`) and an FMP read that failed (`fmp_unavailable`).
  const couldNotRead = (fin.unread?.length > 0) || fin.fmp_unavailable === true
  const ccy = fin.currency ?? null
  const ccyNote = reportingCurrencyNote(ccy, UNKNOWN_CCY)
  // tq-panels: the route marks a fund (`not_applicable: 'fund'` + `reason`, e910f8ff6);
  // say that instead of a generic "unavailable" that reads like a gap.
  if (!hasGrids && fin.not_applicable) {
    return <div className={styles.fnote} data-testid="financials-na">Not applicable to funds: {fin.reason || `${sym} is a fund`}.</div>
  }

  return (
    <div className={styles.finWrap}>
      {/* S3 continuation (owner authorization, 2026-09-03): entity
          resolution flows through get_financials(), reported honestly when
          it hasn't happened yet. The source line under the grids names the
          vendor the ROUTE says supplied them for this ticker; a payload that
          names none gets no line -- a source badge on a number nobody
          attributed would be exactly the fabricated-provenance failure S8
          exists to prevent. */}
      {fin.entity && fin.entity.status !== 'resolved' && (
        <div className={styles.entityNote} data-testid="entity-unresolved-note">
          This symbol is not yet linked to a company record, so some sources below may not match it.
        </div>
      )}
      {/* The grids read the same FMP statements as StatementPanels and
          carry the same FISCAL period labels, so a September-fiscal-year
          company's quarter is "Q3 2026" in both. Only a ticker that feed
          returned nothing for falls back to the Yahoo frames, which label
          CALENDAR quarters ("Q2 2026" for that same quarter); the source line
          under the grids says so. The composite Financials section still turns
          the grids off: its panels already chart these statements over 24
          quarters. */}
      {showGrids && hasGrids && ccyNote && (
        <div className={styles.fnote} data-testid="financials-currency" data-currency={normalizeCurrencyCode(ccy) ?? 'unknown'}>{ccyNote}</div>
      )}
      {showGrids && <TrendPair quarterly={fin.quarterly} annual={fin.annual} ccy={ccy} />}
      {showGrids && <GrowthGrid title="Quarterly — revenue, EPS & margins (YoY)" rows={fin.quarterly} ccy={ccy} />}
      {showGrids && hasGrids && !fin.quarterly?.length && <GridGap basis="quarterly" fin={fin} />}
      {showGrids && <GrowthGrid title="Annual — revenue, EPS & margins (YoY)" rows={fin.annual} ccy={ccy} />}
      {showGrids && hasGrids && !fin.annual?.length && <GridGap basis="annual" fin={fin} />}
      {showGrids && hasGrids && <StatementsSource fin={fin} />}
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
      {/* The summary cards are read by a different service from the grids. When
          the grids are labelled as the FMP feed's, the cards say whose they
          are, so one line is never read as covering both. */}
      {showGrids && hasGrids && fin.sources?.statements === FMP && fin.sources?.summary && (
        <SourceLine vendor={fin.sources.summary} testId="financials-summary-source"
                    activity={`${fin.sources.summary} company summary`}
                    detail="Balance sheet and profitability summary" />
      )}
      {!hasGrids && (couldNotRead
        ? <div className={styles.fnote} data-testid="financials-unread">Statement history could not be read right now.</div>
        : <div className={styles.fnote}>Statement history is unavailable for this ticker.</div>)}
    </div>
  )
}
