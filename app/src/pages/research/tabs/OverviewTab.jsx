import { lazy, Suspense } from 'react'
import FundamentalSnapshot from '../../../components/FundamentalSnapshot'
import styles from '../ResearchPage.module.css'

// The SAME chart the /charts workspace renders — identity row, session toggle,
// market clock, settings gear and drawing tools. Lazy, so none of it lands in
// the eager entry chunk.
const ChartPane = lazy(() => import('../../../components/chart/pane/ChartPane'))

function Surprise({ v }) {
  if (v == null) return <span className={styles.muted}>—</span>
  const s = String(v)
  const up = s.trim().startsWith('+')
  return <span className={up ? styles.up : styles.down}>{s}</span>
}

export default function OverviewTab({ sym, stats, analyst, ai, row }) {
  const ct = analyst?.consensus || {}
  const pt = analyst?.price_target || {}
  return (
    <div className={styles.ovWrap}>
      <section className={styles.card}>
        <FundamentalSnapshot sym={sym} showResearchLink={false} />
      </section>
      <section className={`${styles.card} ${styles.chartCard}`}>
        <div className={styles.ovChart}>
          {/* tf="D" is hardcoded — this page has no timeframe state and no
              switcher anywhere, so `showTfBar={false}` omits ChartPane's bar
              entirely rather than offering a control the page can't honour.
              `onSymbolChange` is omitted so the identity row is a static
              label; `stored={null}` with no `onStore` = the user's own chart
              settings, everywhere. */}
          {sym && (
            <Suspense fallback={<div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>Loading chart…</div>}>
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
      <div className={styles.grid}>
      <section className={styles.card}>
        <div className={styles.ct}>Latest report</div>
        <table className={styles.tbl}>
          <thead><tr><th>Metric</th><th>Est</th><th>Actual</th><th>Surp</th></tr></thead>
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
        <div className={styles.kv}><span>Consensus</span><b>{ct.buy != null ? `Buy ${ct.buy} · Hold ${ct.hold ?? 0} · Sell ${ct.sell ?? 0}` : '—'}</b></div>
        <div className={styles.kv}><span>Target</span><b>{pt.targetLow ?? '—'} — <span className={styles.gold}>{pt.targetMean ?? '—'}</span> — {pt.targetHigh ?? '—'}</b></div>
      </section>

      <section className={styles.card}>
        <div className={styles.ct}>AI snapshot</div>
        <p className={styles.ai}>
          {ai?.analysis_summary || ai?.preview_text || 'Earnings analysis will appear here once available.'}
        </p>
      </section>
      </div>
    </div>
  )
}
