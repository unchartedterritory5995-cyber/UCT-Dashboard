import { useId } from 'react'
import UIcon from '../../../../components/ui/UIcon'
import CompanyLogo from '../../../../components/CompanyLogo'
import { fmtPct, describeReading } from './scanDeckModel'
import ws from '../../../charts/ChartsWorkspace.module.css'
import styles from './ScanDeck.module.css'

const MODE_LABEL = { focus: 'Focus', grid: 'Grid', table: 'Table' }

// ── Masthead: the instrument strip (owner pick, header concept 3) ─────────────
// The list and its day on the left, then small readouts that SHOW rather than
// label: the count over its last 60 sessions (today in gold), the average move,
// Health as a red-to-green gauge, and the leading theme with its stocks' logos.
export function ScanHeader({
  label, count, live, drillCols, colKey, onPickMetric,
  dateNav, ctx, summary, mode, onMode, modes, onClose, children,
}) {
  const metricId = useId()
  const reading = describeReading(ctx)
  const typical = Number.isFinite(ctx?.median) ? Math.round(ctx.median) : null
  const health = Number.isFinite(ctx?.health) ? Math.max(0, Math.min(100, Math.round(ctx.health))) : null
  const theme = summary?.topTheme
  const countTitle = [
    reading?.sentence,
    typical != null ? `Typical day: ${typical.toLocaleString()} stocks` : null,
    Number.isFinite(ctx?.min) ? `Past year: lowest ${ctx.min.toLocaleString()}, highest ${ctx.max.toLocaleString()}` : null,
  ].filter(Boolean).join('\n') || undefined
  return (
    <div className={styles.header}>
      <div className={styles.identity}>
        <div className={styles.idTop}>
          {drillCols?.length > 1 && onPickMetric ? (
            <>
              <label htmlFor={metricId} className="sr-only">Breadth list</label>
              <select id={metricId} className={styles.metric} value={colKey || ''} onChange={e => onPickMetric(e.target.value)}>
                {drillCols.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </>
          ) : (
            <span className={styles.metric}>{label}</span>
          )}
          {live && <span className={styles.live}><i />Live</span>}
        </div>
        {dateNav && <div className={styles.dateWrap}>{dateNav}</div>}
      </div>

      <div className={styles.tile} title={countTitle}>
        <span className={styles.tileLbl}>Stocks{ctx?.series?.length > 1 ? ` · last ${ctx.series.length} days` : ''}</span>
        <span className={styles.tileVal}>
          <b>{Number.isFinite(count) ? count.toLocaleString() : '—'}</b>
          {reading && <small className={styles.verdict} data-tone={reading.tone}>{reading.label.toLowerCase()}</small>}
          <Spark series={ctx?.series} />
        </span>
      </div>

      <div className={`${styles.tile} ${styles.tileOpt}`}>
        <span className={styles.tileLbl}>Average move</span>
        <span className={styles.tileVal}>
          <b className={summary?.avgPct >= 0 ? styles.up : summary?.avgPct < 0 ? styles.dn : undefined}>{fmtPct(summary?.avgPct)}</b>
        </span>
      </div>

      <div className={`${styles.tile} ${styles.tileOpt}`} title="The breadth Health score for this session, 0 to 100">
        <span className={styles.tileLbl}>Health</span>
        <span className={styles.tileVal}>
          <b>{health ?? '—'}</b><small className={styles.muted}>/100</small>
        </span>
        <span className={styles.gauge} aria-hidden="true">{health != null && <i style={{ left: `${health}%` }} />}</span>
      </div>

      {theme && (
        <div className={`${styles.tile} ${styles.tileTheme}`}
          title={`${theme.count} of the ${count} stocks are in ${theme.key}`}>
          <span className={styles.tileLbl}>Leading theme</span>
          <span className={styles.tileVal}>
            <b className={styles.themeName}>{theme.key}</b>
            <small className={styles.muted}>{theme.count} {theme.count === 1 ? 'stock' : 'stocks'}</small>
            <span className={styles.logos}>
              {(theme.syms || []).slice(0, 4).map(sym => (
                <span key={sym} className={styles.logo}><CompanyLogo sym={sym} size={18} round /></span>
              ))}
            </span>
          </span>
        </div>
      )}

      <div className={styles.headEnd}>
        {children}
        <div className={ws.sessionToggle} role="group" aria-label="View">
          {modes.map(m => (
            <button key={m} type="button" aria-pressed={mode === m} onClick={() => onMode(m)}
              className={`${ws.sessionBtn} ${styles.viewBtn}${mode === m ? ' ' + ws.sessionBtnActive : ''}`}>
              {MODE_LABEL[m]}
            </button>
          ))}
        </div>
        <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close" title="Close">
          <UIcon name="x" size={15} />
        </button>
      </div>
    </div>
  )
}

// The count over the recent sessions, oldest → today; today's bar in gold.
function Spark({ series }) {
  const vals = (series || []).map(v => (Number.isFinite(v) ? v : null))
  if (vals.filter(v => v != null).length < 2) return null
  const max = Math.max(...vals.filter(v => v != null), 1)
  return (
    <span className={styles.spark} aria-hidden="true">
      {vals.map((v, i) => (
        <i key={i} data-now={i === vals.length - 1 || undefined}
          style={{ height: v == null ? 0 : `${Math.max(6, (v / max) * 100)}%` }} />
      ))}
    </span>
  )
}
