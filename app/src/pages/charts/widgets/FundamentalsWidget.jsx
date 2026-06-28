import { useWorkspace } from '../WorkspaceContext'
import useEarningsTable from '../../../hooks/useEarningsTable'
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
        {rows.map(r => (
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
        <div className={styles.qNextDate}>{q.report_date}</div>
        <div className={styles.qRow}><span className={styles.muted}>EPS Est.</span> <span className={styles.pos}>{fmtEps(q.eps_estimate)}</span></div>
        <div className={styles.qRow}><span className={styles.muted}>Sales Est.</span> <span className={styles.pos}>{fmtSales(q.rev_estimate)}</span></div>
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

export default function FundamentalsWidget({ color }) {
  const { groupSyms } = useWorkspace()
  const sym = groupSyms?.[color] || null
  const { data } = useEarningsTable(sym)

  if (!sym) return <div className={styles.hint}>Pick a ticker (link this widget to a chart by color).</div>
  if (!data) return <div className={styles.hint}>Loading {sym}…</div>
  const hasAnnual = data.annual?.length
  const hasQ = data.quarterly?.length
  if (!hasAnnual && !hasQ) return <div className={styles.hint}>No fundamentals for {sym}.</div>

  return (
    <div className={styles.root}>
      {hasAnnual ? (
        <>
          <div className={styles.sectionLabel}>Annual · EPS &amp; Sales</div>
          <AnnualTable rows={data.annual} />
        </>
      ) : null}
      {hasQ ? (
        <>
          <div className={styles.sectionLabel}>Quarterly · Actual vs Est.</div>
          <div className={styles.qStrip}>
            {data.quarterly.map((q, i) => <QuarterBlock key={q.label || i} q={q} />)}
          </div>
        </>
      ) : null}
    </div>
  )
}
