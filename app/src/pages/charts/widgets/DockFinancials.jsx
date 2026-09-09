/**
 * DockFinancials — the Financials tab of the Company Intelligence panel.
 *
 * A full Income Statement / Balance Sheet / Cash Flow, Annual · Quarterly · TTM,
 * from /api/fundamentals-statements (yfinance — no new paid provider).
 *
 * DESIGN NOTES (the non-obvious decisions):
 *
 * • INDUSTRY ADAPTATION IS DATA-DRIVEN, NOT HARDCODED. A bank has no Gross
 *   Profit / EBITDA line (JPM's statement carries 37 rows to Micron's 52), so
 *   any row that is null in EVERY period is dropped for that company, and a
 *   section whose rows all vanish drops with it. No per-industry templates, and
 *   no columns of "—" pretending to be a statement.
 *
 * • YoY COLOUR IS AN INVESTOR CLAIM, NOT ARITHMETIC. Green/red is spent only on
 *   metrics where "up" is reliably good (revenue, profit, cash generation).
 *   Costs, liabilities, tax, share count and the ambiguous middle of the
 *   statement get an uncoloured YoY: still signed, still precise, but never
 *   implying that expenses doubling is bullish. See `dir: 'signed'`.
 *
 * • PERIOD DEPTH IS WHAT THE SOURCE ACTUALLY HAS. yfinance returns ~4-5 annual
 *   and ~5-7 quarterly periods, so 5Y CAGR is NOT computable and is never shown;
 *   3Y is, when four annual points exist and both endpoints are positive.
 *
 * • Derived rows (margins, FCF margin, CAGR) are computed locally and marked as
 *   calculated in their tooltip. Missing data is "—". Nothing is fabricated.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import useMobileSWR from '../../../hooks/useMobileSWR'
import Spark from './Spark'
import MiniBars from './MiniBars'
import styles from './dockPanels.module.css'

const jsonFetcher = (url) => fetch(url).then(r => (r.ok ? r.json() : null))

const STATEMENTS = [
  { key: 'income', label: 'Income' },
  { key: 'balance', label: 'Balance' },
  { key: 'cashflow', label: 'Cash Flow' },
]
// Securities that legitimately have no company financial statements.
const FUND_TYPES = new Set(['etf', 'mutualfund', 'index', 'currency', 'cryptocurrency', 'future'])
const PERIODS = [
  { key: 'annual', label: 'Annual' },
  { key: 'quarterly', label: 'Quarterly' },
  { key: 'ttm', label: 'TTM', tip: 'Trailing twelve months — the sum of the last four reported quarters.' },
]

/* Row flags:
 *   sec    section heading (structure only, no data)
 *   k      key metric — heavier weight + a sparkline
 *   m      derived margin (indented, italic); derive: [numerator, denominator]
 *   dir    'signed' → YoY may be green/red. Omitted → YoY stays neutral.
 *   fmt    money | eps | shares | pct
 *   cagr   eligible for a CAGR readout when expanded
 */
