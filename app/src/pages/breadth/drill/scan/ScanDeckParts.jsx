import { useId } from 'react'
import UIcon from '../../../../components/ui/UIcon'
import { fmtPct, describeReading } from './scanDeckModel'
import ws from '../../../charts/ChartsWorkspace.module.css'
import styles from './ScanDeck.module.css'

const MODE_LABEL = { focus: 'Focus', grid: 'Grid', table: 'Table' }

// ── Masthead ─────────────────────────────────────────────────────────────────
// ONE quiet line, in the chart header's own vocabulary: the list and its day
// (the same date box + calendar as the chart), the reading in plain words, the
// day's figures as Market-Cap-style label/value fields, and the view switch as
// the chart's REGULAR HOURS-style segmented toggle. Classes for the fields and
// the toggle are the chart header's own (ChartsWorkspace.module.css), so the
// two can never drift into two looks.
export function ScanHeader({
  label, count, live, drillCols, colKey, onPickMetric,
  dateNav, ctx, summary, mode, onMode, modes, onClose, children,
}) {
  const metricId = useId()
  const reading = describeReading(ctx)
  const typical = Number.isFinite(ctx?.median) ? Math.round(ctx.median) : null
  return (
    <div className={styles.header}>
      <div className={styles.identity}>
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
        {dateNav && <div className={styles.dateWrap}>{dateNav}</div>}
      </div>

      <div className={styles.reading}
        title={Number.isFinite(ctx?.min) ? `Past year: lowest ${ctx.min.toLocaleString()} · typical ${typical?.toLocaleString()} · highest ${ctx.max.toLocaleString()}` : undefined}>
        <b className={styles.readCount}>{Number.isFinite(count) ? count.toLocaleString() : '—'}</b>
        <span className={styles.readUnit}>stocks</span>
        {reading && (
          <>
            <span className={styles.verdict} data-tone={reading.tone}><i />{reading.label}</span>
            <span className={styles.readLine}>
              {reading.sentence.replace(/^./, c => c.toLowerCase())}
              {typical != null && <> · typical day <b>{typical.toLocaleString()}</b></>}
            </span>
          </>
        )}
      </div>

      <div className={`${ws.chartMeta} ${styles.meta}`}>
        <span className={ws.chartMetaItem} title="The breadth Health score for this session, 0 to 100">
          <span className={ws.chartMetaLabel}>Health</span>
          <span className={ws.chartMetaVal} style={{ color: '#c9a84c' }}>{Number.isFinite(ctx?.health) ? Math.round(ctx.health) : '—'}</span>
        </span>
        <span className={ws.chartMetaItem}>
          <span className={ws.chartMetaLabel}>Avg move</span>
          <span className={`${ws.chartMetaVal} ${summary?.avgPct >= 0 ? styles.up : styles.dn}`}>{fmtPct(summary?.avgPct)}</span>
        </span>
        <span className={`${ws.chartMetaItem} ${styles.metaTheme}`}
          title={summary?.topTheme ? `${summary.topTheme.count} of the ${count} stocks are in ${summary.topTheme.key}` : undefined}>
          <span className={ws.chartMetaLabel}>Top theme</span>
          <span className={ws.chartMetaVal} style={{ color: '#6ba3be' }}>{summary?.topTheme?.key || '—'}</span>
        </span>
      </div>

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
