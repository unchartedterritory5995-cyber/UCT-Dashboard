import { useCallback } from 'react'
import { useWorkspace } from '../WorkspaceContext'
import SymbolSearch from '../../../components/chart/SymbolSearch'
import useEarningsTable from '../../../hooks/useEarningsTable'
import AnalystPanel from '../../../components/fundamentals/AnalystPanel'
import OwnershipPanel from '../../../components/fundamentals/OwnershipPanel'
import styles from './FundamentalsWidget.module.css'

function fmtSales(v) {
  if (v == null) return '—'
  if (Math.abs(v) >= 1e12) return `$${(v / 1e12).toFixed(2)}T`
  if (Math.abs(v) >= 1e9) return `$${(v / 1e9).toFixed(1)}B`
  if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(0)}M`
  return `$${v}`
}
function fmtEps(v) { return v == null ? '—' : v.toFixed(2) }
function fmtPct(v) { return v == null ? '' : `${v > 0 ? '+' : ''}${v}%` }
function pctClass(v) { return v == null ? '' : v >= 0 ? styles.pos : styles.neg }

function RevisionMark({ dir }) {
  if (dir === 'up') return <span className={`${styles.rev} ${styles.revUp}`} aria-label="estimate raised">▲</span>
  if (dir === 'down') return <span className={`${styles.rev} ${styles.revDown}`} aria-label="estimate cut">▼</span>
  return null
}

function AnnualTable({ rows }) {
  if (!rows?.length) return null
  // Backend sends oldest→newest with forward estimates last; show newest first
  // so the forward-estimate years lead and the oldest year sits at the bottom.
  const ordered = rows.slice().reverse()
  return (
    <table className={styles.annual}>
      <thead>
        <tr>
          <th className={styles.left}>Year</th>
          <th>EPS</th><th>% Chg</th>
          <th>Sales</th><th>% Chg</th>
        </tr>
      </thead>
      <tbody>
        {ordered.map(r => (
          <tr key={r.year} className={r.estimate ? styles.estRow : ''}>
            <td className={styles.left}>{r.year}{r.estimate ? ' e' : ''}</td>
            <td>{fmtEps(r.eps)}</td>
            <td className={pctClass(r.eps_chg_pct)}>{fmtPct(r.eps_chg_pct)}<RevisionMark dir={r.eps_revision} /></td>
            <td>{fmtSales(r.sales)}</td>
            <td className={pctClass(r.sales_chg_pct)}>{fmtPct(r.sales_chg_pct)}<RevisionMark dir={r.sales_revision} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function QuarterBlock({ q }) {
  if (!q.reported) {
    return (
      <div className={`${styles.qBlock} ${styles.qNext}`}>
        <div className={styles.qLabel}>{q.label || 'Next'}</div>
        {/* Prefer the scheduled report date; fall back to the fiscal period end
            so a forward card always shows a truthful date (the estimate source
            only stamps a report date on the nearest quarter). */}
        <div className={styles.qNextDate} title={q.report_date ? 'Expected report date' : q.period_end ? 'Fiscal period end' : undefined}>{q.report_date || q.period_end}</div>
        <div className={styles.qRow}><span className={styles.muted}>EPS Est.</span> <span>{fmtEps(q.eps_estimate)}</span> <span className={pctClass(q.eps_est_chg_pct)}>{fmtPct(q.eps_est_chg_pct)}</span></div>
        <div className={styles.qRow}><span className={styles.muted}>Sales Est.</span> <span>{fmtSales(q.rev_estimate)}</span> <span className={pctClass(q.rev_est_chg_pct)}>{fmtPct(q.rev_est_chg_pct)}</span></div>
      </div>
    )
  }
  return (
    <div className={styles.qBlock}>
      <div className={styles.qLabel}>{q.label}</div>
      <div className={styles.qRow}>
        <span>{fmtEps(q.eps_actual)}</span> <span className={styles.muted}>vs</span> <span>{fmtEps(q.eps_estimate)}</span>
        <span className={pctClass(q.eps_surprise_pct)}>{fmtPct(q.eps_surprise_pct)}</span>
      </div>
      <div className={styles.qRow}>
        <span>{fmtSales(q.rev_actual)}</span> <span className={styles.muted}>vs</span> <span>{fmtSales(q.rev_estimate)}</span>
        <span className={pctClass(q.rev_surprise_pct)}>{fmtPct(q.rev_surprise_pct)}</span>
      </div>
    </div>
  )
}

export default function FundamentalsWidget({ color, opts, onOptsChange }) {
  const { groupSyms, setGroupSym } = useWorkspace()
  const sym = groupSyms?.[color] || null
  const { data } = useEarningsTable(sym)
  // View choice persists per-widget through the workspace layout save path
  // (same opts mechanism ChartWidget uses for its timeframe). Default = quarterly.
  const view = ['annual', 'quarterly', 'analyst', 'ownership'].includes(opts?.view) ? opts.view : 'quarterly'
  const setView = useCallback((next) => {
    if (next === (opts?.view || 'quarterly')) return
    onOptsChange?.({ ...(opts || {}), view: next })
  }, [opts, onOptsChange])

  if (!sym) return (
    <div className={styles.pick}>
      <div className={styles.hint}>Pick a ticker — or match a chart's color to follow it.</div>
      <SymbolSearch sym={sym} onSymbolChange={(s) => s && setGroupSym(color, s.toUpperCase())} />
    </div>
  )

  const hasAnnual = data?.annual?.length
  const hasQ = data?.quarterly?.length

  // Resolve the effective view. Analyst/Ownership have their own data sources and
  // are always available; the earnings-table views fall back to whichever section
  // actually has data.
  const isPanelView = view === 'analyst' || view === 'ownership'
  const effectiveView = isPanelView ? view
    : view === 'annual' ? (hasAnnual ? 'annual' : 'quarterly')
    : (hasQ ? 'quarterly' : 'annual')

  // Earnings-table views need the earnings fetch; the panel views do not.
  if (!isPanelView) {
    if (!data) return <div className={styles.hint}>Loading {sym}…</div>
    if (!hasAnnual && !hasQ) return <div className={styles.hint}>No fundamentals for {sym}.</div>
  }

  return (
    <div className={styles.root}>
      <div className={styles.toggle} role="tablist" aria-label="Fundamentals view">
        <button
          type="button"
          role="tab"
          aria-selected={effectiveView === 'quarterly'}
          className={`${styles.toggleBtn} ${effectiveView === 'quarterly' ? styles.toggleBtnActive : ''}`}
          onClick={() => setView('quarterly')}
          disabled={!hasQ}
        >
          Quarterly
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={effectiveView === 'annual'}
          className={`${styles.toggleBtn} ${effectiveView === 'annual' ? styles.toggleBtnActive : ''}`}
          onClick={() => setView('annual')}
          disabled={!hasAnnual}
        >
          Annual
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={effectiveView === 'analyst'}
          className={`${styles.toggleBtn} ${effectiveView === 'analyst' ? styles.toggleBtnActive : ''}`}
          onClick={() => setView('analyst')}
        >
          Analyst
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={effectiveView === 'ownership'}
          className={`${styles.toggleBtn} ${effectiveView === 'ownership' ? styles.toggleBtnActive : ''}`}
          onClick={() => setView('ownership')}
        >
          Ownership
        </button>
      </div>

      {effectiveView === 'analyst' ? (
        <AnalystPanel sym={sym} />
      ) : effectiveView === 'ownership' ? (
        <OwnershipPanel sym={sym} />
      ) : effectiveView === 'annual' ? (
        <>
          <div className={styles.sectionLabel}>Annual · EPS &amp; Sales</div>
          <AnnualTable rows={data.annual} />
        </>
      ) : (
        <>
          <div className={styles.sectionLabel}>Quarterly · Actual vs Est.</div>
          <div className={styles.qStrip}>
            {data.quarterly.map((q, i) => <QuarterBlock key={q.label || i} q={q} />)}
          </div>
        </>
      )}
    </div>
  )
}
