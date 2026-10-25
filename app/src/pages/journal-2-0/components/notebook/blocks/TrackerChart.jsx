// The tracker block's small chart (Notebook widgets phase 2, wave 9, Task 9.14): the last 30 entries as inline SVG
// (`<polyline>` and `<circle>`, no chart engine), oldest on the left, with its text alternative and a "Show as table"
// toggle that renders the SAME points as an HTML table (spec 5.11).
//
// ⛔ A missing value is a GAP: the line breaks there and no dot is drawn, and the table says "No data". It is never
//    drawn at 0 and never read as 0. A missed DAY is a gap too (I-4): two entries that are not neighbours under the
//    tracker's day rule (the next session for a trading-day tracker, the next calendar day otherwise) are not joined,
//    and the text alternative says how many days have no value.
// ⛔ The width is the shared built-view measure (widgets/builtViews/svg.useChartWidth), whose hysteresis stops a
//    ResizeObserver loop (rule H14). This file adds no observer of its own.
// ⛔ The line and the dots are --accent, a graphic on the block's --bg-elevated at 3:1 or better in every theme
//    (TrackerBlock.test.jsx measures it); the labels are --text-muted, text at 4.5:1 or better.
import { useId, useState } from 'react'
import { useChartWidth, scale, spread } from '../widgets/builtViews/svg'
import { dayWords, sessionAfter } from '../../../lib/blocks/toolDays'
import { valueText } from '../../../lib/blocks/trackerValues'
import own from './TrackerBlock.module.css'

export const H = 96
const PAD_X = 10
const PAD_T = 10
const PAD_B = 10
export const DOT_R = 3
export const TABLE_TOGGLE = 'Show as table'
export const TABLE_HIDE = 'Hide table'
/** Days to walk between two entries at most when counting the days with no value (the 30 entries span a year at most). */
const WALK_MAX = 400

const finite = (v) => typeof v === 'number' && Number.isFinite(v)

function nextCalendarDay(day) {
  const t = new Date(`${day}T00:00:00Z`)
  t.setUTCDate(t.getUTCDate() + 1)
  return t.toISOString().slice(0, 10)
}
/** The day after `day` under the tracker's day rule: the next session for a trading-day tracker, else the next day. */
export const nextDayOf = (day, trading) => (trading ? sessionAfter(day) : nextCalendarDay(day))

/** The days strictly between two entries that the tracker's rule expects (0 when they are neighbours). */
export function missedBetween(prev, cur, trading) {
  let n = 0
  let d = nextDayOf(prev, trading)
  for (let i = 0; i < WALK_MAX && d < cur; i += 1) { n += 1; d = nextDayOf(d, trading) }
  return n
}

/** The runs of neighbouring points that have a value: each is one polyline, so a missing value AND a missed day
 *  between two entries break the line. */
export function runsOf(points, xs, y, trading = false) {
  const out = []
  let run = []
  points.forEach((p, i) => {
    const prev = points[i - 1]
    if (run.length && prev && nextDayOf(prev.day, trading) !== p.day) { out.push(run); run = [] }
    if (finite(p.value)) run.push(`${xs[i].toFixed(1)},${y(p.value).toFixed(1)}`)
    else if (run.length) { out.push(run); run = [] }
  })
  if (run.length) out.push(run)
  return out
}

/** How many days in the chart's span have no value: entries without a readable value, and missed days between. */
export function daysWithNoValue(points, trading = false) {
  let n = points.filter((p) => !finite(p.value)).length
  for (let i = 1; i < points.length; i += 1) n += missedBetween(points[i - 1].day, points[i].day, trading)
  return n
}

/** The chart's text alternative: what it shows, in one sentence, and the days with no value. */
export function chartSpeech(name, kind, unit, points, trading = false) {
  const vals = points.map((p) => p.value).filter(finite)
  const n = points.length
  const what = `${name || 'Tracker'}, the last ${n === 1 ? 'entry' : `${n} entries`}`
  if (!vals.length) return `${what}, with no values`
  const lo = Math.min(...vals)
  const hi = Math.max(...vals)
  const first = points[0]
  const last = points[points.length - 1]
  const range = lo === hi ? `all ${valueText(kind, lo, unit)}` : `from ${valueText(kind, lo, unit)} to ${valueText(kind, hi, unit)}`
  const gaps = daysWithNoValue(points, trading)
  const gapText = gaps ? ` ${gaps === 1 ? '1 day' : `${gaps} days`} with no value.` : ''
  return `${what} (${dayWords(first.day)} to ${dayWords(last.day)}), ${range}.${gapText}`
}

export default function TrackerChart({ points, kind, unit, name, trading = false, width: forced }) {
  const list = Array.isArray(points) ? points.filter((p) => p && typeof p.day === 'string') : []
  const [boxRef, width] = useChartWidth(forced)
  const [table, setTable] = useState(false)
  const tableId = useId()
  const vals = list.map((p) => p.value).filter(finite)
  if (!list.length || !vals.length) return null
  const lo = Math.min(...vals)
  const hi = Math.max(...vals)
  const xs = spread(list.length, PAD_X, Math.max(PAD_X, width - PAD_X))
  const y = scale(lo, hi, H - PAD_B, PAD_T)
  const speech = chartSpeech(name, kind, unit, list, trading)
  return (
    <div className={own.chartWrap} data-tracker-chart="">
      <div className={own.chartFit} ref={boxRef}>
        <svg className={own.chart} viewBox={`0 0 ${width} ${H}`} width={width} height={H} role="img" aria-label={speech}>
          {runsOf(list, xs, y, trading).map((pts, j) => (
            <polyline key={`r${j}`} points={pts.join(' ')} className={own.chartLine} fill="none" />
          ))}
          {list.map((p, i) => (finite(p.value)
            ? <circle key={p.day} cx={xs[i]} cy={y(p.value)} r={DOT_R} className={own.chartDot} data-day={p.day} />
            : null))}
        </svg>
      </div>
      <button type="button" className={`btn btn-ghost ${own.tap} ${own.toggle}`} aria-expanded={table}
        aria-controls={table ? tableId : undefined} onClick={() => setTable((t) => !t)}>
        {table ? TABLE_HIDE : TABLE_TOGGLE}
      </button>
      {table && (
        <table id={tableId} className={own.table} data-tracker-table="">
          <caption className={own.caption}>{`${name || 'Tracker'}, as a table`}</caption>
          <thead>
            <tr><th scope="col">Day</th><th scope="col">Value</th></tr>
          </thead>
          <tbody>
            {list.map((p) => (
              <tr key={p.day}>
                <th scope="row">{dayWords(p.day)}</th>
                <td>{valueText(kind, p.value, unit) ?? 'No data'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
