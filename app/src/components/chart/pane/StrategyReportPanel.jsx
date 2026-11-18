// app/src/components/chart/pane/StrategyReportPanel.jsx
//
// ─── ⭐⭐ W9-T13b — THE STRATEGY REPORT, AS A MEMBER READS IT ────────────────────
//
// Renders ONE report from `runtime/brokerReport.js::strategyReportOf` (schema
// `uct.strategy-report/v1`) exactly, and computes nothing (W9 design rule 3: the metrics have one
// place, and it is not here). Design 3.3: three tabs plus the `asOfBar` stamp; an unpinned
// metric shows its sentence; a run-wide refusal shows a report that holds only the refusal.
//
// ⛔ RULING D2 — THE START SENTENCE IS ALWAYS VISIBLE. It sits ABOVE the tabs, never inside
// one, so no tab choice can hide it, and it is the record's own `window.sentence` verbatim
// (one authority: `strategyRecord.js::startSentenceOf`), which states it on EVERY record, from the
// listing too (W9-T13b r1: TradingView's plan bar limit can still move its start).
// ⛔ RULING D8 — A METRIC WE CANNOT COMPUTE SHOWS ITS REFUSAL SENTENCE, in the cell where its
// number would be. Never a dash, never a blank, never a guessed number.
// ⛔ NO GUARD ID REACHES THE DOM. A refusal's `guard` (`runtime:strategy-unpinned`, ...) is a
// name for engineers and rails; the member reads the sentence. Not rendered, not in an
// attribute, and stripped from a sentence that quotes one (`engine/ast/sentence.js::withoutGuardIds`).
// ⛔ D10 IS NOT APPLIED. Our counts are reported in full whatever the number of trades.
// ⛔ NO FLAG READ IN THIS FILE: it is a pure view. The gate lives in the one mount,
// `AttachedStrategyReports.jsx`.
import { useId, useRef, useState } from 'react'
import { SERVED_METRICS, REFUSED_METRICS } from '../engine/runtime/brokerReport.js'
import { withoutGuardIds } from '../engine/ast/guardIdText'
import styles from './StrategyReportPanel.module.css'

/** TradingView's Overview tab headline figures, by report key (any refused one shows its sentence). */
export const OVERVIEW_KEYS = Object.freeze(['netProfit', 'totalClosedTrades', 'percentProfitable', 'profitFactor',
  'maxDrawdown', 'avgTrade', 'avgBarsInTrades'])

export const TABS = Object.freeze([
  Object.freeze({ id: 'overview', label: 'Overview' }),
  Object.freeze({ id: 'summary', label: 'Performance summary' }),
  Object.freeze({ id: 'trades', label: 'List of trades' }),
])

/** The member's form of a refusal sentence. r2: guard ids go through the ONE shared rule,
 *  `engine/ast/sentence.js::withoutGuardIds` (whole parentheticals, balanced brackets); this
 *  adds only the panel's fallback for a refusal that carries no sentence at all. */
export function memberSentence(s) {
  if (typeof s !== 'string' || !s.trim()) return 'This was not shown, and the backtest did not record why.'
  return withoutGuardIds(s)
}

/** the metric's printed name: the report's own label (one authority with its sentence) */
export function metricLabel(key) {
  return (SERVED_METRICS[key] && SERVED_METRICS[key].label) || (REFUSED_METRICS[key] && REFUSED_METRICS[key].label) || key
}

const fmt = (v, min, max) => (Number.isFinite(v)
  ? v.toLocaleString('en-US', { minimumFractionDigits: min, maximumFractionDigits: max }) : '')