const SCHEMA = {
  income: [
    // Section names stay true for companies that lack the lines they'd name:
    // a bank has no gross profit and no operating income, so "Revenue & Gross
    // Profit" / "Below Operating Income" would head sections containing neither.
    { sec: 'Revenue' },
    { key: 'revenue', label: 'Revenue', fmt: 'money', k: true, dir: 'signed', cagr: true, tip: 'Total top-line sales for the period, as reported.' },
    { key: 'cost_of_revenue', label: 'Cost of Revenue', fmt: 'money' },
    { key: 'gross_profit', label: 'Gross Profit', fmt: 'money', k: true, dir: 'signed', cagr: true },
    { key: 'gross_margin', label: 'Gross Margin', fmt: 'pct', m: true, derive: ['gross_profit', 'revenue'], tip: 'Gross Profit ÷ Revenue (calculated).' },

    { sec: 'Operating Performance' },
    { key: 'operating_expense', label: 'Operating Expense', fmt: 'money' },
    { key: 'rnd', label: 'R&D', fmt: 'money' },
    { key: 'sga', label: 'SG&A', fmt: 'money' },
    { key: 'other_opex', label: 'Other Operating Exp.', fmt: 'money' },
    { key: 'total_expenses', label: 'Total Expenses', fmt: 'money' },
    { key: 'operating_income', label: 'Operating Income', fmt: 'money', k: true, dir: 'signed', cagr: true },
    { key: 'operating_margin', label: 'Operating Margin', fmt: 'pct', m: true, derive: ['operating_income', 'revenue'], tip: 'Operating Income ÷ Revenue (calculated).' },
    { key: 'ebitda', label: 'EBITDA', fmt: 'money', k: true, dir: 'signed', cagr: true, tip: 'Earnings before interest, taxes, depreciation and amortisation.' },
    { key: 'ebitda_margin', label: 'EBITDA Margin', fmt: 'pct', m: true, derive: ['ebitda', 'revenue'], tip: 'EBITDA ÷ Revenue (calculated).' },
    { key: 'ebit', label: 'EBIT', fmt: 'money', tip: 'Earnings before interest and taxes.' },

    { sec: 'Interest, Other & Tax' },
    { key: 'interest_income', label: 'Interest Income', fmt: 'money' },
    { key: 'interest_expense', label: 'Interest Expense', fmt: 'money' },
    { key: 'net_interest_income', label: 'Net Interest Income', fmt: 'money', tip: 'For lenders this is the core revenue line.' },
    { key: 'other_income_expense', label: 'Other Income / Expense', fmt: 'money' },
    { key: 'pretax_income', label: 'Pretax Income', fmt: 'money', dir: 'signed' },
    { key: 'tax', label: 'Income Tax', fmt: 'money' },
    { key: 'tax_rate', label: 'Effective Tax Rate', fmt: 'pct', m: true, tip: 'Effective rate as reported by the filing.' },

    { sec: 'Net Income & EPS' },
    { key: 'net_income', label: 'Net Income', fmt: 'money', k: true, dir: 'signed', cagr: true },
    { key: 'net_margin', label: 'Net Margin', fmt: 'pct', m: true, derive: ['net_income', 'revenue'], tip: 'Net Income ÷ Revenue (calculated).' },
    { key: 'net_income_common', label: 'Net Income to Common', fmt: 'money' },
    { key: 'eps_diluted', label: 'Diluted EPS', fmt: 'eps', k: true, dir: 'signed', cagr: true },
    { key: 'eps_basic', label: 'Basic EPS', fmt: 'eps' },

    { sec: 'Shares' },
    { key: 'shares_diluted', label: 'Diluted Shares', fmt: 'shares', k: true, tip: 'Falling = buybacks shrinking the share count. Rising = dilution.' },
    { key: 'shares_basic', label: 'Basic Shares', fmt: 'shares' },
  ],
  balance: [
    { sec: 'Assets' },
    { key: 'cash', label: 'Cash & Equivalents', fmt: 'money', k: true, dir: 'signed' },
    { key: 'short_term_investments', label: 'Short-Term Investments', fmt: 'money' },
    { key: 'receivables', label: 'Receivables', fmt: 'money' },
    { key: 'inventory', label: 'Inventory', fmt: 'money', tip: 'Building inventory ahead of sales can signal a demand slowdown.' },
    { key: 'other_current_assets', label: 'Other Current Assets', fmt: 'money' },
    { key: 'current_assets', label: 'Total Current Assets', fmt: 'money', k: true },
    { key: 'ppe', label: 'Property, Plant & Equip.', fmt: 'money' },
    { key: 'accumulated_depreciation', label: 'Accum. Depreciation', fmt: 'money' },
    { key: 'goodwill', label: 'Goodwill', fmt: 'money' },
    { key: 'intangibles', label: 'Intangible Assets', fmt: 'money' },
    { key: 'long_term_investments', label: 'Long-Term Investments', fmt: 'money' },
    { key: 'other_noncurrent_assets', label: 'Other Non-Current Assets', fmt: 'money' },
    { key: 'noncurrent_assets', label: 'Total Non-Current Assets', fmt: 'money' },
    { key: 'total_assets', label: 'Total Assets', fmt: 'money', k: true },

    { sec: 'Liabilities' },
    { key: 'payables', label: 'Payables', fmt: 'money' },
    { key: 'current_debt', label: 'Short-Term Debt', fmt: 'money' },
    { key: 'other_current_liabilities', label: 'Other Current Liab.', fmt: 'money' },
    { key: 'current_liabilities', label: 'Total Current Liabilities', fmt: 'money', k: true },
    { key: 'long_term_debt', label: 'Long-Term Debt', fmt: 'money' },
    { key: 'capital_leases', label: 'Capital Leases', fmt: 'money' },
    { key: 'other_noncurrent_liabilities', label: 'Other Non-Current Liab.', fmt: 'money' },
    { key: 'noncurrent_liabilities', label: 'Total Non-Current Liab.', fmt: 'money' },
    { key: 'total_debt', label: 'Total Debt', fmt: 'money', k: true },
    { key: 'net_debt', label: 'Net Debt', fmt: 'money', tip: 'Total debt minus cash. Negative = net cash position.' },
    { key: 'total_liabilities', label: 'Total Liabilities', fmt: 'money', k: true },
    { key: 'working_capital', label: 'Working Capital', fmt: 'money' },

    { sec: 'Equity' },
    { key: 'common_stock', label: 'Common Stock', fmt: 'money' },
    { key: 'paid_in_capital', label: 'Additional Paid-In Capital', fmt: 'money' },
    { key: 'retained_earnings', label: 'Retained Earnings', fmt: 'money' },
    { key: 'treasury_stock', label: 'Treasury Stock', fmt: 'money' },
    { key: 'equity', label: "Shareholders' Equity", fmt: 'money', k: true, dir: 'signed' },
    { key: 'book_value', label: 'Tangible Book Value', fmt: 'money' },
    { key: 'shares_outstanding', label: 'Shares Outstanding', fmt: 'shares', k: true, tip: 'Falling = buybacks. Rising = dilution.' },
  ],
  cashflow: [
    { sec: 'Operating' },
    { key: 'net_income', label: 'Net Income', fmt: 'money' },
    { key: 'd_and_a', label: 'Depreciation & Amort.', fmt: 'money' },
    { key: 'sbc', label: 'Stock-Based Comp.', fmt: 'money', tip: 'A real cost to shareholders — rising SBC dilutes ownership.' },
    { key: 'change_receivables', label: 'Change in Receivables', fmt: 'money' },
    { key: 'change_inventory', label: 'Change in Inventory', fmt: 'money' },
    { key: 'change_payables', label: 'Change in Payables', fmt: 'money' },
    { key: 'change_wc', label: 'Change in Working Cap.', fmt: 'money' },
    { key: 'other_noncash', label: 'Other Non-Cash Items', fmt: 'money' },
    { key: 'operating_cf', label: 'Operating Cash Flow', fmt: 'money', k: true, dir: 'signed', cagr: true },

    { sec: 'Investing' },
    { key: 'capex', label: 'Capital Expenditures', fmt: 'money', k: true, tip: 'Reported as a negative number — cash spent on property and equipment.' },
    { key: 'acquisitions', label: 'Acquisitions, net', fmt: 'money' },
    { key: 'investments_purchased', label: 'Investments Purchased', fmt: 'money' },
    { key: 'investments_sold', label: 'Investments Sold', fmt: 'money' },
    { key: 'net_investments', label: 'Net Investment Activity', fmt: 'money' },
    { key: 'investing_cf', label: 'Investing Cash Flow', fmt: 'money' },

    { sec: 'Free Cash Flow' },
    { key: 'free_cash_flow', label: 'Free Cash Flow', fmt: 'money', k: true, dir: 'signed', cagr: true, tip: 'Operating cash flow minus capital expenditures — the cash the business actually generates.' },
    { key: 'fcf_margin', label: 'FCF Margin', fmt: 'pct', m: true, tip: 'Free Cash Flow ÷ Revenue (calculated).' },

    { sec: 'Financing' },
    { key: 'debt_issued', label: 'Debt Issued', fmt: 'money' },
    { key: 'debt_repaid', label: 'Debt Repaid', fmt: 'money' },
    { key: 'net_debt_issuance', label: 'Net Debt Issuance', fmt: 'money' },
    { key: 'stock_issued', label: 'Stock Issued', fmt: 'money' },
    { key: 'buybacks', label: 'Share Buybacks', fmt: 'money', k: true },
    { key: 'dividends_paid', label: 'Dividends Paid', fmt: 'money' },
    { key: 'financing_cf', label: 'Financing Cash Flow', fmt: 'money' },

    { sec: 'Cash Position' },
    { key: 'fx_effect', label: 'FX Effect on Cash', fmt: 'money' },
    { key: 'change_in_cash', label: 'Change in Cash', fmt: 'money', dir: 'signed' },
    { key: 'begin_cash', label: 'Beginning Cash', fmt: 'money' },
    { key: 'end_cash', label: 'Ending Cash', fmt: 'money', k: true },
  ],
}

