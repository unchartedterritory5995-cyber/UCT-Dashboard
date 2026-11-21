// app/src/components/chart/builder/authoring/emptyOnChart.js
//
// WHAT A BUILT LINE DOES NOT SHOW ON THIS CHART, SAID PLAINLY (2026-11-21).
//
// THE GAP, found by a value check of a live round: an answer described a line ("the year to date change")
// that was blank on every bar of this year; another was right but had no value at all on a chart with less
// history than the running value needed. Each sat under a confident sentence. Nothing in the window looked at
// the member's own chart, so nothing said so.
//
// WHAT THIS IS. After an answer is applied and the chart has drawn its preview, each drawn output is read and,
// when it has no value on the chart's newest bar, UCT says so in its own words: how many of the newest bars are
// blank and when its last value was, or that it has no value on any bar, with the reason in numbers when the
// formula's own reach is longer than the chart's history.
//
// ⛔ IT STATES, IT NEVER REFUSES, AND THAT WAS MEASURED. A pivot high has a value on a few bars in a hundred
// and none on the newest ones; "the close only on a new closing high" is blank since its last event; a level
// held from an event that has not happened on this chart is blank everywhere. All are right answers. Nothing
// numeric separates them from the defect, so the member is told what is on their chart and judges.
//
// ⛔ IT COMPUTES NOTHING. Value-running the definition a second time beside the chart measured up to half a
// second of main thread on 5,000 bars for a running value. The chart already drew it: `binder.bindings()`
// (handed down as `engineChart.bindings`) carries each drawn output's `lastValue` (the newest bar's value, the
// field the header's latest value and the legend read) and its series. This file reads those.
//
// ONE CLASSIFIER. Whether a column is empty at a bar, and which way, is `barInspection.whyEmpty` (the
// "Inspect a bar" vocabulary: never / a gap). No second one is written here.
//
// ⛔ STATED LIMITS.
//   * An output the chart does not draw (a hidden plot kept for alerts) has no binding and gets no sentence.
//   * The newest bar's answer is exact for every drawn output (`lastValue`). HOW MANY bars and WHEN are read
//     from the points the chart holds, and are said only where those points are the whole line: a line the
//     chart splits at its gaps gets the newest-bar sentence alone; on a long chart only the recent rows are
//     handed to the renderer (`plotWindow.js`), so "on any bar" is said only when every row was drawn, and
//     otherwise the count of rows that were.
//   * A date is worded only for a chart whose bars are days or longer.
import { whyEmpty, EMPTY } from '../inspect/barInspection'
import { maxLookback, declaredInputs } from '../../engine/ast/lint'
import { outputTreeOf } from '../../engine/outputType'
import { STUDIO_PREVIEW_DEF_ID } from '../studio/chartPreview'

/** When the chart is read after an answer is applied (ms). The binder draws in the chart's own render pass,
 *  after the preview is installed, and publishes nothing when it has: so a few spaced reads, stopped at the
 *  first that finds the preview drawn. Nothing runs after the last. */
export const EMPTY_READ_DELAYS_MS = Object.freeze([0, 150, 400, 1000, 2500])

export const EMPTY_ON_CHART = Object.freeze({
  NEVER: 'never',            // no value on any bar of the chart
  NONE_DRAWN: 'none-drawn',  // no value on any row the chart drew (a long chart draws its recent rows)
  NEWEST: 'newest',          // no value on the newest K bars; a value before them
  NEWEST_BAR: 'newest-bar',  // no value on the newest bar; how far back is not read (see the limits above)
})

