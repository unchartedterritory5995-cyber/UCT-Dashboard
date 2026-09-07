/**
 * DockFundamentals — the Fundamentals panel rebuilt for the thin BOTTOM dock of a
 * chart (design target: the app's own fundamentals strip). NOT the standalone
 * widget: no ticker, no company name, no ⚙, no Notebook door — the chart above
 * already names the stock. Just the four tabs and a thin horizontal strip of
 * quarter (or year) cards; Analyst / Ownership reuse the shared panels.
 *
 * Takes the chart's resolved `sym` directly (no color-group indirection), so it
 * always mirrors exactly what the chart shows.
 */
import useEarningsTable from '../../../hooks/useEarningsTable'
import AnalystPanel from '../../../components/fundamentals/AnalystPanel'
import OwnershipPanel from '../../../components/fundamentals/OwnershipPanel'
import UIcon from '../../../components/ui/UIcon'
import styles from './dockPanels.module.css'

const TABS = [
  { key: 'quarterly', label: 'Quarterly' },
  { key: 'annual', label: 'Annual' },
  { key: 'analyst', label: 'Analyst' },
  { key: 'ownership', label: 'Ownership' },
]

function fmtSales(v) {
  if (v == null) return '—'
  const a = Math.abs(v)
  if (a >= 1e12) return `$${(v / 1e12).toFixed(2)}T`
  if (a >= 1e9) return `$${(v / 1e9).toFixed(1)}B`
  if (a >= 1e6) return `$${(v / 1e6).toFixed(0)}M`
  return `$${v}`
}
const fmtEps = (v) => (v == null ? '—' : Number(v).toFixed(2))
const fmtPct = (v) => (v == null ? '' : `${v > 0 ? '+' : ''}${v}%`)
const pctCls = (v) => (v == null ? '' : v >= 0 ? styles.pos : styles.neg)

function QuarterCard({ q }) {
  const next = !q.reported
  return (
    <div className={`${styles.qCard}${next ? ' ' + styles.qNext : ''}`}>
      <div className={styles.qHead}>
        <span className={styles.qLabel}>{q.label || 'Next'}</span>
        <span className={styles.qDate}>{q.report_date || q.period_end || ''}</span>
      </div>
      {next ? (
        <>
          <div className={styles.qLine}>
            <span className={styles.qMetric}>EPS</span>{fmtEps(q.eps_estimate)} <span className={styles.qEst}>est</span>
            <span className={`${styles.qPct} ${pctCls(q.eps_est_chg_pct)}`}>{fmtPct(q.eps_est_chg_pct)}</span>
          </div>
          <div className={styles.qLine}>
            <span className={styles.qMetric}>Rev</span>{fmtSales(q.rev_estimate)} <span className={styles.qEst}>est</span>
            <span className={`${styles.qPct} ${pctCls(q.rev_est_chg_pct)}`}>{fmtPct(q.rev_est_chg_pct)}</span>
          </div>
        </>
      ) : (
        <>
          <div className={styles.qLine}>
            <span className={styles.qMetric}>EPS</span>{fmtEps(q.eps_actual)}<span className={styles.qSlash}>/</span>{fmtEps(q.eps_estimate)}
            <span className={`${styles.qPct} ${pctCls(q.eps_surprise_pct)}`}>{fmtPct(q.eps_surprise_pct)}</span>
          </div>
          <div className={styles.qLine}>
            <span className={styles.qMetric}>Rev</span>{fmtSales(q.rev_actual)}<span className={styles.qSlash}>/</span>{fmtSales(q.rev_estimate)}
            <span className={`${styles.qPct} ${pctCls(q.rev_surprise_pct)}`}>{fmtPct(q.rev_surprise_pct)}</span>
          </div>
        </>
      )}
    </div>
  )
}

function YearCard({ r }) {
  return (
    <div className={`${styles.qCard}${r.estimate ? ' ' + styles.qNext : ''}`}>
      <div className={styles.qHead}>
        <span className={styles.qLabel}>{r.year}{r.estimate ? ' e' : ''}</span>
      </div>
      <div className={styles.qLine}>
        <span className={styles.qMetric}>EPS</span>{fmtEps(r.eps)}
        <span className={`${styles.qPct} ${pctCls(r.eps_chg_pct)}`}>{fmtPct(r.eps_chg_pct)}</span>
      </div>
      <div className={styles.qLine}>
        <span className={styles.qMetric}>Rev</span>{fmtSales(r.sales)}
        <span className={`${styles.qPct} ${pctCls(r.sales_chg_pct)}`}>{fmtPct(r.sales_chg_pct)}</span>
      </div>
    </div>
  )
}

export default function DockFundamentals({ sym, view, onView, onClose }) {
  const { data } = useEarningsTable(sym || null)
  const hasQ = data?.quarterly?.length
  const hasAnnual = data?.annual?.length
  const isPanel = view === 'analyst' || view === 'ownership'
  // Earnings-table views fall back to whichever has data.
  const eff = isPanel ? view
    : view === 'annual' ? (hasAnnual ? 'annual' : 'quarterly')
    : (hasQ ? 'quarterly' : 'annual')

  return (
    <div className={styles.fund}>
      {/* left vertical tab rail — keeps the four views off a full-width row */}
      <div className={styles.fundRail} role="tablist" aria-label="Fundamentals view">
        {TABS.map(t => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={eff === t.key}
            className={`${styles.fundTab}${eff === t.key ? ' ' + styles.fundTabOn : ''}`}
            onClick={() => onView(t.key)}
          >{t.label}</button>
        ))}
      </div>

      {eff === 'analyst' ? (
        <div className={styles.fundPanelHost}><AnalystPanel sym={sym} /></div>
      ) : eff === 'ownership' ? (
        <div className={styles.fundPanelHost}><OwnershipPanel sym={sym} /></div>
      ) : !sym ? (
        <div className={styles.fundHint}>No symbol.</div>
      ) : !data ? (
        <div className={styles.fundHint}>Loading {sym}…</div>
      ) : eff === 'annual' && hasAnnual ? (
        <div className={styles.cardRow}>
          {data.annual.slice().reverse().map(r => <YearCard key={r.year} r={r} />)}
        </div>
      ) : hasQ ? (
        <div className={styles.cardRow}>
          {data.quarterly.map((q, i) => <QuarterCard key={q.label || i} q={q} />)}
        </div>
      ) : (
        <div className={styles.fundHint}>No fundamentals for {sym}.</div>
      )}

      <button type="button" className={styles.fundClose} onClick={onClose} title="Close panel" aria-label="Close panel">
        <UIcon name="x" size={13} />
      </button>
    </div>
  )
}