// ── formatters ───────────────────────────────────────────────────────────────
function fmtMoney(v) {
  if (v == null) return '—'
  const a = Math.abs(v)
  const s = v < 0 ? '-' : ''
  if (a >= 1e12) return `${s}$${(a / 1e12).toFixed(2)}T`
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(1)}M`
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(1)}K`
  return `${s}$${a.toFixed(0)}`
}
function fmtSharesN(v) {
  if (v == null) return '—'
  const a = Math.abs(v)
  if (a >= 1e9) return `${(v / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `${(v / 1e6).toFixed(0)}M`
  return `${v}`
}
const fmtEpsN = (v) => (v == null ? '—' : `$${Number(v).toFixed(2)}`)
const fmtPctN = (v) => (v == null ? '—' : `${v.toFixed(1)}%`)
function fmtVal(v, kind) {
  if (kind === 'eps') return fmtEpsN(v)
  if (kind === 'shares') return fmtSharesN(v)
  if (kind === 'pct') return fmtPctN(v)
  return fmtMoney(v)
}
/**
 * @param magnitude compare |a| vs |b| when BOTH are negative.
 *
 * Outflow lines (capex, buybacks, dividends, debt repaid) are reported as
 * negatives, so the signed formula reports capex growing $8.4B → $15.9B as
 * "-89%" — literally true of the signed number, and the exact opposite of how
 * anyone reads it. For those rows compare magnitudes, so it reads "+89%", i.e.
 * spending up 89%. They are uncoloured, so a bigger number implies no verdict.
 *
 * Signed rows must NOT use magnitudes: a loss narrowing from -$5B to -$2B is a
 * genuine +60% improvement, and the signed formula already gets that right.
 */
function pctChange(a, b, magnitude) {
  if (a == null || b == null || b === 0) return null
  // A swing through zero (loss → profit) has no meaningful percentage.
  if ((a < 0) !== (b < 0)) return null
  if (magnitude && a < 0 && b < 0) return ((Math.abs(a) - Math.abs(b)) / Math.abs(b)) * 100
  return ((a - b) / Math.abs(b)) * 100
}
const fmtYoY = (v) => (v == null ? '' : `${v > 0 ? '+' : ''}${Math.abs(v) >= 1000 ? (v / 1000).toFixed(1) + 'k' : v.toFixed(0)}%`)

/** CAGR is only meaningful over positive endpoints — a company that swung from a
 *  loss to a profit has no compound growth rate. Returns null rather than a
 *  confident-looking nonsense number. */
function cagr(newest, oldest, years) {
  if (newest == null || oldest == null || years < 1) return null
  if (newest <= 0 || oldest <= 0) return null
  return (Math.pow(newest / oldest, 1 / years) - 1) * 100
}

const MONTH_Q = { '01': 'Q4', '02': 'Q1', '03': 'Q1', '04': 'Q1', '05': 'Q2', '06': 'Q2', '07': 'Q2', '08': 'Q3', '09': 'Q3', '10': 'Q3', '11': 'Q4', '12': 'Q4' }
function shortPeriod(p, annual) {
  if (!p) return ''
  const [y, m] = p.split('-')
  if (annual) return `FY${y.slice(2)}`
  return `${MONTH_Q[m] || ''} '${y.slice(2)}`
}
/** Full period label for a tooltip — fiscal years rarely end in December, so the
 *  actual period-end date is genuinely useful detail-on-demand (§23). */
