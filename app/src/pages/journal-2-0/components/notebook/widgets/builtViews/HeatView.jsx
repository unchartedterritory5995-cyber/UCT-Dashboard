import { useCallback, useEffect, useId, useLayoutEffect, useRef } from 'react'
import { tableModelOf, measuresOf, compactValue, cellSpeech, SMALL_SAMPLE } from './builtModel'
import { useCellGroup, drillFor } from './cellGroup'
import { useChartWidth, useHitFloor, clamp, svgId, textW, TAP } from './svg'
import styles from './builtViews.module.css'
import { snapshotStyles as s } from '../SnapshotFrame'

/**
 * Built widgets (wave 8, Task 8.14): the calendar Heat map. One cell per day, laid out as a calendar (a column per
 * week, a row per weekday), shaded on a diverging blue-orange pair by the FIRST measure: blue for a gain, orange
 * for a loss, deeper for a larger value. Pure inline SVG (`<rect>`, `<text>`, a `<pattern>`) in REAL pixels at the
 * measured width (R-31): cells are at most 56 px and never stretch past the natural grid, so a short range is a
 * small map, not a wall of colour. A long range scrolls rather than shrinking cells below their floor (14 px, and
 * the 44 px finger floor on touch).
 * ⛔ Colour is never the only signal: every cell 32 px or larger (as RENDERED) carries its value as text, a smaller
 * one its sign (`+` / `−`), and a loss is also HATCHED. The text sits on an opaque backing in the page's own
 * surface and ink, so it keeps the page's text contrast whatever the fill, and the hatch never runs under it. An
 * unknown day is a plain cell, never a zero; a hidden one says "Not enough". A small sample has a corner mark and is
 * named under the map.
 */
const PAD_L = 22
const PAD_T = 20
const GAP = 2
export const MAX_CELL = 56
export const MIN_CELL = 14
/** At this RENDERED size or larger a cell carries its value as text; below it, only its sign (spec 5.11). */
export const TEXT_MIN_CELL = 32
const TEXT_PX = 10
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const MONTH_RE = /^\d{4}-\d{2}$/
const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MINUS = '−'
/** How far (px) the box may sit from its newest end and still count as there: a browser rounds a fractional
 *  scroll position, so an exact compare would snap (and expect a scroll event) for a move that never happens. */
export const SNAP_SLOP = 2
const nextFrame = (fn) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fn) : setTimeout(fn, 16))
const cancelFrame = (id) => (typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame(id) : clearTimeout(id))

/** UTC day number and weekday (0 = Sunday) for an ISO day label, or null. */
function dayOf(label) {
  const m = DAY_RE.exec(String(label || ''))
  if (!m) return null
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  if (!Number.isFinite(t)) return null
  return { n: Math.round(t / 86400000), wd: new Date(t).getUTCDay() }
}

const LINE_H = TEXT_PX + 2
/** Do these lines fit INSIDE the cell (2 px clear on each side, so the backing never spills past it)? */
export const linesFit = (lines, cell) => lines.every((t) => textW(t, TEXT_PX) <= cell - 4)
  && lines.length * LINE_H + 2 <= cell

/** The lines of text one cell shows at its rendered size: its value when the cell is 32 px or more AND the
 *  value's estimated width fits (cell - 4), else its sign; for an unknown cell the words that fit, else none (its
 *  name and tooltip still say it). */
export function cellLines(c, cell, fmt) {
  const v = c.value
  if (typeof v === 'number') {
    const text = compactValue(v, fmt)
    if (cell >= TEXT_MIN_CELL && linesFit([text], cell)) return [text]
    return [v > 0 ? '+' : v < 0 ? MINUS : '0']
  }
  if (cell < TEXT_MIN_CELL) return []
  const choices = c.hidden
    ? [...(typeof c.n === 'number' ? [['Not', 'enough', `(${c.n})`]] : []), ['Not', 'enough']]
    : [['no', 'data']]
  return choices.find((lines) => linesFit(lines, cell)) || []
}

