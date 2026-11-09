import { useId, useState } from 'react'
import UIcon from '../../../../components/ui/UIcon'
import CompanyLogo from '../../../../components/CompanyLogo'
import { fmtPct } from './scanDeckModel'
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
  const health = Number.isFinite(ctx?.health) ? Math.max(0, Math.min(100, Math.round(ctx.health))) : null
  const theme = summary?.topTheme
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

      <CountHistory count={count} ctx={ctx} />

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

// ── Stocks each day ──────────────────────────────────────────────────────────
// The list's count, one bar per session, oldest on the left and the open day in
// gold on the right. 1M / 3M / 6M / 1Y picks how far back. Hovering a bar puts
// THAT day's count and date in the readout, so the chart explains itself.
const RANGES = [
  { key: '1M', n: 21, words: 'last month' },
  { key: '3M', n: 63, words: 'last 3 months' },
  { key: '6M', n: 126, words: 'last 6 months' },
  { key: '1Y', n: 252, words: 'last year' },
]
const RANGE_LS = 'uct.breadthDrill.sparkRange'
function readRange() {
  try { const v = localStorage.getItem(RANGE_LS); return RANGES.some(r => r.key === v) ? v : '3M' } catch { return '3M' }
}
const fmtDay = (d) => {
  if (!d) return 'today'
  const [y, m, dd] = d.split('-').map(Number)
  return new Date(y, m - 1, dd).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function CountHistory({ count, ctx }) {
  const [range, setRange] = useState(readRange)
  const [hover, setHover] = useState(null)
  const r = RANGES.find(x => x.key === range) || RANGES[1]
  const all = ctx?.series || []
  const dates = ctx?.seriesDates || []
  const start = Math.max(0, all.length - r.n)
  const vals = all.slice(start)
  const days = dates.slice(start)
  const last = vals.length - 1
  const pick = (k) => { setRange(k); setHover(null); try { localStorage.setItem(RANGE_LS, k) } catch { /* private mode */ } }

  const shownVal = hover != null ? vals[hover] : count
  const shownDay = hover != null && hover !== last ? fmtDay(days[hover]) : (days[last] ? fmtDay(days[last]) : 'today')
  const finite = vals.filter(Number.isFinite)
  const max = Math.max(...finite, 1)
  return (
    <div className={`${styles.tile} ${styles.tileCount}`}>
      <span className={styles.tileHead}>
        <span className={styles.tileLbl}>Stocks each day · {r.words}</span>
        <span className={styles.rangeSeg} role="group" aria-label="Chart range">
          {RANGES.map(x => (
            <button key={x.key} type="button" aria-pressed={x.key === range} onClick={() => pick(x.key)}>{x.key}</button>
          ))}
        </span>
      </span>
      <span className={styles.tileVal}>
        <b>{Number.isFinite(shownVal) ? shownVal.toLocaleString() : '—'}</b>
        <small className={styles.countDay} data-past={hover != null && hover !== last ? true : undefined}>{shownDay}</small>
        {finite.length > 1 && (
          <svg className={styles.spark} viewBox={`0 0 ${vals.length * 3} 24`} preserveAspectRatio="none"
            role="img" aria-label={`Stocks on this list each day, ${r.words}`} onMouseLeave={() => setHover(null)}>
            {vals.map((v, i) => {
              const h = Number.isFinite(v) ? Math.max(1.5, (v / max) * 24) : 0
              return (
                <g key={i} onMouseEnter={() => setHover(i)}>
                  <rect x={i * 3} y={0} width={3} height={24} fill="transparent" />
                  <rect x={i * 3 + 0.4} y={24 - h} width={2.2} height={h} rx={0.6}
                    data-now={i === last || undefined} data-hover={i === hover || undefined} />
                </g>
              )
            })}
          </svg>
        )}
      </span>
    </div>
  )
}
