import { useId } from 'react'
import { tableModelOf, measuresOf, compactValue, SMALL_SAMPLE } from './builtModel'
import { useCellGroup, drillFor } from './cellGroup'
import { W, svgId } from './svg'
import styles from './builtViews.module.css'
import { snapshotStyles as s } from '../SnapshotFrame'

/**
 * Built widgets (wave 8, Task 8.14): the calendar Heat map. One cell per day, laid out as a calendar (a column per
 * week, a row per weekday), shaded on a diverging blue-orange pair by the first measure: blue for a gain, orange
 * for a loss, deeper for a larger value. Pure inline SVG (`<rect>`, `<text>`, a `<pattern>`); never a fetch.
 * ⛔ Colour is never the only signal: every cell carries its value as text, or `+` / `−` when the cell is smaller
 * than 32 px, and a negative cell is also HATCHED. An unknown day is a plain cell, never a zero.
 */
const PAD_L = 22
const PAD_T = 18
const GAP = 2
const MAX_CELL = 56
/** Below this a cell shows only its sign (spec 5.11). */
export const TEXT_MIN_CELL = 32
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})/
const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MINUS = '−'

/** UTC day number and weekday (0 = Sunday) for an ISO day label, or null. */
function dayOf(label) {
  const m = DAY_RE.exec(String(label || ''))
  if (!m) return null
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  if (!Number.isFinite(t)) return null
  return { n: Math.round(t / 86400000), wd: new Date(t).getUTCDay() }
}

export default function HeatView({ params, onDrill }) {
  const p = params || {}
  const model = tableModelOf(p)
  const m = measuresOf(p)[0] || {}
  const group = useCellGroup()
  const hatch = `built-hatch-${svgId(useId())}`
  if (!model.rows.length) return <p className={s.empty}>{'No rows to show.'}</p>
  const days = model.rows.map((r) => dayOf(r.label))
  const calendar = days.every(Boolean)
  // A calendar when every label is a day; otherwise the cells in order, one row.
  let place
  let cols
  let weekdays
  if (calendar) {
    const weekend = days.some((d) => d.wd === 0 || d.wd === 6)
    weekdays = weekend ? [1, 2, 3, 4, 5, 6, 0] : [1, 2, 3, 4, 5]
    const monday = (d) => d.n - ((d.wd + 6) % 7)
    const first = Math.min(...days.map(monday))
    cols = Math.max(...days.map((d) => (monday(d) - first) / 7)) + 1
    place = (i) => ({ col: (monday(days[i]) - first) / 7, row: weekdays.indexOf(days[i].wd) })
  } else {
    weekdays = []
    cols = model.rows.length
    place = (i) => ({ col: i, row: 0 })
  }
  const rowsN = Math.max(weekdays.length, 1)
  const cell = Math.max(4, Math.min(MAX_CELL, Math.floor((W - PAD_L) / cols) - GAP))
  const showText = cell >= TEXT_MIN_CELL
  const vals = model.rows.map((r) => r.values[0]?.value).filter((v) => typeof v === 'number')
  const extent = Math.max(...vals.map(Math.abs), 0) || 1
  const height = PAD_T + rowsN * (cell + GAP)
  const width = PAD_L + cols * (cell + GAP)
  const first = model.rows[0].label
  const last = model.rows[model.rows.length - 1].label
  return (
    <div className={styles.chartWrap}>
      <svg className={styles.chart} viewBox={`0 0 ${Math.max(width, 120)} ${height}`} width="100%" role="group"
        aria-label={`${m.label || 'Value'} by day`} data-testid="built-heat-view" {...group.groupProps}>
        <defs>
          <pattern id={hatch} patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" className={styles.hatchLine} />
          </pattern>
        </defs>
        <text x={PAD_L} y={11} className={styles.tick}>{first === last ? first : `${first} to ${last}`}</text>
        {weekdays.map((wd, r) => (
          <text key={wd} x={PAD_L - 4} y={PAD_T + r * (cell + GAP) + cell / 2} className={styles.tick}
            textAnchor="end" dominantBaseline="middle">{WEEKDAY[wd][0]}</text>
        ))}
        {model.rows.map((r, i) => {
          const c = r.values[0] || { text: '', value: null }
          const v = c.value
          const { col, row } = place(i)
          const x = PAD_L + col * (cell + GAP)
          const y = PAD_T + row * (cell + GAP)
          const known = typeof v === 'number'
          const tone = !known ? styles.heatNone : v < 0 ? styles.heatNeg : v > 0 ? styles.heatPos : styles.heatZero
          const strength = known ? 0.25 + 0.75 * (Math.abs(v) / extent) : 1
          let text = ''
          if (known) text = showText ? compactValue(v, m.fmt) : (v > 0 ? '+' : v < 0 ? MINUS : '0')
          else if (showText) text = c.hidden ? 'n/a' : 'no data'
          const label = `${r.label}: ${c.text}${c.small ? `, ${SMALL_SAMPLE}` : ''}`
          return (
            <g key={r.key} className={styles.mark} data-heat-value={known ? (v < 0 ? 'neg' : v > 0 ? 'pos' : 'zero') : 'none'}
              {...group.itemProps(i, drillFor(onDrill, r, r.label), label)}>
              <rect x={x} y={y} width={cell} height={cell} rx={2} className={tone} fillOpacity={strength} />
              {known && v < 0 && <rect x={x} y={y} width={cell} height={cell} rx={2} fill={`url(#${hatch})`} />}
              {text && (
                <text x={x + cell / 2} y={y + cell / 2} className={styles.heatText} textAnchor="middle"
                  dominantBaseline="middle">{text}</text>
              )}
            </g>
          )
        })}
      </svg>
      <p className={styles.caption}>{'Blue: a gain · Orange, hatched: a loss · deeper is larger.'}</p>
    </div>
  )
}
