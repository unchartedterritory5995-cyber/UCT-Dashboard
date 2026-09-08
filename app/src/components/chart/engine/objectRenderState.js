// app/src/components/chart/engine/objectRenderState.js
//
// ─── ⭐⭐ C3B — THE GENERIC RENDER STATE ─────────────────────────────────────
//
// The layer that lets the object model outlive both Pine and lightweight-charts.
//
//   PINE SOURCE → CANONICAL OBJECT PROGRAM → OBJECT STATE EVALUATOR
//                                                 ↓
//                                        GENERIC RENDER STATE     ← this file
//                                                 ↓
//                                           CHART ADAPTER
//
// ⛔ NOTHING HERE KNOWS WHAT A CANVAS IS, and nothing here knows what Pine is.
// It takes the live objects the evaluator produced and answers one question per
// object: *where, in chart coordinates, and in what colour*. The adapter turns
// that into pixels; the Builder will one day produce it without a Pine round
// trip. A render state that carried a canvas context would make the second of
// those impossible, which is why the layering is stated rather than implied.
//
// ⭐⭐ THE COORDINATE CONVERSION IS THE ONE REAL PIECE OF WORK. Pine addresses a
// bar by INDEX (`bar_index`) or by TIME (`time`); a chart addresses it by time.
// A bar index past the last bar is a real and common case — `line.new(bar_index
// + 20, …)` projects a level forward — so the conversion EXTRAPOLATES using the
// series' own median spacing rather than clamping. Clamping would silently drag
// every projection back onto the last bar, which looks like a working chart and
// is a different drawing.
//
// ⚠️ AND IT REPORTS WHAT IT COULD NOT PLACE. An object whose coordinate is `na`
// or non-finite is DROPPED and COUNTED, never rendered at zero. `dropped` is
// what stops "the object model works" from being said about a chart that
// quietly lost half its lines.

/** Pine's own defaults, so an object drawn with two arguments still looks like
 *  the author's. ⛔ Every one of these is Pine's documented default, not a
 *  house preference — a UCT-flavoured default here is an imported indicator
 *  that comes back subtly wrong. */
export const OBJECT_DEFAULTS = Object.freeze({
  line: Object.freeze({
    xloc: 'bar_index', extend: 'none', color: '#2962FF', style: 'solid', width: 1,
  }),
  label: Object.freeze({
    xloc: 'bar_index', yloc: 'price', color: '#2962FF', style: 'label_down',
    textcolor: '#FFFFFF', size: 'normal', textalign: 'center', text: '',
  }),
  box: Object.freeze({
    xloc: 'bar_index', extend: 'none', border_color: '#2962FF', border_width: 1,
    border_style: 'solid', bgcolor: 'rgba(41,98,255,0.20)',
  }),
  table: Object.freeze({
    position: 'top_right', bgcolor: 'transparent', frame_width: 0, border_width: 0,
  }),
  linefill: Object.freeze({ color: 'rgba(41,98,255,0.20)' }),
})

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/**
 * Bar index → the chart's own time axis, extrapolating past the last bar.
 *
 * ⭐ THE SPACING IS MEASURED FROM THE SERIES, not assumed. A daily chart's bars
 * are not 86400 apart across a weekend, so a fixed step would drift; the median
 * of the last differences is stable against holidays and half-days both.
 */
export function makeBarClock(bars) {
  const n = Array.isArray(bars) ? bars.length : 0
  const times = new Array(n)
  for (let i = 0; i < n; i += 1) times[i] = Number(bars[i].t)
  let step = 86400
  if (n >= 3) {
    const d = []
    for (let i = Math.max(1, n - 40); i < n; i += 1) {
      const gap = times[i] - times[i - 1]
      if (gap > 0) d.push(gap)
    }
    if (d.length) { d.sort((a, b) => a - b); step = d[Math.floor(d.length / 2)] }
  }
  return {
    count: n,
    step,
    /** a bar INDEX → a time, extrapolated on both sides */
    timeAt(i) {
      if (!Number.isFinite(i)) return null
      if (n === 0) return null
      const k = Math.round(i)
      if (k >= 0 && k < n) return times[k]
      if (k >= n) return times[n - 1] + (k - (n - 1)) * step
      return times[0] + k * step
    },
  }
}

/** One object property → a chart x-coordinate (a TIME), honouring `xloc`. */
function xOf(value, xloc, clock) {
  const v = num(value)
  if (v === null) return null
  return xloc === 'bar_time' ? v : clock.timeAt(v)
}

/**
 * @param {Array}  live   `evaluateObjects(...).live`
 * @param {object} opts
 * @param {Array}  opts.bars  the series the program was evaluated over
 * @returns {{lines, labels, boxes, tables, fills, dropped, counts}}
 */
