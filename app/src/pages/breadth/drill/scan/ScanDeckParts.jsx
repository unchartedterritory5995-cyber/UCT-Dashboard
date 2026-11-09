import { useId, useState } from 'react'
import UIcon from '../../../../components/ui/UIcon'
import { GROUP_HUES, UNCLASSIFIED } from './scanDeckModel'
import ws from '../../../charts/ChartsWorkspace.module.css'
import styles from './ScanDeck.module.css'

const MODE_LABEL = { focus: 'Focus', grid: 'Grid', table: 'Table' }

// ── Masthead: the instrument strip (owner pick, header concept 3) ─────────────
// The list and its day on the left, then small readouts that SHOW rather than
// label: the count over its recent sessions (today in gold), and where the
// stocks come from (the sector mix).
export function ScanHeader({
  label, count, live, drillCols, colKey, onPickMetric,
  dateNav, ctx, summary, mode, onMode, modes, onClose, children,
}) {
  const metricId = useId()
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

      <SectorMix sectors={summary?.sectors} total={count} />

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

// ── Sector mix ───────────────────────────────────────────────────────────────
// Where the list's stocks come from: one bar split by sector (largest first, in
// the same colours as the list's Sector sections), the top three named under it.
// Hover a segment for its name and count.
function SectorMix({ sectors, total }) {
  const [hover, setHover] = useState(null)
  const list = (sectors || []).filter(s => s.count > 0)
  if (!list.length) return null
  const n = list.reduce((a, s) => a + s.count, 0) || total || 1
  const colorOf = (s, i) => (s.key === UNCLASSIFIED ? 'color-mix(in srgb, var(--text-muted) 40%, transparent)' : GROUP_HUES[i % GROUP_HUES.length])
  const pct = (c) => Math.round((c / n) * 100)
  const named = list.filter(s => s.key !== UNCLASSIFIED).slice(0, 3)
  const h = hover != null ? list[hover] : null
  return (
    <div className={`${styles.tile} ${styles.tileMix}`}>
      <span className={styles.tileHead}>
        <span className={styles.tileLbl}>Sector mix</span>
        <span className={styles.mixHover}>{h ? <><b>{h.key}</b> {h.count} {h.count === 1 ? 'stock' : 'stocks'} · {pct(h.count)}%</> : null}</span>
      </span>
      <span className={styles.mixBar} role="img" onMouseLeave={() => setHover(null)}
        aria-label={'Sector mix: ' + list.map(s => `${s.key} ${pct(s.count)}%`).join(', ')}>
        {list.map((s, i) => (
          <i key={s.key} onMouseEnter={() => setHover(i)} data-dim={hover != null && hover !== i ? true : undefined}
            style={{ flexGrow: s.count, background: colorOf(s, i) }} />
        ))}
      </span>
      <span className={styles.mixKey}>
        {named.map(s => (
          <span key={s.key}><i style={{ background: colorOf(s, list.indexOf(s)) }} />{s.key} <b>{pct(s.count)}%</b></span>
        ))}
        {list.length > named.length && <span className={styles.muted}>+{list.length - named.length} more</span>}
      </span>
    </div>
  )
}
