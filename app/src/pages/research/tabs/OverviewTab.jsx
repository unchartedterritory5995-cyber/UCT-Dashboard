import { lazy, Suspense } from 'react'
import FundamentalSnapshot from '../../../components/FundamentalSnapshot'
import DeskCoverage from '../DeskCoverage'
import LeadershipBadge from '../LeadershipBadge'
import ConfidenceBadge from '../ConfidenceBadge'
import { ABSENT, formatCurrency } from '../../../lib/presentation/presentationPrimitives'
import styles from '../ResearchPage.module.css'

// The SAME chart the /charts workspace renders — identity row, session toggle,
// market clock, settings gear and drawing tools. Lazy, so none of it lands in
// the eager entry chunk.
const ChartPane = lazy(() => import('../../../components/chart/pane/ChartPane'))

// Consensus buckets arrive separate ({strongBuy, buy, hold, sell, strongSell});
// the strong buckets used to be dropped from the counts entirely.
export function consensusText(ct) {
  if (!ct || (ct.buy == null && ct.strongBuy == null)) return '—'
  const n = (v) => Number(v) || 0
  const side = (label, plain, strong) => {
    const total = n(plain) + n(strong)
    return n(strong) ? `${label} ${total} (incl. ${n(strong)} strong)` : `${label} ${total}`
  }
  return [side('Buy', ct.buy, ct.strongBuy), `Hold ${n(ct.hold)}`, side('Sell', ct.sell, ct.strongSell)].join(' · ')
}

// The middle of the target range: the mean when the source carries one, else
// the median (the FMP fallback never has a mean), labelled as such.
export function targetMid(pt) {
  if (pt?.targetMean != null) return { value: money(pt.targetMean), label: null }
  if (pt?.targetMedian != null) return { value: money(pt.targetMedian), label: 'median' }
  return { value: '—', label: null }
}

// tq-panels: a price target is a dollar figure -- it printed as a bare number.
export function money(v) {
  if (v == null || v === '') return '—'
  const n = Number(v)
  return formatCurrency(n, { absent: ABSENT })
}

// tq-panels: when the targets were last revised. Finnhub carries `lastUpdated`;
// the FMP fallback has none, and we say so rather than imply they are current.
export function targetAsOf(pt) {
  const d = typeof pt?.lastUpdated === 'string' ? pt.lastUpdated.trim().slice(0, 10) : ''
  return d ? `as of ${d}` : 'source gives no as-of date'
}

function Surprise({ v }) {
  if (v == null) return <span className={styles.muted}>—</span>
  const s = String(v)
  const up = s.trim().startsWith('+')
  return <span className={up ? styles.up : styles.down}>{s}</span>
}

// The "Latest report" card's status line. `reportState` comes from
// useLatestReport; absent (older callers) it renders exactly as before.
// ⛔ 'error' is NOT 'empty': an outage must never read as "nothing reported".
function ReportNote({ state, reason, retry }) {
  if (state === 'loading') return <div className={styles.fnote} data-testid="latest-report-loading">Loading latest report…</div>
  if (state === 'empty') return <div className={styles.fnote} data-testid="latest-report-empty">No reported quarter on file yet.</div>
  if (state === 'not_applicable') {
    return <div className={styles.fnote} data-testid="latest-report-na">Not applicable to funds{reason ? ` — ${reason}.` : '.'}</div>
  }
  if (state === 'error') {
    return (
      <div className={styles.fnote} data-testid="latest-report-error">
        Couldn't load the latest report.
        {' '}
        <button type="button" className={styles.basisBtn} onClick={() => retry && retry()}>Retry</button>
      </div>
    )
  }
  return null
}