const finite = (v) => typeof v === 'number' && Number.isFinite(v)
const MONTHS = Object.freeze(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'])

/** A point's value: a line's `value`, a candle payload's `close`. Whitespace has neither. */
const pointValue = (p) => (p && finite(p.value) ? p.value : (p && finite(p.close) ? p.close : NaN))

/** A daily-or-longer bar's time as "31 Dec 2025", else null (an intraday time is not worded here). */
export function dayWords(time) {
  let y, m, d
  if (typeof time === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(time)) [y, m, d] = time.split('-').map(Number)
  else if (time && typeof time === 'object' && Number.isInteger(time.year)) ({ year: y, month: m, day: d } = time)
  else return null
  return Number.isInteger(m) && m >= 1 && m <= 12 && Number.isInteger(d) ? `${d} ${MONTHS[m - 1]} ${y}` : null
}

/** The series' own points, or null when it cannot be read. */
function pointsOf(binding) {
  try {
    const data = binding && binding.series && typeof binding.series.data === 'function' ? binding.series.data() : null
    return Array.isArray(data) ? data : null
  } catch { return null }
}

/**
 * What the preview's drawn outputs do not show on this chart.
 * @param {object} p
 * @param {object[]} p.bindings   `engineChart.bindings()`: the chart's drawn series
 * @param {object} p.definition   the preview definition (for each output's own reach)
 * @param {number} p.barCount     the chart's bars
 * @param {string} [p.defId]      whose bindings to read (the studio preview's)
 * @returns {{ drawn: boolean, items: {key, code, blankBars?, lastDay?, rows?, reach?, bars}[] }}
 *   `drawn` false: the chart has not drawn the preview (yet). `items`: one per output with no value on the newest bar.
 */
export function emptyOnThisChart({ bindings, definition, barCount, defId = STUDIO_PREVIEW_DEF_ID } = {}) {
  const mine = (Array.isArray(bindings) ? bindings : []).filter((b) => b && b.defId === defId && typeof b.plotKey === 'string' && b.series)
  if (mine.length === 0) return { drawn: false, items: [] }
  const bars = Number.isInteger(barCount) ? barCount : 0
  const items = []
  const seen = new Set()
  for (const b of mine) {
    if (seen.has(b.plotKey)) continue
    seen.add(b.plotKey)
    if (finite(b.lastValue)) continue                       // the newest bar has a value: nothing to say
    const item = { key: b.plotKey, code: EMPTY_ON_CHART.NEWEST_BAR, bars }
    const split = Array.isArray(b.runSeries) && b.runSeries.length > 0
    const points = split ? null : pointsOf(b)
    if (points && points.length > 0) {
      const column = points.map(pointValue)
      const why = whyEmpty(column, column.length - 1)        // ⛔ the one classifier
      if (why && why.code === EMPTY.NEVER) {
        if (bars > 0 && column.length >= bars) item.code = EMPTY_ON_CHART.NEVER
        else { item.code = EMPTY_ON_CHART.NONE_DRAWN; item.rows = column.length }
      } else if (why && why.code === EMPTY.GAP) {
        let last = column.length - 1
        while (last >= 0 && !finite(column[last])) last -= 1
        item.code = EMPTY_ON_CHART.NEWEST
        item.blankBars = column.length - 1 - last
        const day = dayWords(points[last] && points[last].time)
        if (day) item.lastDay = day
      }
      // `why` null: the points end on a value although the binding's newest value is blank. The two disagree,
      // so only what `lastValue` proves is said.
    }
    // the reason, when it is a number: the formula's own reach is longer than this chart's history
    if (item.code === EMPTY_ON_CHART.NEVER || item.code === EMPTY_ON_CHART.NEWEST_BAR) {
      try {
        const tree = outputTreeOf(definition, b.plotKey)
        const reach = tree ? maxLookback(tree, { inputs: declaredInputs(definition) }) : null
        if (finite(reach) && bars > 0 && reach >= bars) item.reach = reach
      } catch { /* no reason is better than a wrong one */ }
    }
    items.push(item)
  }
  return { drawn: true, items }
}

const count = (n) => n.toLocaleString('en-US')

/** UCT's sentence for one item. `name` is given only when the indicator has more than one output. */
export function emptyOnChartWords(item, { name = null } = {}) {
  if (!item) return ''
  const lead = name ? `${name}: on this chart it` : 'On this chart it'
  const reach = finite(item.reach) ? ` It needs ${count(item.reach)} bars of history and this chart has ${count(item.bars)}.` : ''
  switch (item.code) {
    case EMPTY_ON_CHART.NEVER:
      return `${lead} has no value on any bar.${reach}`
    case EMPTY_ON_CHART.NONE_DRAWN:
      return `${lead} has no value on any of the newest ${count(item.rows)} bars.`
    case EMPTY_ON_CHART.NEWEST:
      return item.blankBars === 1
        ? `${lead} has no value on the newest bar${item.lastDay ? `; its last value is on ${item.lastDay}` : ''}.`
        : `${lead} has no value on the newest ${count(item.blankBars)} bars${item.lastDay ? `; its last value is on ${item.lastDay}` : ''}.`
    case EMPTY_ON_CHART.NEWEST_BAR:
      return `${lead} has no value on the newest bar.${reach}`
    default:
      return ''
  }
}

/**
 * Read the chart at `EMPTY_READ_DELAYS_MS` until it has drawn the preview, then report once.
 * `read()` answers `emptyOnThisChart(...)`. `onResult(items)` is called at most once, with the first read
 * that finds the preview drawn. If none does, it is never called (silence). The returned function cancels:
 * after it, no timer is pending and `onResult` is never called.
 */
export function watchEmptyOnChart({ read, onResult, delays = EMPTY_READ_DELAYS_MS, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let done = false
  const timers = new Set()
  const cancel = () => {
    done = true
    for (const t of timers) clearTimer(t)
    timers.clear()
  }
  for (const ms of delays) {
    const t = setTimer(() => {
      timers.delete(t)
      if (done) return
      let got = null
      try { got = read() } catch { got = null }
      if (!got || got.drawn !== true) return
      cancel()                                               // the first hit ends every later read
      onResult(Array.isArray(got.items) ? got.items : [])
    }, ms)
    timers.add(t)
  }
  return cancel
}
