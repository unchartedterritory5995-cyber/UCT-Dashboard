/**
 * DockValuation — the Valuation tab of the Company Intelligence panel. Reuses the
 * rich /api/fundamentals-full snapshot (yfinance) to present current multiples as
 * a compact, scannable table (metric · current · 5Y avg · premium/discount) rather
 * than big cards. Size + yield grouped alongside.
 *
 * The "5Y Avg / vs Avg" columns are DEMO history for now (clearly badged — see
 * demoData.js): real valuation bands (price × historical EPS/sales) are a planned
 * enhancement. Current values are real. Fed the chart's resolved `sym`.
 */
import useMobileSWR from '../../../hooks/useMobileSWR'
import { demoValAvg } from './demoData'
import styles from './dockPanels.module.css'

const jsonFetcher = (url) => fetch(url).then(r => (r.ok ? r.json() : null))
const num = (v) => (v == null || Number.isNaN(Number(v)) ? null : Number(v))
const fx = (v, suffix = 'x') => (v == null ? '—' : `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)}${suffix}`)

// metric row: current (real) + demo 5Y avg + premium/discount
function VRow({ label, k, cur, suffix = 'x' }) {
  const c = num(cur)
  const avg = demoValAvg(k, c)
  const delta = (c != null && avg) ? ((c - avg) / avg) * 100 : null
  const dCls = delta == null ? styles.muted : delta > 0 ? styles.neg : styles.pos   // premium=red, discount=green
  return (
    <div className={styles.vRow} data-metric={k}>
      <span className={styles.vLabel}>{label}</span>
      <span className={styles.vCur}>{fx(c, suffix)}</span>
      <span className={styles.vAvg}>{avg == null ? '—' : fx(avg, suffix)}</span>
      <span className={`${styles.vDelta} ${dCls}`}>{delta == null ? '' : `${delta > 0 ? '+' : ''}${delta.toFixed(0)}%`}</span>
    </div>
  )
}

export default function DockValuation({ sym }) {
  const { data: f } = useMobileSWR(sym ? `/api/fundamentals-full/${encodeURIComponent(sym)}` : null, jsonFetcher,
    { refreshInterval: 0, dedupingInterval: 300000, revalidateOnFocus: false })
  const { data: c } = useMobileSWR(sym ? `/api/fundamentals/${encodeURIComponent(sym)}` : null, jsonFetcher,
    { refreshInterval: 600000, dedupingInterval: 60000, revalidateOnFocus: false })
  if (!sym) return <div className={styles.emptyState}>No symbol.</div>
  const d = f || {}

  return (
    <div className={styles.val}>
      <div className={styles.valSizeRow}>
        <div><div className={styles.valSizeLabel}>Market Cap</div><div className={styles.valSizeVal}>{d.market_cap || '—'}</div></div>
        <div><div className={styles.valSizeLabel}>Enterprise Value</div><div className={styles.valSizeVal}>{d.enterprise_value || '—'}</div></div>
      </div>

      <div className={styles.vHead}>
        <span className={styles.vLabel}>Multiple</span>
        <span className={styles.vCur}>Current</span>
        <span className={styles.vAvg}>5Y Avg</span>
        <span className={styles.vDelta}>vs Avg</span>
      </div>

      <div className={styles.dwSectionLabel}>Earnings & Growth</div>
      <VRow label="P/E (ttm)" k="pe_trailing" cur={d.pe_trailing} />
      <VRow label="P/E (fwd)" k="pe_forward" cur={d.pe_forward ?? c?.forward_pe} />
      <VRow label="PEG" k="peg" cur={d.peg} suffix="" />

      <div className={styles.dwSectionLabel}>Sales & Book</div>
      <VRow label="P/S" k="ps" cur={d.ps} />
      <VRow label="P/B" k="pb" cur={d.pb} />
      <VRow label="EV / Revenue" k="ev_to_revenue" cur={d.ev_to_revenue} />
      <VRow label="EV / EBITDA" k="ev_to_ebitda" cur={d.ev_to_ebitda} />

      <div className={styles.dwSectionLabel}>Yield & Risk</div>
      <div className={styles.vRow} data-metric="div_yield">
        <span className={styles.vLabel}>Dividend Yield</span>
        <span className={styles.vCur}>{c?.div_yield != null ? `${Number(c.div_yield).toFixed(2)}%` : '—'}</span>
        <span className={styles.vAvg}>—</span><span className={styles.vDelta}></span>
      </div>
      <div className={styles.vRow}>
        <span className={styles.vLabel}>Beta</span>
        <span className={styles.vCur}>{c?.beta != null ? Number(c.beta).toFixed(2) : '—'}</span>
        <span className={styles.vAvg}>—</span><span className={styles.vDelta}></span>
      </div>

      <div className={styles.demoBadge} style={{ margin: '10px 0 0' }}>Demo history — 5Y Avg / vs Avg are illustrative; real bands coming.</div>
      <div className={styles.finFoot}>Current multiples are real (yfinance). Premium to the historical average shows red, discount green.</div>
    </div>
  )
}