export function toRenderState(live, opts = {}) {
  const clock = makeBarClock(opts.bars || [])
  const lines = []
  const labels = []
  const boxes = []
  const tables = []
  const fills = []
  const dropped = { line: 0, label: 0, box: 0, table: 0, linefill: 0 }
  const byId = new Map()

  for (const o of live || []) {
    const p = { ...OBJECT_DEFAULTS[o.family], ...o.props }
    if (o.family === 'line') {
      const x1 = xOf(p.x1, p.xloc, clock)
      const x2 = xOf(p.x2, p.xloc, clock)
      const y1 = num(p.y1)
      const y2 = num(p.y2)
      if (x1 === null || x2 === null || y1 === null || y2 === null) { dropped.line += 1; continue }
      const row = {
        id: o.id, x1, y1, x2, y2, extend: p.extend, color: p.color, style: p.style, width: p.width,
      }
      lines.push(row)
      byId.set(o.id, row)
    } else if (o.family === 'label') {
      const x = xOf(p.x, p.xloc, clock)
      const y = num(p.y)
      if (x === null) { dropped.label += 1; continue }
      labels.push({
        id: o.id,
        x,
        // ⭐ `yloc.abovebar`/`belowbar` ANCHOR TO THE BAR, not to a price, and
        // the adapter needs to know which — so `y` may legitimately be null.
        y: p.yloc === 'price' ? y : null,
        yloc: p.yloc,
        text: p.text === undefined || p.text === null ? '' : String(p.text),
        style: p.style,
        color: p.color,
        textcolor: p.textcolor,
        size: p.size,
        textalign: p.textalign,
        ...(p.tooltip ? { tooltip: String(p.tooltip) } : {}),
      })
    } else if (o.family === 'box') {
      const left = xOf(p.left, p.xloc, clock)
      const right = xOf(p.right, p.xloc, clock)
      const top = num(p.top)
      const bottom = num(p.bottom)
      if (left === null || right === null || top === null || bottom === null) { dropped.box += 1; continue }
      boxes.push({
        id: o.id,
        left: Math.min(left, right),
        right: Math.max(left, right),
        // ⭐ TOP IS THE HIGHER PRICE. Pine lets an author pass them either way
        // round and draws the same box; normalising here means the adapter never
        // has to, and a zero-height box stays zero-height rather than inverting.
        top: Math.max(top, bottom),
        bottom: Math.min(top, bottom),
        extend: p.extend,
        border_color: p.border_color,
        border_width: p.border_width,
        border_style: p.border_style,
        bgcolor: p.bgcolor,
        ...(p.text ? { text: String(p.text), text_color: p.text_color, text_size: p.text_size } : {}),
      })
    } else if (o.family === 'table') {
      tables.push({
        id: o.id,
        position: p.position,
        bgcolor: p.bgcolor,
        frame_color: p.frame_color,
        frame_width: p.frame_width,
        border_color: p.border_color,
        border_width: p.border_width,
        // ⭐ ROW-MAJOR, ALWAYS. The runtime already emits cells sorted, but the
        // render state is the contract an ADAPTER reads and a Builder may one
        // day produce — so it fixes the order itself rather than inheriting one
        // producer's habit. A table whose row order depends on which cell the
        // author happened to write first is not a table.
        cells: [...(o.cells || [])].sort((x, y) => (x.row - y.row) || (x.col - y.col)).map((c) => ({
          col: c.col,
          row: c.row,
          text: c.props.text === undefined || c.props.text === null ? '' : String(c.props.text),
          text_color: c.props.text_color,
          text_size: c.props.text_size,
          text_halign: c.props.text_halign,
          text_valign: c.props.text_valign,
          bgcolor: c.props.bgcolor,
        })),
      })
    } else if (o.family === 'linefill') {
      // ⛔ A FILL WITHOUT BOTH ITS LINES IS NOT A FILL. If either reference has
      // been deleted or was dropped for a bad coordinate, this is dropped too —
      // a one-edged band is a shape the author never drew.
      const a = p.line1 && p.line1.__ref ? byId.get(p.line1.__ref) : null
      const b = p.line2 && p.line2.__ref ? byId.get(p.line2.__ref) : null
      if (!a || !b) { dropped.linefill += 1; continue }
      fills.push({ id: o.id, a: a.id, b: b.id, color: p.color })
    }
  }

  return {
    lines,
    labels,
    boxes,
    tables,
    fills,
    dropped,
    counts: {
      line: lines.length,
      label: labels.length,
      box: boxes.length,
      table: tables.length,
      linefill: fills.length,
    },
  }
}