function longPeriod(p, annual) {
  if (!p) return ''
  const d = new Date(p + 'T00:00:00')
  const nice = Number.isNaN(d.getTime()) ? p
    : d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  return `${annual ? 'Fiscal year' : 'Fiscal quarter'} ended ${nice}`
}

/** Resolve the period list actually being displayed, newest-first. TTM mode uses
 *  the rolling TTM series so its sparkline and history are real trailing values,
 *  not the raw quarters. */
function useSeries(statements, statement, period) {
  return useMemo(() => {
    const block = statements?.[statement]
    if (!block) return { periods: [], annual: false, mode: period }
    const nq = (block.quarterly || []).length
    if (period === 'ttm') {
      const s = block.ttm_series || []
      // Balance sheets have no rolling series — "TTM" is the latest snapshot.
      if (!s.length) {
        return { periods: block.quarterly?.slice(0, 1) || [], annual: false, mode: 'ttm', snapshot: true, nq }
      }
      return { periods: s, annual: false, mode: 'ttm', nq }
    }
    return { periods: (period === 'annual' ? block.annual : block.quarterly) || [], annual: period === 'annual', mode: period, nq }
  }, [statements, statement, period])
}

function rowValue(p, item, revenueAt) {
  if (!p) return null
  if (item.key === 'fcf_margin') return pctRatio(p.values.free_cash_flow, revenueAt)
  if (item.m && item.derive) return pctRatio(p.values[item.derive[0]], p.values[item.derive[1]])
  return p.values[item.key]
}
function pctRatio(a, b) { return (a == null || b == null || b === 0) ? null : (a / b) * 100 }

