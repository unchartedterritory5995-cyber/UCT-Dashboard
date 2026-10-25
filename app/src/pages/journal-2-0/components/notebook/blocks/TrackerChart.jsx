// The tracker block's small chart (Notebook widgets phase 2, wave 9, Task 9.14): the last 30 entries as inline SVG
// (`<polyline>` and `<circle>`, no chart engine), oldest on the left, with its text alternative and a "Show as table"
// toggle that renders the SAME points as an HTML table (spec 5.11).
//
// ⛔ A missing value is a GAP: the line breaks there and no dot is drawn, and the table says "No data". It is never
//    drawn at 0 and never read as 0.
// ⛔ The width is the shared built-view measure (widgets/builtViews/svg.useChartWidth), whose hysteresis stops a
//    ResizeObserver loop (rule H14). This file adds no observer of its own.
// ⛔ The line and the dots are --accent, a graphic on the block's --bg-elevated at 3:1 or better in every theme
//    (TrackerBlock.test.jsx measures it); the labels are --text-muted, text at 4.5:1 or better.
import { useId, useState } from 'react'
import { useChartWidth, scale, spread } from '../widgets/builtViews/svg'
import { dayWords } from '../../../lib/blocks/toolDays'
import { valueText } from '../../../lib/blocks/trackerValues'
import own from './TrackerBlock.module.css'

export const H = 96
const PAD_X = 10
const PAD_T = 10
const PAD_B = 10
export const DOT_R = 3
export const TABLE_TOGGLE = 'Show as table'

const finite = (v) => typeof v === 'number' && Number.isFinite(v)

/** The runs of consecutive points that have a value: each is one polyline, so a missing value breaks the line. */
export function runsOf(points, xs, y) {
  const out = []
  let run = []
  points.forEach((p, i) => {
    if (finite(p.value)) run.push(`${xs[i].toFixed(1)},${y(p.value).toFixed(1)}`)
    else if (run.length) { out.push(run); run = [] }
  })
  if (run.length) out.push(run)
  return out
}

/** The chart's text alternative: what it shows, in one sentence. */
export function chartSpeech(name, kind, unit, points) {
  const vals = points.map((p) => p.value).filter(finite)
  const n = points.length
  const what = `${name || 'Tracker'}, the last ${n === 1 ? 'entry' : `${n} entries`}`
  if (!vals.length) return `${what}, with no values`
  const lo = Math.min(...vals)
  const hi = Math.max(...vals)
  const first = points[0]
  const last = points[points.length - 1]
  const range = lo === hi ? `all ${valueText(kind, lo, unit)}` : `from ${valueText(kind, lo, unit)} to ${valueText(kind, hi, unit)}`
  return `${what} (${dayWords(first.day)} to ${dayWords(last.day)}), ${range}`
}

export default function TrackerChart({ points, kind, unit, name, width: forced }) {
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
  const speech = chartSpeech(name, kind, unit, list)
  return (
    <div className={own.chartWrap} data-tracker-chart="">
      <div className={own.chartFit} ref={boxRef}>
        <svg className={own.chart} viewBox={`0 0 ${width} ${H}`} width={width} height={H} role="img" aria-label={speech}>
          {runsOf(list, xs, y).map((pts, j) => (
            <polyline key={`r${j}`} points={pts.join(' ')} className={own.chartLine} fill="none" />
          ))}
          {list.map((p, i) => (finite(p.value)
            ? <circle key={p.day} cx={xs[i]} cy={y(p.value)} r={DOT_R} className={own.chartDot} data-day={p.day} />
            : null))}
        </svg>
      </div>
      <button type="button" className={`btn btn-ghost ${own.tap} ${own.toggle}`} aria-pressed={table}
        aria-controls={table ? tableId : undefined} onClick={() => setTable((t) => !t)}>
        {TABLE_TOGGLE}
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
                <td>{dayWords(p.day)}</td>
                <td>{valueText(kind, p.value, unit) ?? 'No data'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