/** a served value, by the metric's kind (`SERVED_METRICS[key].kind`) */
export function formatMetric(key, value) {
  const kind = SERVED_METRICS[key] ? SERVED_METRICS[key].kind : null
  if (kind === 'count' || kind === 'sign') return fmt(value, 0, 0)
  if (kind === 'percent') return `${fmt(value, 2, 3)}%`
  if (kind === 'ratio') return fmt(value, 3, 3)
  return fmt(value, 2, 2)
}
export const formatPrice = (v) => fmt(v, 2, 6)
/** a bar time as its UTC date and time (the record's dates are UTC, ruling D2 as amended) */
export function formatTime(t) {
  if (!Number.isFinite(t)) return ''
  const iso = new Date(t * 1000).toISOString()
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`
}

const toneOf = (v) => (Number.isFinite(v) ? (v > 0 ? styles.gain : v < 0 ? styles.loss : '') : '')
const isMoney = (key) => SERVED_METRICS[key] && (SERVED_METRICS[key].kind === 'money' || SERVED_METRICS[key].kind === 'percent')

function Sentence({ text, testId }) {
  return <span className={styles.sentence} data-testid={testId}>{memberSentence(text)}</span>
}

function MetricsTable({ metrics, keys, caption, testId }) {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table} data-testid={testId}>
        <caption className={styles.srOnly}>{caption}</caption>
        <thead><tr><th scope="col">Metric</th><th scope="col">Value</th></tr></thead>
        <tbody>
          {keys.map((key) => {
            const m = metrics[key]
            if (!m) return null
            return (
              <tr key={key} data-testid={`strategy-report-metric-${key}`} data-status={m.status === 'served' ? 'served' : 'refused'}>
                <th scope="row">{metricLabel(key)}</th>
                {m.status === 'served'
                  ? <td className={`${styles.num} ${isMoney(key) ? toneOf(m.value) : ''}`}>{formatMetric(key, m.value)}</td>
                  : <td className={styles.refusalCell}><Sentence text={m.sentence} /></td>}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** ⭐ W9-T7-F1 — a fill's signal (its order's comment, else its id), or why it is not shown. */
function SignalCell({ signal }) {
  if (signal && signal.status === 'served') return <td>{signal.value}</td>
  return <td className={styles.refusalCell}><Sentence text={signal && signal.sentence} /></td>
}

function TradeList({ trades }) {
  if (!trades || trades.status !== 'served') {
    return (
      <p className={styles.refusal} role="note" data-testid="strategy-report-trades-refused">
        <Sentence text={trades && trades.sentence} />
      </p>
    )
  }
  if (!trades.rows.length) {
    return <p className={styles.line} data-testid="strategy-report-trades-empty">This backtest placed no trades.</p>
  }
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table} data-testid="strategy-report-trades">
        <caption className={styles.srOnly}>List of trades</caption>
        <thead>
          <tr>
            <th scope="col">Trade</th>
            <th scope="col">Direction</th>
            <th scope="col">Size</th>
            <th scope="col">Entry signal</th>
            <th scope="col">Entry (UTC)</th>
            <th scope="col">Entry price</th>
            <th scope="col">Exit signal</th>
            <th scope="col">Exit (UTC)</th>
            <th scope="col">Exit price</th>
            <th scope="col">Profit</th>
          </tr>
        </thead>
        <tbody>
          {trades.rows.map((r) => (
            <tr key={r.n} data-testid={`strategy-report-trade-${r.n}`}>
              <th scope="row">{r.n}</th>
              <td>{r.dir === 'short' ? 'Short' : 'Long'}</td>
              <td className={styles.num}>{fmt(r.qty, 0, 6)}</td>
              <SignalCell signal={r.entrySignal} />
              <td>{formatTime(r.entryTime)}</td>
              <td className={styles.num}>{formatPrice(r.entryPrice)}</td>
              {r.open ? <td /> : <SignalCell signal={r.exitSignal} />}
              <td>{r.open ? 'Open' : formatTime(r.exitTime)}</td>
              <td className={styles.num}>{r.open ? '' : formatPrice(r.exitPrice)}</td>
              {r.profit && r.profit.status === 'served'
                ? <td className={`${styles.num} ${toneOf(r.profit.value)}`}>{fmt(r.profit.value, 2, 2)}</td>
                : <td className={styles.refusalCell}><Sentence text={r.profit && r.profit.sentence} /></td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** The stamp: the D2 sentence (every v1 record carries one), the start date and the as-of bar. */
function Stamp({ window: w }) {
  if (!w) return null
  return (
    <div className={styles.stamp} data-testid="strategy-report-stamp">
      {w.sentence
        ? <p className={styles.startSentence} data-testid="strategy-report-start-sentence">{w.sentence}</p>
        : null}
      <p className={styles.line} data-testid="strategy-report-asof">
        {w.startDate ? `Starts ${w.startDate} (UTC)` : 'No start bar'}
        {' · '}
        {w.asOfDate ? `As of the bar closed ${w.asOfDate} (UTC)` : 'No closed bar yet'}
      </p>
    </div>
  )
}

/**
 * @param {object} props
 * @param {object} props.report  `strategyReportOf(record)` (schema `uct.strategy-report/v1`)
 * @param {string} [props.name]  the strategy's name, for the heading
 */
export default function StrategyReportPanel({ report, name = 'Strategy' }) {
  const [tab, setTab] = useState('overview')
  const base = useId()
  const tabRefs = useRef([])
  if (!report || typeof report !== 'object') return null
  const heading = `${name}: strategy report`

  if (report.status !== 'ok') {
    const refusals = Array.isArray(report.refusals) && report.refusals.length ? report.refusals : [{}]
    return (
      <section className={styles.panel} aria-label={heading} data-testid="strategy-report" data-status="refused">
        <h4 className={styles.head}>{heading}</h4>
        <Stamp window={report.window} />
        <p className={styles.line}>This backtest has no report:</p>
        <ul className={styles.refusals} data-testid="strategy-report-refusals">
          {refusals.map((r, i) => <li key={i} className={styles.refusal}><Sentence text={r.sentence} /></li>)}
        </ul>
      </section>
    )
  }

  const metrics = report.metrics || {}
  const onKey = (e, i) => {
    let j = null
    if (e.key === 'ArrowRight') j = (i + 1) % TABS.length
    else if (e.key === 'ArrowLeft') j = (i - 1 + TABS.length) % TABS.length
    else if (e.key === 'Home') j = 0
    else if (e.key === 'End') j = TABS.length - 1
    if (j === null) return
    e.preventDefault()
    setTab(TABS[j].id)
    const el = tabRefs.current[j]
    if (el && typeof el.focus === 'function') el.focus()
  }
  const tabId = (id) => `${base}-tab-${id}`
  const panelId = (id) => `${base}-panel-${id}`
  return (
    <section className={styles.panel} aria-label={heading} data-testid="strategy-report" data-status="ok">
      <h4 className={styles.head}>{heading}</h4>
      <Stamp window={report.window} />
      <div role="tablist" aria-label="Strategy report sections" className={styles.tabs}>
        {TABS.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => { tabRefs.current[i] = el }}
            type="button"
            role="tab"
            id={tabId(t.id)}
            aria-selected={tab === t.id}
            // r2: only the selected tab names a panel, because only its panel is in the DOM
            aria-controls={tab === t.id ? panelId(t.id) : undefined}
            tabIndex={tab === t.id ? 0 : -1}
            className={`${styles.tab} ${tab === t.id ? styles.tabActive : ''}`}
            onClick={() => setTab(t.id)}
            onKeyDown={(e) => onKey(e, i)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={panelId(tab)} aria-labelledby={tabId(tab)} tabIndex={0} className={styles.tabPanel}>
        {tab === 'overview' && <MetricsTable metrics={metrics} keys={OVERVIEW_KEYS} caption="Overview" testId="strategy-report-overview" />}
        {tab === 'summary' && <MetricsTable metrics={metrics} keys={Object.keys(metrics)} caption="Performance summary" testId="strategy-report-summary" />}
        {tab === 'trades' && <TradeList trades={report.trades} />}
      </div>
    </section>
  )
}