function Line({ item, periods, annual, mode, revenues, extraCols, openKey, setOpenKey }) {
  // ONE metric expanded at a time. With free-for-all expansion a curious user
  // ends up with a 400px statement of interleaved history blocks and loses the
  // statement itself; an accordion keeps the document navigable and makes the
  // expanded block the obvious focus.
  const open = openKey === item.key
  const setOpen = () => setOpenKey(open ? null : item.key)
  const series = periods.map((p, i) => rowValue(p, item, revenues[i]))
  const latest = series[0]
  // Annual compares to the prior year; quarterly/TTM to the same quarter a year
  // back (4 periods), which is the only comparison that removes seasonality.
  const yoyIdx = annual ? 1 : 4
  const prior = series[yoyIdx]
  const signedRow = item.dir === 'signed'
  const yoy = item.fmt === 'pct' ? null : pctChange(latest, prior, !signedRow)
  // Percentage-point delta is the honest comparison for a margin.
  const ppDelta = item.fmt === 'pct' && latest != null && prior != null ? latest - prior : null
  const signed = signedRow
  const yoyCls = !signed || yoy == null ? '' : yoy >= 0 ? styles.pos : styles.neg
  const negLatest = typeof latest === 'number' && latest < 0 && item.fmt !== 'pct'

  const oldest = series.length ? series[series.length - 1] : null
  const spanYears = annual ? series.length - 1 : (series.length - 1) / 4
  // Eligible = the concept applies AND enough history exists. Eligible-but-null
  // means the maths is undefined (an endpoint at or below zero), which is shown
  // as NM rather than silently omitted — the absence is itself information.
  const cagrEligible = !!item.cagr && annual && spanYears >= 2
  const growth = cagrEligible ? cagr(latest, oldest, spanYears) : null

  const tip = [item.tip, item.m ? 'Calculated by UCT from reported figures.' : null]
    .filter(Boolean).join(' ')

  return (
    <>
      <div
        data-metric={item.key}
        className={`${styles.finRow}${item.k ? ' ' + styles.finRowH : ''}${item.m ? ' ' + styles.finRowM : ''}${open ? ' ' + styles.finRowOpen : ''}`}
        onClick={setOpen}
        role="button" tabIndex={0}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen() } }}
      >
        <span className={styles.finLabel} title={tip || undefined}>{item.label}</span>
        {item.k && !item.m
          ? <span className={styles.spark}><Spark series={series.slice().reverse()} /></span>
          : <span className={styles.sparkEmpty} />}
        {/* Prior periods — revealed only when the panel is wide enough (§19). */}
        {extraCols.map(i => (
          <span key={i} className={styles.finPrev} title={longPeriod(periods[i]?.period, annual)}>
            {fmtVal(series[i], item.fmt)}
          </span>
        ))}
        <span className={`${styles.finVal}${negLatest ? ' ' + styles.neg : ''}`}>{fmtVal(latest, item.fmt)}</span>
        <span className={`${styles.finYoy} ${yoyCls}`} title={signed ? undefined : 'Change shown without direction colour — for this metric an increase is not automatically good or bad.'}>
          {ppDelta != null ? `${ppDelta > 0 ? '+' : ''}${ppDelta.toFixed(1)}pp` : fmtYoY(yoy)}
        </span>
      </div>
      {open && (
        <div className={styles.finExpand}>
          {/* Compact header: what this block is, plus CAGR on the same line so
              the growth read costs no extra row (§8). */}
          <div className={styles.finCagr}>
            <span className={styles.finCagrK}>History</span>
            {cagrEligible && (
              growth != null ? (
                <>
                  <span className={styles.finCagrK}>{Math.round(spanYears)}Y CAGR</span>
                  <span className={`${styles.finCagrV} ${signed ? (growth >= 0 ? styles.pos : styles.neg) : ''}`}>
                    {growth > 0 ? '+' : ''}{growth.toFixed(1)}%
                  </span>
                </>
              ) : (
                <>
                  <span className={styles.finCagrK}>{Math.round(spanYears)}Y CAGR</span>
                  <span className={styles.finCagrNM} title="Not meaningful — a compound growth rate is undefined when the first or last period is zero or negative.">NM</span>
                </>
              )
            )}
          </div>
          {/* PROTOTYPE: the SHAPE of the metric, directly above the exact values.
              34px of SVG, no axis and no labels — the numbers are right there,
              so the chart only has to answer "what does this look like over
              time". Key metrics only; a chart on all 12 statement rows is a
              dashboard, which is what this tab must not become. */}
          {item.k && periods.length >= 3 && (
            <div className={styles.fmTrend}>
              <MiniBars
                values={series.slice().reverse()}
                labels={periods.map(pp => shortPeriod(pp.period, annual)).reverse()}
                format={(v) => fmtVal(v, item.fmt)}
                endpoints
              />
            </div>
          )}
          <div className={styles.finHist}>
            {periods.map((p, i) => {
              const v = series[i]
              const prev = series[i + (annual ? 1 : 4)]
              const ch = item.fmt === 'pct' ? null : pctChange(v, prev, !signed)
              return (
                <div key={p.period} className={styles.finHistRow} title={longPeriod(p.period, annual)}>
                  <span className={styles.finHistP}>{mode === 'ttm' ? `TTM ${shortPeriod(p.period, false)}` : shortPeriod(p.period, annual)}</span>
                  <span className={styles.finHistV}>{fmtVal(v, item.fmt)}</span>
                  <span className={`${styles.finHistC} ${signed && ch != null ? (ch >= 0 ? styles.pos : styles.neg) : ''}`}>{fmtYoY(ch)}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </>
  )
}

const fmtWhen = (ts) => {
  if (!ts) return null
  const d = new Date(ts * 1000)
  return Number.isNaN(d.getTime()) ? null
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/**
 * Data & sources — provenance as a product feature, not debug text.
 *
 * Filings come from SEC EDGAR (authoritative, free, no key), fetched only when
 * this panel is actually opened, so the vast majority of Financials views cost
 * nothing extra. Companies absent from EDGAR say so instead of showing a
 * fabricated link.
 */
function Provenance({ sym, meta, periods, annual, mode }) {
  const { data: docs } = useMobileSWR(sym ? `/api/filings/${encodeURIComponent(sym)}/primary` : null, jsonFetcher,
    { refreshInterval: 0, dedupingInterval: 6 * 3600000, revalidateOnFocus: false })
  const updated = fmtWhen(meta?.retrieved_at)
  const fye = meta?.fiscal_year_end
  const filings = docs?.filings || []

  return (
    <div className={styles.finMethod}>
      <div className={styles.finProvGrid}>
        <span className={styles.finProvK}>Source</span>
        <span className={styles.finProvV}>{meta?.source || 'Yahoo Finance'} · as-reported figures</span>
        {updated && <><span className={styles.finProvK}>Updated</span><span className={styles.finProvV}>{updated}{meta?.stale ? ' · refreshing' : ''}</span></>}
        {fye && <><span className={styles.finProvK}>Fiscal year ends</span><span className={styles.finProvV}>{fye.replace('-', '/')}</span></>}
        <span className={styles.finProvK}>Periods</span>
        <span className={styles.finProvV}>
          {periods.length} {annual ? 'fiscal years' : mode === 'ttm' ? 'trailing-twelve-month windows' : 'quarters'}
          {meta?.annual_periods != null && ` (${meta.annual_periods} annual, ${meta.quarterly_periods} quarterly available)`}
        </span>
        <span className={styles.finProvK}>Units</span>
        <span className={styles.finProvV}>Reporting currency, absolute. EPS per share; rates in %.</span>
      </div>

      <p className={styles.finMethodP}>
        <b>Reported</b> — every statement line above is as filed by the company.{' '}
        <b>Calculated by UCT</b> — margins, FCF margin, YoY and CAGR are derived
        locally from those reported lines and are never stored as if reported.
      </p>
      <p className={styles.finMethodP}>
        <b>TTM</b> sums the last four reported quarters; point-in-time figures
        (share counts, tax rate) carry from the latest quarter.{' '}
        <b>YoY</b> {annual ? 'compares consecutive fiscal years.' : 'compares against the same period one year earlier.'}{' '}
        Margins compare in percentage points. Lines a company does not report are
        hidden rather than shown empty.
      </p>

      <div className={styles.finDocsHead}>Source documents</div>
      {filings.length > 0 ? (
        <div className={styles.finDocs}>
          {filings.map(f => (
            <a key={`${f.form}-${f.filed || 'idx'}`} className={styles.finDoc}
               href={f.url} target="_blank" rel="noreferrer" title={f.blurb}>
              <span className={styles.finDocForm}>{f.form}</span>
              <span className={styles.finDocLabel}>{f.label}</span>
              <span className={styles.finDocDate}>{f.direct === false ? 'EDGAR →' : (f.filed || '')}</span>
            </a>
          ))}
          {docs?.edgar_url && (
            <a className={styles.finDocAll} href={docs.edgar_url} target="_blank" rel="noreferrer">
              All filings on SEC EDGAR →
            </a>
          )}
        </div>
      ) : (
        <p className={styles.finMethodP}>
          {docs
            ? 'No SEC filings are available for this security — it may be a non-US issuer or a fund, which file through other regulators.'
            : 'Looking up filings…'}
        </p>
      )}
    </div>
  )
}

export default function DockFinancials({ sym }) {
  const [statement, setStatement] = useState('income')
  const [period, setPeriod] = useState('annual')
  const [methodOpen, setMethodOpen] = useState(false)
  const [openKey, setOpenKey] = useState(null)
  const bodyRef = useRef(null)
  const hostRef = useRef(null)
  const [width, setWidth] = useState(0)

  const { data, isLoading } = useMobileSWR(sym ? `/api/fundamentals-statements/${encodeURIComponent(sym)}` : null, jsonFetcher,
    { refreshInterval: 0, dedupingInterval: 3600000, revalidateOnFocus: false })

  // Panel width drives how many historical columns fit. Measured rather than
  // guessed, because the dock is user-resizable.
  useEffect(() => {
    const el = hostRef.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(entries => {
      for (const e of entries) setWidth(Math.round(e.contentRect.width))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Switching STATEMENT is a new document — start at the top and close any open
  // history, since that metric doesn't exist here. Done in the handler rather
  // than an effect (cascading renders). Switching PERIOD is the same document at
  // a different resolution, so position AND expansion persist: Revenue left open
  // in Annual stays open when you flip to Quarterly.
  const selectStatement = (key) => {
    if (key === statement) return
    setStatement(key)
    setOpenKey(null)
    setMethodOpen(false)
    if (bodyRef.current) bodyRef.current.scrollTop = 0
  }

  // A symbol change arrives from OUTSIDE this component (the chart), so it has
  // no handler to hang the reset on — this is the legitimate effect case.
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpenKey(null)
  }, [sym])

  const { periods, annual, mode, snapshot, nq } = useSeries(data, statement, period)
  // FCF margin lives on the CASH FLOW statement but its denominator lives on the
  // INCOME statement, so revenue is matched back by period date. Sourcing it
  // from the cash-flow rows (which carry no revenue line) silently produced a
  // margin that could never render.
  const revenues = useMemo(() => {
    const inc = data?.income
    if (!inc) return periods.map(() => null)
    const src = mode === 'ttm' ? (inc.ttm_series || []) : annual ? (inc.annual || []) : (inc.quarterly || [])
    const byPeriod = new Map(src.map(p => [p.period, p.values?.revenue ?? null]))
    return periods.map(p => byPeriod.get(p.period) ?? null)
  }, [data, periods, annual, mode])

  // Drop rows with no data in ANY period, then drop sections left empty. This is
  // what makes the tab work for a bank as well as a semiconductor maker.
  const rows = useMemo(() => {
    const all = SCHEMA[statement] || []
    if (!periods.length) return []
    const has = (item) => {
      if (item.key === 'fcf_margin') return periods.some((p, i) => rowValue(p, item, revenues[i]) != null)
      if (item.m && item.derive) return periods.some(p => rowValue(p, item, null) != null)
      return periods.some(p => p.values[item.key] != null)
    }
    const kept = all.filter(it => it.sec || has(it))
    // a heading immediately followed by another heading (or the end) is empty
    return kept.filter((it, i) => {
      if (!it.sec) return true
      const next = kept[i + 1]
      return !!next && !next.sec
    })
  }, [statement, periods, revenues])

  // How many prior-period columns fit beside the label, sparkline, value and YoY.
  const extraCols = useMemo(() => {
    if (snapshot) return []
    const n = width >= 620 ? 3 : width >= 520 ? 2 : 0
    // oldest → newest, left to right, stopping at whatever history exists
    const out = []
    for (let i = n; i >= 1; i -= 1) if (i < periods.length) out.push(i)
    return out
  }, [width, periods.length, snapshot])

  if (!sym) return <div className={styles.emptyState}>No symbol.</div>

  const latestLabel = mode === 'ttm' ? 'TTM' : (shortPeriod(periods[0]?.period, annual) || 'Latest')

  return (
    <div className={styles.fin} ref={hostRef}>
      {/* STATEMENT (what) and PERIOD (when) are two different axes, so they get
          two different control languages: underlined nav vs a segmented pill. */}
      <div className={styles.finBar}>
        <div className={styles.finSeg}>
          {STATEMENTS.map(s => (
            <button key={s.key} type="button"
              className={`${styles.finSegBtn}${statement === s.key ? ' ' + styles.finSegOn : ''}`}
              onClick={() => selectStatement(s.key)}>{s.label}</button>
          ))}
        </div>
        <div className={styles.finSpacer} />
        <div className={styles.finPeriods}>
          {PERIODS.map(p => (
            <button key={p.key} type="button" title={p.tip || undefined}
              className={`${styles.finPeriodBtn}${period === p.key ? ' ' + styles.finPeriodOn : ''}`}
              onClick={() => setPeriod(p.key)}>{p.label}</button>
          ))}
        </div>
      </div>

      <div className={styles.finHead}>
        <span className={styles.finHeadMetric}>Metric</span>
        <span className={styles.finHeadTrend}>Trend</span>
        {extraCols.map(i => (
          <span key={i} className={styles.finPrev} title={longPeriod(periods[i]?.period, annual)}>
            {shortPeriod(periods[i]?.period, annual)}
          </span>
        ))}
        <span className={styles.finHeadVal} title={longPeriod(periods[0]?.period, annual)}>{latestLabel}</span>
        <span className={styles.finHeadYoy} title={annual ? 'Change vs the prior fiscal year.' : 'Change vs the same period one year earlier.'}>YoY</span>
      </div>

      <div className={styles.finBody} ref={bodyRef}>
        {isLoading && !data ? (
          <div className={styles.finSkeleton} aria-label="Loading financials">
            {Array.from({ length: 12 }).map((_, i) => <div key={i} className={styles.finSkelRow} />)}
          </div>
        ) : !periods.length ? (
          // §28: a fund has no income statement to be missing. Say which case
          // this is rather than implying the data failed to load.
          <div className={styles.emptyState}>
            {FUND_TYPES.has(data?.security_type)
              ? <>{sym} is {data.security_type === 'etf' ? 'an ETF' : 'a fund'}, so it does not publish company
                  financial statements. Its holdings and performance are the equivalent view —
                  Overview and the chart carry those.</>
              : <>No {STATEMENTS.find(s => s.key === statement)?.label.toLowerCase()} statement is available for {sym}.
                  {statement !== 'income' && <> Try the Income statement, or another period.</>}</>}
          </div>
        ) : (
          <>
            {snapshot && (
              <div className={styles.finNote}>A balance sheet is a point-in-time snapshot — showing the most recent quarter.</div>
            )}
            {mode === 'ttm' && !snapshot && nq < 8 && (
              // Better to say why the column is empty than to leave a blank the
              // user reads as a bug — or, worse, to fill it with a comparison
              // against a window that isn't a year apart.
              <div className={styles.finNote}>
                Trailing twelve months, rolled forward each quarter. A true TTM year-on-year
                needs eight quarters; this source provides {nq}, so YoY is left blank here —
                use Annual or Quarterly for growth.
              </div>
            )}
            {rows.map(item => (
              item.sec
                ? <div key={`sec-${item.sec}`} className={styles.finSection}>{item.sec}</div>
                : <Line key={item.key} item={item} periods={periods} annual={annual} mode={mode}
                    revenues={revenues} extraCols={extraCols}
                    openKey={openKey} setOpenKey={setOpenKey} />
            ))}
            <button type="button" className={styles.finMethodBtn} onClick={() => setMethodOpen(o => !o)}>
              {methodOpen ? 'Hide data & sources' : 'Data & sources'}
            </button>
            {methodOpen && <Provenance sym={sym} meta={data?.meta} periods={periods} annual={annual} mode={mode} />}
          </>
        )}
      </div>
    </div>
  )
}
