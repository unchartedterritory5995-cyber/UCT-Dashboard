// ONLY THE RECENT WINDOW OF AN INDICATOR'S SERIES IS HANDED TO THE RENDERER.
//
// ⚰️ MEASURED ON PRODUCTION 2026-11-13 (a member arrowing down the S&P 100 list, a CPU
// profile of one flip onto an 11,762-bar daily chart): 743 ms of main-thread work while
// profiling, of which about 205 ms was `series.setData` and about 165 ms was the chart
// library turning EVERY row of EVERY line series into a render item on the next frame.
// Ten indicator series times 11,762 rows, to draw the 200 bars on screen. A 441-bar
// chart on the same board took 121 ms. The bars, the columns and the legend were never
// the cost: the rows handed to the renderer were.
//
// So an indicator's series is given the rows from a window start onward. Nothing is
// computed differently: the columns are whole (every bar), the legend, the alerts, the
// end label and the scan read the columns, and inside the window each point is the
// point it always was. The candles and the volume keep every bar. What a member sees
// changes only if they could see the window's left edge, and they cannot:
//
//   * the window is at least `PLOT_WINDOW_MIN_BARS` rows, or `PLOT_WINDOW_SCREENS`
//     screens of the zoom the chart opened at, whichever is more;
//   * the chart watches its own visible range, and the moment the view comes within a
//     screen of the window start it draws everything (`plotWindowTooNarrow`), and
//     stays whole for that symbol and timeframe;
//   * a chart with under `PLOT_WINDOW_MIN_SAVED` rows to save is never windowed, so
//     every short chart and every first intraday paint is exactly what it was.
//
// The start moves in steps of `PLOT_WINDOW_STEP`, so a new bar does not move it: the
// one-point `update` path of a live chart is untouched.
//
// Switch: localStorage `uct.plotwindow.off` = "1" draws every row, as before.

/** localStorage key: "1" turns the window off for this browser (every row is drawn). */
export const PLOT_WINDOW_OFF_KEY = 'uct.plotwindow.off'
/** The window holds at least this many rows ... */
export const PLOT_WINDOW_MIN_BARS = 2000
/** ... or this many screens of the zoom the chart opened at. */
export const PLOT_WINDOW_SCREENS = 4
/** The window's first row is a multiple of this, so appended bars do not move it. */
export const PLOT_WINDOW_STEP = 500
/** With fewer rows than this to leave out, everything is drawn. */
export const PLOT_WINDOW_MIN_SAVED = 1000
/** The view must stay at least this many bars (and one screen) right of the window start. */
export const PLOT_WINDOW_MARGIN_BARS = 250

export function plotWindowDisabled() {
  try { return typeof localStorage !== 'undefined' && localStorage.getItem(PLOT_WINDOW_OFF_KEY) === '1' } catch { return false }
}

/**
 * How many rows the window holds, decided ONCE per (symbol, timeframe) load from the
 * zoom the chart had when it opened (`visibleSpan` bars across; unknown reads as 0).
 */
export function plotWindowRows(visibleSpan) {
  const span = Number.isFinite(visibleSpan) && visibleSpan > 0 ? visibleSpan : 0
  return Math.max(PLOT_WINDOW_MIN_BARS, Math.ceil(span * PLOT_WINDOW_SCREENS))
}

/** The index of the first row drawn. 0: everything. */
export function plotWindowStart(barCount, rows) {
  if (!Number.isFinite(barCount) || !Number.isFinite(rows) || barCount <= 0 || rows <= 0) return 0
  const raw = Math.floor(barCount) - Math.floor(rows)
  if (raw < PLOT_WINDOW_MIN_SAVED) return 0
  return Math.floor(raw / PLOT_WINDOW_STEP) * PLOT_WINDOW_STEP
}

/**
 * Has the view come close enough to the window start that every row must be drawn?
 * Two readings of the same fact, either of which is enough (the second does not depend
 * on a logical index meaning a bar index):
 *   * by index: the visible left edge, less one screen (at least `PLOT_WINDOW_MARGIN_BARS`),
 *     is left of the window start;
 *   * by pixel: the window start's own x is within one plot width of the left edge.
 * Unknown readings are skipped, never guessed: with nothing to read it answers false
 * (the chart has not laid out yet, and the next range change asks again).
 */
export function plotWindowTooNarrow({ start, fromIndex, toIndex, startX, plotWidth } = {}) {
  if (!(start > 0)) return false
  if (Number.isFinite(fromIndex)) {
    const span = Number.isFinite(toIndex) ? Math.max(0, toIndex - fromIndex) : 0
    if (fromIndex - Math.max(PLOT_WINDOW_MARGIN_BARS, span) < start) return true
  }
  if (Number.isFinite(startX) && Number.isFinite(plotWidth) && plotWidth > 0 && startX > -plotWidth) return true
  return false
}

// -1 / 0 / 1, or null when the two cannot be ordered (different kinds of time).
function compareTimes(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return a < b ? -1 : a > b ? 1 : 0
  if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0   // 'YYYY-MM-DD'
  if (a && b && typeof a === 'object' && typeof b === 'object'
    && Number.isFinite(a.year) && Number.isFinite(b.year)) {
    return (a.year - b.year) || (a.month - b.month) || (a.day - b.day) || 0
  }
  return null
}

const _cut = new WeakMap()   // points array -> { from, out }: one slice per array per window start

/**
 * The points at or after `fromTime`: the SAME array when there is no window, when no
 * point is before it, or when the times cannot be ordered against it (fail open: every
 * row drawn). Points are in time order (they are built one per bar). The cut is
 * remembered per array, so a pass that changes nothing hands back the same slice.
 */
export function windowedPoints(points, fromTime) {
  if (fromTime === null || fromTime === undefined || !Array.isArray(points) || points.length === 0) return points
  const hit = _cut.get(points)
  if (hit && hit.from === fromTime) return hit.out
  let lo = 0
  let hi = points.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    const c = compareTimes(points[mid] ? points[mid].time : undefined, fromTime)
    if (c === null) return points
    if (c < 0) lo = mid + 1
    else hi = mid
  }
  const out = lo === 0 ? points : points.slice(lo)
  _cut.set(points, { from: fromTime, out })
  return out
}
