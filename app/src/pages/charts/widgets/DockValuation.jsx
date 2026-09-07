/**
 * DockValuation — the Valuation tab of the Company Intelligence panel. Reuses the
 * rich /api/fundamentals-full snapshot (yfinance) to present current multiples as
 * a compact, scannable table rather than big cards. Size + yield grouped alongside.
 *
 * ⚠️ THE "5Y AVG" AND "VS AVG" COLUMNS WERE REMOVED (2026-09-07), not restyled.
 * They were produced by `demoValAvg()`, which multiplies the CURRENT value by a
 * fixed per-metric constant. That is not a fallback — it ran unconditionally, in
 * production, for every ticker, which made "vs Avg" a constant per metric
 * wearing the clothes of analysis. It carried a "demo history" badge, but a
 * badge under a column headed 5Y Avg in a research product is not enough: a
 * reader scanning a table takes the number, not the footnote.
 *
 * Real valuation bands are buildable from data we already own (price history ×
 * historical EPS/sales) and are worth doing. Until they exist the honest state
 * is to show the current multiple alone, because a missing column costs the user
 * nothing and a fabricated one costs them trust.
 */
import useMobileSWR from '../../../hooks/useMobileSWR'
import styles from './dockPanels.module.css'

const jsonFetcher = (url) => fetch(url).then(r => (r.ok ? r.json() : null))
const num = (v) => (v == null || Number.isNaN(Number(v)) ? null : Number(v))
const fx = (v, suffix = 'x') => (v == null ? '—' : `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)}${suffix}`)

function VRow({ label, k, cur, suffix = 'x' }) {
  const c = num(cur)
  return (
    <div className={styles.vRow} data-metric={k}>
      <span className={styles.vLabel}>{label}</span>
      <span className={styles.vCur}>{fx(c, suffix)}</span>
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
      </div>

      <div className={styles.dwSectionLabel}>Earnings &amp; Growth</div>
      <VRow label="P/E (ttm)" k="pe_trailing" cur={d.pe_trailing} />
      <VRow label="P/E (fwd)" k="pe_forward" cur={d.pe_forward ?? c?.forward_pe} />
      <VRow label="PEG" k="peg" cur={d.peg} suffix="" />

      <div className={styles.dwSectionLabel}>Sales &amp; Book</div>
      <VRow label="P/S" k="ps" cur={d.ps} />
      <VRow label="P/B" k="pb" cur={d.pb} />
      <VRow label="EV / Revenue" k="ev_to_revenue" cur={d.ev_to_revenue} />
      <VRow label="EV / EBITDA" k="ev_to_ebitda" cur={d.ev_to_ebitda} />

      <div className={styles.dwSectionLabel}>Yield &amp; Risk</div>
      <div className={styles.vRow} data-metric="div_yield">
        <span className={styles.vLabel}>Dividend Yield</span>
        <span className={styles.vCur}>{c?.div_yield != null ? `${Number(c.div_yield).toFixed(2)}%` : '—'}</span>
      </div>
      <div className={styles.vRow}>
        <span className={styles.vLabel}>Beta</span>
        <span className={styles.vCur}>{c?.beta != null ? Number(c.beta).toFixed(2) : '—'}</span>
      </div>

      <div className={styles.finFoot}>
        Current multiples as reported (yfinance). Historical valuation bands are not
        shown — we do not yet compute them, and an illustrative average is not an average.
      </div>
    </div>
  )
}