export default function OverviewTab({ sym, stats, analyst, ai, row, reportState, reportReason, retryReport, analystMissing, error, mutate }) {
  const ct = analyst?.consensus || {}
  const pt = analyst?.price_target || {}
  const mid = targetMid(pt)
  return (
    <div className={styles.ovWrap}>
      {/* TERM-088 -- a failed read on any of the composing endpoints is not
          "nothing available yet". Rendered BEFORE the per-card empty-state
          fallbacks below, which stay guarded by their own `??`/`||` em-dash
          defaults -- this banner just tells the member those dashes mean
          "couldn't load", not "nothing here". */}
      {error && (
        <div className={styles.fnote} data-testid="overview-error">
          Couldn't load some of this overview.
          {' '}
          <button type="button" className={styles.basisBtn} onClick={() => mutate && mutate()}>Retry</button>
        </div>
      )}
      <section className={styles.card}>
        <FundamentalSnapshot sym={sym} showResearchLink={false} />
      </section>
      {/* Packet I: has this ticker been a UCT20 leadership pick, and for how
          long? Renders null when it has never been one. */}
      <LeadershipBadge sym={sym} />
      {/* Packet J: UCT's own computed confidence score for this ticker.
          Renders null when it has never been scored. */}
      <ConfidenceBadge sym={sym} />
      {/* What the desk has actually written about this name. Renders null when
          the archive has never covered it. */}
      <DeskCoverage sym={sym} />
      <section className={`${styles.card} ${styles.chartCard}`}>
        <div className={styles.ovChart}>
          {/* tf="D" is hardcoded — this page has no timeframe state and no
              switcher anywhere, so `showTfBar={false}` omits ChartPane's bar
              entirely rather than offering a control the page can't honour.
              `onSymbolChange` is omitted so the identity row is a static
              label; `stored={null}` with no `onStore` = the user's own chart
              settings, everywhere. */}
          {sym && (
            <Suspense fallback={<div className={styles.chartLoading}>Loading chart…</div>}>
              <ChartPane
                sym={sym}
                tf="D"
                stored={null}
                showTfBar={false}
                stockChartProps={{
                  height: '100%',
                  showDrawingTools: false,
                  hideReplay: true,
                  hidePatterns: true,
                  hideCompare: true,
                  hideCountdown: true,
                  showVolume: true,
                  volumeSeparatePane: true,
                }}
              />
            </Suspense>
          )}
        </div>
      </section>
      <div className={styles.cardGrid}>
      <section className={styles.card}>
        <div className={styles.ct}>Latest report{row?.label ? ` · ${row.label}` : ''}</div>
        <table className={styles.tbl} aria-label="Latest report">
          <thead><tr><th scope="col">Metric</th><th scope="col">Est</th><th scope="col">Actual</th><th scope="col">Surp</th></tr></thead>
          <tbody>
            <tr>
              <td>EPS</td>
              <td>{row?.eps_estimate ?? '—'}</td>
              <td>{row?.reported_eps ?? '—'}</td>
              <td><Surprise v={row?.surprise_pct} /></td>
            </tr>
            <tr>
              <td>Revenue</td>
              <td>{row?.rev_estimate ?? '—'}</td>
              <td>{row?.rev_actual ?? '—'}</td>
              <td><Surprise v={row?.rev_surprise_pct} /></td>
            </tr>
          </tbody>
        </table>
        {row?.currency_note && (
          <div className={styles.fnote} data-testid="latest-report-currency" data-currency={row.currency}>{row.currency_note}</div>
        )}
        <ReportNote state={reportState} reason={reportReason} retry={retryReport} />
      </section>

      <section className={styles.card}>
        <div className={styles.ct}>Key stats</div>
        <div className={styles.kv}><span>Mkt cap</span><b>{stats?.market_cap ?? '—'}</b></div>
        <div className={styles.kv}><span>Fwd P/E</span><b>{stats?.forward_pe ?? '—'}</b></div>
        <div className={styles.kv}><span>Beta</span><b>{stats?.beta ?? '—'}</b></div>
        <div className={styles.kv}><span>Div yield</span><b>{stats?.div_yield != null ? `${stats.div_yield}%` : '—'}</b></div>
        <div className={styles.kv}><span>52-wk range</span><b>{stats?.week52_low ?? '—'} — {stats?.week52_high ?? '—'}</b></div>
      </section>

      <section className={styles.card}>
        <div className={styles.ct}>Analyst view</div>
        {analystMissing || reportState === 'not_applicable' ? (
          <div className={styles.fnote} data-testid="analyst-missing">
            {reportState === 'not_applicable'
              ? 'Not applicable to funds — analysts do not rate or target a fund here.'
              : `No earnings record for ${sym} — the source holds no consensus or price target for it.`}
          </div>
        ) : (
          <>
            <div className={styles.kv}><span>Consensus</span><b data-testid="consensus-counts">{consensusText(ct)}</b></div>
            <div className={styles.kv}><span>Target</span><b data-testid="target-range">{money(pt.targetLow)} — <span className={styles.gold}>{mid.value}{mid.label ? <span className={styles.muted}> ({mid.label})</span> : null}</span> — {money(pt.targetHigh)}</b></div>
            {(pt.targetLow != null || pt.targetHigh != null || mid.value !== '—') && (
              <div className={styles.fnote} data-testid="target-asof">Price targets {targetAsOf(pt)}.</div>
            )}
          </>
        )}
      </section>

      <section className={styles.card}>
        <div className={styles.ct}>AI snapshot</div>
        <p className={styles.ai}>
          {ai?.analysis_summary || ai?.preview_text || (error ? '—' : 'Earnings analysis will appear here once available.')}
        </p>
      </section>
      </div>
    </div>
  )
}
