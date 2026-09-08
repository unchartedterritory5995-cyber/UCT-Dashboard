// app/src/components/chart/engine/objectCanvas.js
//
// ─── ⭐⭐ C3B — THE CHART ADAPTER, AS A PURE FUNCTION ────────────────────────
//
// The last layer:
//
//   PINE → OBJECT PROGRAM → EVALUATOR → GENERIC RENDER STATE → **this** → chart
//
// ⭐⭐ IT IS PURE ON PURPOSE, and that is the whole reason it is a module rather
// than the body of a React component. Everything above it is already covered by
// unit tests; a painter buried in a `useEffect` would be the one layer nobody
// could test, which is exactly where a drawing quietly goes wrong. So the
// coordinate functions and the 2D context are ARGUMENTS: a test can hand it a
// recording stub and assert what was drawn, and the component becomes a shell
// with nothing in it to get wrong.
//
// ⛔ AND IT NEVER INVENTS A COORDINATE. `timeToX` returns null for a time the
// chart cannot place (off the visible axis on a chart that has not settled);
// `priceToY` returns null past the pane. An object with a null coordinate is
// SKIPPED and counted in `stats.skipped` — never clamped to an edge, which
// would pile every off-screen line onto the last visible bar and look like a
// cluster the author never drew.
//
// ⚠️ TABLES ARE NOT DRAWN HERE. They are viewport-anchored, not bar-anchored:
// their position is `top_right`, not a price and a time. `layoutTables` returns
// their geometry in PANE fractions so a DOM layer can place them; forcing them
// into price/time coordinates is exactly what the wave forbids.

/** Pine's label styles → where the label body sits relative to its anchor.
 *  ⛔ A STYLE WE DO NOT KNOW DRAWS A PLAIN BOX AT THE ANCHOR rather than
 *  guessing a direction: an arrow pointing the wrong way is a worse error than
 *  no arrow. */
const LABEL_ANCHOR = Object.freeze({
  label_down: { dx: 0, dy: -1 },
  label_up: { dx: 0, dy: 1 },
  label_left: { dx: 1, dy: 0 },
  label_right: { dx: -1, dy: 0 },
  label_lower_left: { dx: 1, dy: -1 },
  label_lower_right: { dx: -1, dy: -1 },
  label_upper_left: { dx: 1, dy: 1 },
  label_upper_right: { dx: -1, dy: 1 },
  label_center: { dx: 0, dy: 0 },
  none: { dx: 0, dy: 0 },
  circle: { dx: 0, dy: 0 },
  square: { dx: 0, dy: 0 },
  diamond: { dx: 0, dy: 0 },
  arrowup: { dx: 0, dy: 1 },
  arrowdown: { dx: 0, dy: -1 },
  triangleup: { dx: 0, dy: 1 },
  triangledown: { dx: 0, dy: -1 },
  xcross: { dx: 0, dy: 0 },
  cross: { dx: 0, dy: 0 },
  flag: { dx: 0, dy: -1 },
  text_outline: { dx: 0, dy: 0 },
})

const LABEL_FONT_PX = Object.freeze({
  tiny: 8, small: 10, normal: 12, large: 16, huge: 22, auto: 12,
})

const DASH = Object.freeze({
  solid: [], dashed: [6, 4], dotted: [2, 3], arrow_left: [], arrow_right: [], arrow_both: [],
})

/**
 * Paint one render state.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} state         `toRenderState(...)` output
 * @param {object} m             the mapping into pixels
 * @param {(t:number)=>number|null} m.timeToX
 * @param {(p:number)=>number|null} m.priceToY
 * @param {number} m.width
 * @param {number} m.height
 * @returns {{drawn:object, skipped:object}}
 */