export default function HeatView({ params, onDrill, width: forced }) {
  const p = params || {}
  const model = tableModelOf(p)
  const ms = measuresOf(p)
  const m = ms[0] || {}
  const [measureRef, width] = useChartWidth(forced)
  // The box may scroll sideways (a long range at the touch floor): it opens at the NEWEST end and goes back there
  // when the DATA changes. A width change alone (the box measured, a rotation) keeps it at the newest end only
  // until the member scrolls it themselves: after that their position is theirs.
  const boxEl = useRef(null)
  const boxRef = useCallback((el) => { boxEl.current = el; measureRef(el) }, [measureRef])
  const rowsKey = `${model.rows.length}:${model.rows[0]?.label || ''}:${model.rows[model.rows.length - 1]?.label || ''}`
  const lastKey = useRef(null)
  const userScrolled = useRef(false)
  const ours = useRef(false)
  const oursFrame = useRef(0)
  useLayoutEffect(() => {
    const el = boxEl.current
    const dataChanged = lastKey.current !== rowsKey
    lastKey.current = rowsKey
    if (dataChanged) userScrolled.current = false
    if (!el || userScrolled.current) return
    const end = el.scrollWidth - el.clientWidth
    if (end > 0 && Math.abs(el.scrollLeft - end) > SNAP_SLOP) {
      // The scroll event this causes is ours, not the member's. It is ours for ONE frame (the browser fires the
      // scroll before the next frame's callbacks), so a move that fires no event never swallows the member's next.
      ours.current = true
      el.scrollLeft = end
      if (oursFrame.current) cancelFrame(oursFrame.current)
      oursFrame.current = nextFrame(() => { oursFrame.current = 0; ours.current = false })
    }
  }, [rowsKey, width])
  useEffect(() => () => { if (oursFrame.current) cancelFrame(oursFrame.current) }, [])
  const onScroll = () => {
    if (ours.current) { ours.current = false; return }
    userScrolled.current = true
  }
  const floor = useHitFloor()
  const group = useCellGroup()
  const hatch = `built-hatch-${svgId(useId())}`
  if (!model.rows.length) return <p className={s.empty}>{'No rows to show.'}</p>
  const days = model.rows.map((r) => dayOf(r.label))
  const calendar = days.every(Boolean)
  const monthly = !calendar && model.rows.every((r) => MONTH_RE.test(r.label))
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
  const fit = Math.floor((width - PAD_L) / cols) - GAP
  // A cell is a mark: the finger floor on touch; with a mouse, as small as its 10 px text allows.
  const cell = clamp(fit, floor === TAP ? TAP : MIN_CELL, MAX_CELL)
  const gridW = PAD_L + cols * (cell + GAP)
  const first = model.rows[0].label
  const last = model.rows[model.rows.length - 1].label
  const head = first === last ? first : `${first} to ${last}`
  // Never stretched past the natural grid; just wide enough for its own heading.
  const svgW = Math.max(gridW, PAD_L + head.length * 6.6 + 4)
  const height = PAD_T + rowsN * (cell + GAP)
  const vals = model.rows.map((r) => r.values[0]?.value).filter((v) => typeof v === 'number')
  const extent = Math.max(...vals.map(Math.abs), 0) || 1
  const small = model.rows.filter((r) => r.values[0]?.small).map((r) => r.label)
  const by = calendar ? 'by day' : monthly ? 'by month' : 'by period'
  return (
    <div className={styles.chartWrap}>
      {ms.length > 1 && (
        <p className={styles.caption} data-testid="built-heat-showing">
          {`Showing ${m.label || 'the first measure'}. Show as table for the rest.`}
        </p>
      )}
      <div className={styles.chartBox} ref={boxRef} onScroll={onScroll}>
        <svg className={styles.chart} viewBox={`0 0 ${svgW} ${height}`} width={svgW} height={height} role="group"
          aria-label={`${m.label || 'Value'} ${by}`} data-testid="built-heat-view" data-cell-size={cell}
          {...group.groupProps}>
          <defs>
            <pattern id={hatch} patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="6" className={styles.hatchLine} />
            </pattern>
          </defs>
          <text x={PAD_L} y={12} className={styles.tick}>{head}</text>
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
            const lines = cellLines(c, cell, m.fmt)
            const lineH = LINE_H
            // The backing covers the text and stays inside the cell (linesFit leaves 2 px each side).
            const backW = Math.min(cell, Math.ceil(Math.max(...lines.map((t) => textW(t, TEXT_PX)), 0)) + 4)
            const backH = Math.min(cell, lines.length * lineH + 2)
            const speech = `${r.label}: ${cellSpeech(c, m)}`
            return (
              <g key={r.key} className={styles.mark}
                data-heat-value={known ? (v < 0 ? 'neg' : v > 0 ? 'pos' : 'zero') : (c.hidden ? 'hidden' : 'none')}
                {...group.itemProps(i, drillFor(onDrill, r, r.label), speech)}>
                <title>{speech}</title>
                <rect x={x} y={y} width={cell} height={cell} rx={2} className={tone} fillOpacity={strength} data-hit="" />
                {known && v < 0 && <rect x={x} y={y} width={cell} height={cell} rx={2} fill={`url(#${hatch})`} data-hatch="" />}
                {c.small && (
                  <polygon points={`${x + cell - 9},${y} ${x + cell},${y} ${x + cell},${y + 9}`} className={styles.smallMark}
                    data-small="" />
                )}
                {lines.length > 0 && (
                  <>
                    <rect x={x + (cell - backW) / 2} y={y + (cell - backH) / 2} width={backW} height={backH} rx={2}
                      className={styles.heatTextBack} data-heat-back="" />
                    <text x={x + cell / 2} y={y + cell / 2 - ((lines.length - 1) * lineH) / 2} className={styles.heatText}
                      textAnchor="middle" dominantBaseline="middle">
                      {lines.map((t, k) => <tspan key={`t${k}`} x={x + cell / 2} dy={k === 0 ? 0 : lineH}>{t}</tspan>)}
                    </text>
                  </>
                )}
                <rect x={x} y={y} width={cell} height={cell} rx={2} className={styles.heatRing} data-ring="" />
              </g>
            )
          })}
        </svg>
      </div>
      <p className={styles.caption}>{'Blue: a gain · Orange, hatched: a loss · deeper is larger.'}</p>
      {small.length > 0 && (
        <p className={styles.caption} data-testid="built-heat-small">
          <span className={styles.badge}>{SMALL_SAMPLE}</span>{` ${small.join(', ')} (marked in the corner)`}
        </p>
      )}
    </div>
  )
}
