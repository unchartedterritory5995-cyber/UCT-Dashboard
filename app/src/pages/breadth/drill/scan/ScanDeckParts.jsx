import { useEffect, useId, useRef, useState } from 'react'
import { GROUP_HUES, UNCLASSIFIED } from './scanDeckModel'
import RankLine from '../reading/RankLine'
import styles from './ScanDeck.module.css'

const MODE_LABEL = { focus: 'Focus', grid: 'Grid', table: 'Table' }

// ── Masthead: the instrument strip (owner pick, header concept 3) ─────────────
// The list and its day on the left, then small readouts that SHOW rather than
// label: the count over its recent sessions (today in gold), and where the
// stocks come from (the sector mix).
export function ScanHeader({
  label, count, live, drillCols, colKey, onPickMetric,
  dateNav, ctx, onWantDays, summary, mode, onMode, modes, onClose, children,
  reading = null, readingLoading = false, onHistory = null, histOpen = false,
  tile = null, badge = null, note = null, dayTools = null,
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
          {badge && <span className={styles.badge}>{badge}</span>}
        </div>
        {dateNav && <div className={styles.dateWrap}>{dateNav}</div>}
        {dayTools}
      </div>

      <CountHistory count={count} ctx={ctx} onWantDays={onWantDays} {...(tile || {})} />

      {/* count | sectors | the reading | view toggles (owner 2026-11-19: the reading gets its
          own section, using the band's empty width) */}
      {note ? <span className={styles.headNote}>{note}</span> : <SectorMix sectors={summary?.sectors} />}

      <RankLine reading={reading} loading={readingLoading} onHistory={onHistory} histOpen={histOpen} />

      <div className={styles.headEnd}>
        {children}
        {modes?.length > 0 && (
          <div className={styles.viewTabs} role="group" aria-label="View">
            {modes.map(m => (
              <button key={m} type="button" aria-pressed={mode === m} onClick={() => onMode(m)}
                className={styles.viewBtn}>
                {MODE_LABEL[m]}
              </button>
            ))}
          </div>
        )}
        <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close" title="Close">
          {/* A plain line icon in the text colour (UIcon's metallic gold is not Signature). */}
          <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          </svg>
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
const shownValIsOne = (n) => n === 1
const fmtDay = (d) => {
  if (!d) return 'today'
  const [y, m, dd] = d.split('-').map(Number)
  return new Date(y, m - 1, dd).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function CountHistory({
  count, ctx, onWantDays,
  // A reading-only window (a ratio, a percent, another universe) names its own column and units.
  label = null, fmt = null, unitOne = 'stock', unitMany = 'stocks',
}) {
  const [range, setRange] = useState(readRange)
  const [hover, setHover] = useState(null)
  // While the pointer runs along the bars the number changes; its block keeps the width it had
  // when the hover began, so the sparkline never resizes under the pointer.
  const numRef = useRef(null)
  const [lockW, setLockW] = useState(null)
  const enter = (i) => {
    if (hover == null && numRef.current) setLockW(numRef.current.getBoundingClientRect().width)
    setHover(i)
  }
  const leave = () => { setHover(null); setLockW(null) }
  const r = RANGES.find(x => x.key === range) || RANGES[1]
  // A range longer than the history on hand asks the window for more.
  const have = ctx?.series?.length || 0
  useEffect(() => {
    if (have && r.n > have) onWantDays?.(r.n)
  }, [r.n, have, onWantDays])
  const all = ctx?.series || []
  const dates = ctx?.seriesDates || []
  const start = Math.max(0, all.length - r.n)
  const vals = all.slice(start)
  const days = dates.slice(start)
  const last = vals.length - 1
  const pick = (k) => { setRange(k); leave(); try { localStorage.setItem(RANGE_LS, k) } catch { /* private mode */ } }

  const shownVal = hover != null ? vals[hover] : count
  // The open day's date is already in the box to the left; a hovered past bar names its day in
  // the label above (a fixed slot), so "stocks" always sits right after the number.
  const past = hover != null && hover !== last
  const shownUnit = shownValIsOne(shownVal) ? unitOne : unitMany
  const show = (v) => (Number.isFinite(v) ? (fmt ? fmt(v) : v.toLocaleString()) : '—')
  const finite = vals.filter(Number.isFinite)
  const max = Math.max(...finite, 1)
  // Counts start at zero; a signed or ratio column is drawn from its own low.
  const minV = Math.min(...finite, 0)
  const lo = minV < 0 ? minV : 0
  const span = Math.max(max - lo, 1e-9)
  return (
    <div className={`${styles.tile} ${styles.tileCount}`}>
      <span className={styles.tileHead}>
        <span className={styles.tileLbl} data-past={past || undefined}>
          {past ? fmtDay(days[hover]) : `${label || 'Stocks'} each day · ${r.words}`}
        </span>
        <span className={styles.rangeSeg} role="group" aria-label="Chart range">
          {RANGES.map(x => (
            <button key={x.key} type="button" aria-pressed={x.key === range} onClick={() => pick(x.key)}>{x.key}</button>
          ))}
        </span>
      </span>
      <span className={styles.tileVal}>
        {/* The number with its unit right after it ("60 stocks", "1,125 stocks"); the sparkline
            takes all the width that is left. */}
        <span className={styles.countNum} ref={numRef} style={lockW ? { minWidth: lockW } : undefined}>
          <b>{show(shownVal)}</b>
          {shownUnit && <small className={styles.countDay}>{shownUnit}</small>}
        </span>
        {finite.length > 1 && (
          <svg className={styles.spark} viewBox={`0 0 ${vals.length * 3} 28`} preserveAspectRatio="none"
            role="img" aria-label={`${label || 'Stocks on this list'} each day, ${r.words}`} onMouseLeave={leave}>
            {vals.map((v, i) => {
              const h = Number.isFinite(v) ? Math.max(1.5, (Math.max(0, v - lo) / span) * 28) : 0
              return (
                <g key={i} onMouseEnter={() => enter(i)}>
                  <rect x={i * 3} y={0} width={3} height={28} fill="transparent" />
                  {/* The open day's bar is the one gold mark on the sparkline (owner 2026-11-19). */}
                  <rect x={i * 3 + 0.4} y={28 - h} width={2.2} height={h} rx={0.6}
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
// Where the list's stocks come from, as a tiny leaderboard (owner pick, concept
// C): the six largest sectors in three columns, each with a bar scaled to the
// largest and its count. Colours match the list's Sector sections.
function SectorMix({ sectors }) {
  const list = (sectors || []).filter(s => s.count > 0)
  if (!list.length) return null
  const n = list.reduce((a, s) => a + s.count, 0) || 1
  const top = list.slice(0, 6)
  const max = top[0].count || 1
  const colorOf = (s, i) => (s.key === UNCLASSIFIED ? 'var(--text-muted)' : GROUP_HUES[i % GROUP_HUES.length])
  const rest = list.length - top.length
  return (
    <div className={`${styles.tile} ${styles.tileMix}`} role="group"
      aria-label={'Sector mix: ' + list.map(s => `${s.key} ${s.count}`).join(', ')}>
      <span className={styles.mixGrid}>
        {top.map((s, i) => (
          <span key={s.key} className={styles.mixRow}
            title={`${s.key}: ${s.count} of ${n} stocks (${Math.round((s.count / n) * 100)}%)${i === top.length - 1 && rest > 0 ? ` · ${rest} more ${rest === 1 ? 'sector' : 'sectors'} not shown` : ''}`}>
            <span className={styles.mixName}><i style={{ background: colorOf(s, i) }} />{s.key}</span>
            <span className={styles.mixTrack}><b style={{ width: `${(s.count / max) * 100}%`, background: colorOf(s, i) }} /></span>
            <span className={styles.mixCount}>{s.count}</span>
          </span>
        ))}
      </span>
    </div>
  )
}