export function paintObjects(ctx, state, m) {
  const drawn = { line: 0, label: 0, box: 0, linefill: 0 }
  const skipped = { line: 0, label: 0, box: 0, linefill: 0 }
  if (!ctx || !state) return { drawn, skipped }
  const { timeToX, priceToY, width, height } = m
  const xy = (t, p) => {
    const x = timeToX(t)
    const y = p === null || p === undefined ? null : priceToY(p)
    return (x === null || x === undefined || Number.isNaN(x)) ? null
      : { x, y: (y === null || y === undefined || Number.isNaN(y)) ? null : y }
  }
  /** How far right an `extend`ed edge runs — the pane, never a guess. */
  const RIGHT = width
  const LEFT = 0

  const lineById = new Map()

  // ── boxes first: they are backgrounds, and a line drawn under a box is a
  // line the author cannot see. Pine paints in creation order within a family,
  // and families in this order, which is what a member is used to.
  for (const b of state.boxes || []) {
    const a = xy(b.left, b.top)
    const c = xy(b.right, b.bottom)
    if (!a || !c || a.y === null || c.y === null) { skipped.box += 1; continue }
    let x1 = a.x
    let x2 = c.x
    if (b.extend === 'right' || b.extend === 'both') x2 = RIGHT
    if (b.extend === 'left' || b.extend === 'both') x1 = LEFT
    ctx.save()
    if (b.bgcolor) {
      ctx.fillStyle = b.bgcolor
      ctx.fillRect(x1, a.y, x2 - x1, c.y - a.y)
    }
    if (b.border_width > 0 && b.border_color) {
      ctx.strokeStyle = b.border_color
      ctx.lineWidth = b.border_width
      ctx.setLineDash(DASH[b.border_style] || [])
      ctx.strokeRect(x1, a.y, x2 - x1, c.y - a.y)
    }
    ctx.restore()
    drawn.box += 1
  }

  for (const l of state.lines || []) {
    const a = xy(l.x1, l.y1)
    const b = xy(l.x2, l.y2)
    if (!a || !b || a.y === null || b.y === null) { skipped.line += 1; continue }
    let { x: x1, y: y1 } = a
    let { x: x2, y: y2 } = b
    // ⭐ EXTENDING A LINE KEEPS ITS SLOPE. Snapping the endpoint to the pane
    // edge without following the slope turns a trend line into a horizontal
    // one, which is a different claim about the market.
    if (l.extend === 'right' || l.extend === 'both') {
      if (x2 !== x1) { y2 += ((RIGHT - x2) * (y2 - y1)) / (x2 - x1) }
      x2 = RIGHT
    }
    if (l.extend === 'left' || l.extend === 'both') {
      if (x2 !== x1) { y1 -= ((x1 - LEFT) * (y2 - y1)) / (x2 - x1) }
      x1 = LEFT
    }
    ctx.save()
    ctx.strokeStyle = l.color
    ctx.lineWidth = Math.max(1, l.width || 1)
    ctx.setLineDash(DASH[l.style] || [])
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.stroke()
    ctx.restore()
    lineById.set(l.id, { x1, y1, x2, y2 })
    drawn.line += 1
  }

  // ── fills between two lines, as the quadrilateral they bound
  for (const f of state.fills || []) {
    const a = lineById.get(f.a)
    const b = lineById.get(f.b)
    if (!a || !b) { skipped.linefill += 1; continue }
    ctx.save()
    ctx.fillStyle = f.color
    ctx.beginPath()
    ctx.moveTo(a.x1, a.y1)
    ctx.lineTo(a.x2, a.y2)
    ctx.lineTo(b.x2, b.y2)
    ctx.lineTo(b.x1, b.y1)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
    drawn.linefill += 1
  }

  for (const lb of state.labels || []) {
    const p = xy(lb.x, lb.y)
    if (!p) { skipped.label += 1; continue }
    // ⭐ A BAR-ANCHORED LABEL WITH NO PRICE sits at the pane edge it names.
    const y = p.y !== null ? p.y
      : (lb.yloc === 'abovebar' ? height * 0.12 : height * 0.88)
    const px = LABEL_FONT_PX[lb.size] || 12
    ctx.save()
    ctx.font = `${px}px -apple-system, Segoe UI, sans-serif`
    ctx.textBaseline = 'middle'
    ctx.textAlign = lb.textalign === 'left' ? 'left' : lb.textalign === 'right' ? 'right' : 'center'
    const text = lb.text || ''
    const w = text ? ctx.measureText(text).width + 8 : 10
    const h = px + 6
    const anchor = LABEL_ANCHOR[lb.style] || LABEL_ANCHOR.label_center
    const bx = p.x - (w / 2) + (anchor.dx * w) / 2
    const by = y - (h / 2) - (anchor.dy * h) / 2
    if (lb.color) {
      ctx.fillStyle = lb.color
      ctx.fillRect(bx, by, w, h)
    }
    if (text) {
      ctx.fillStyle = lb.textcolor || '#FFFFFF'
      const tx = ctx.textAlign === 'left' ? bx + 4 : ctx.textAlign === 'right' ? bx + w - 4 : bx + w / 2
      ctx.fillText(text, tx, by + h / 2)
    }
    ctx.restore()
    drawn.label += 1
  }

  return { drawn, skipped }
}

/** Pine's nine table positions → a pane-fraction anchor.
 *  ⛔ FRACTIONS, NOT PIXELS. The consumer knows its own size; handing it pixels
 *  would make this layer depend on a viewport it cannot see. */
export const TABLE_ANCHORS = Object.freeze({
  top_left: { h: 0, v: 0 },
  top_center: { h: 0.5, v: 0 },
  top_right: { h: 1, v: 0 },
  middle_left: { h: 0, v: 0.5 },
  middle_center: { h: 0.5, v: 0.5 },
  middle_right: { h: 1, v: 0.5 },
  bottom_left: { h: 0, v: 1 },
  bottom_center: { h: 0.5, v: 1 },
  bottom_right: { h: 1, v: 1 },
})

/**
 * ⭐⭐ TABLES ARE VIEWPORT-ANCHORED AND STAY THAT WAY. A dashboard pinned to the
 * top-right does not move when the chart is panned, and does not belong to a
 * price or a time. This returns a grid a DOM layer can place; the wave's own
 * rule is "do not force table placement into price/time coordinates".
 */
export function layoutTables(state) {
  return (state.tables || []).map((t) => {
    const cols = Math.max(1, ...((t.cells || []).map((c) => c.col + 1)))
    const rows = Math.max(1, ...((t.cells || []).map((c) => c.row + 1)))
    const grid = Array.from({ length: rows }, () => Array.from({ length: cols }, () => null))
    for (const c of t.cells || []) {
      if (c.row < rows && c.col < cols) grid[c.row][c.col] = c
    }
    return {
      id: t.id,
      anchor: TABLE_ANCHORS[t.position] || TABLE_ANCHORS.top_right,
      position: t.position,
      cols,
      rows,
      grid,
      bgcolor: t.bgcolor,
      frame_color: t.frame_color,
      frame_width: t.frame_width,
      border_color: t.border_color,
      border_width: t.border_width,
    }
  })
}
