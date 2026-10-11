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
// ⭐⭐ TABLES ARE VIEWPORT-ANCHORED AND ARE NO LONGER DRAWN HERE. Their position
// is `top_right`, not a price and a time, so `layoutTables` (still below, still
// the one authority for what the grid IS) gives a grid plus a PANE FRACTION —
// and R2 step 6 gave that grid to `objectTableDom.js`, which builds a real
// `<table>`. Read that file's header for the three reasons; the short one is
// that a raster cannot carry a trailing space and the vendor comparison needs
// the string. This file keeps the lines, labels, boxes and fills, which do live
// in price/time and do belong on a canvas.
//
// ⚰️ AND FOR ONE ROUND OF EVIDENCE THEY WERE NOT DRAWN AT ALL. `layoutTables`
// existed, was tested, and had no consumer: the live run reported `tables: 1`
// beside `pixels: 0`, and the comment that used to sit here said a DOM layer
// would place them — a layer nobody had written. 19 of the reachable 27 scripts
// are table-driven, so that was the majority of the population rendering nothing
// while every count looked right. ⛔ That layer exists NOW, and the canvas
// painter was removed in the same commit rather than kept beside it: two
// renderers over one layout would put the same dashboard on the pane twice.

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

/** Pine's text-size words in pixels. ⭐ EXPORTED because the DOM table
  *  adapter reads the SAME vocabulary — a `size = size.small` label on the
  *  canvas and a `text_size = size.small` cell in the table must mean one
  *  number, and two private copies is how they stop meaning one number. */
export const TEXT_SIZE_PX = Object.freeze({
  tiny: 8, small: 10, normal: 12, large: 16, huge: 22, auto: 12,
})
const LABEL_FONT_PX = TEXT_SIZE_PX

const DASH = Object.freeze({
  solid: [], dashed: [6, 4], dotted: [2, 3], arrow_left: [], arrow_right: [], arrow_both: [],
})

// ─── ⭐⭐ UIE PHASE 2 (M5) — WHAT A LABEL'S STYLE IS, NOT ONLY WHERE IT SITS ───────
//
// Every label used to be the same filled rectangle, offset by its style. Pine's styles
// are two different things: the `label_*` ones are a BODY with a POINTER at the anchor,
// and the shape ones (`circle`, `triangleup`, `xcross`, …) are a GLYPH at the anchor with
// the text beside it; `none` is text alone, `text_outline` outlined text.
// ⚠️ THE GEOMETRY IS THIS ENGINE'S, NOT A MEASURED TRADINGVIEW ONE: no capture in the
// repo pins a glyph's pixel size or the gap to its text, so these are drawn the way the
// style names them, and graded only on what the harness compares (count, text, colour).
const SHAPE_STYLES = new Set(['circle', 'square', 'diamond', 'triangleup', 'triangledown', 'arrowup',
  'arrowdown', 'xcross', 'cross', 'flag'])
const POINTER_STYLES = new Set(['label_down', 'label_up', 'label_left', 'label_right', 'label_lower_left',
  'label_lower_right', 'label_upper_left', 'label_upper_right'])
/** A shape glyph's side in pixels, by Pine's size word. */
const SHAPE_PX = Object.freeze({ tiny: 6, small: 9, normal: 13, large: 19, huge: 27, auto: 13 })
const POINTER_PX = 6

/** One glyph centred at (cx, cy), filled (and stroked, for the line glyphs) in `c`. */
function drawShape(ctx, style, cx, cy, s, c) {
  const h = s / 2
  ctx.fillStyle = c
  ctx.strokeStyle = c
  ctx.beginPath()
  switch (style) {
    case 'circle':
      if (typeof ctx.arc === 'function') ctx.arc(cx, cy, h, 0, Math.PI * 2)
      ctx.fill()
      return
    case 'square':
      ctx.fillRect(cx - h, cy - h, s, s)
      return
    case 'diamond':
      ctx.moveTo(cx, cy - h); ctx.lineTo(cx + h, cy); ctx.lineTo(cx, cy + h); ctx.lineTo(cx - h, cy)
      ctx.closePath(); ctx.fill()
      return
    case 'triangleup':
      ctx.moveTo(cx, cy - h); ctx.lineTo(cx + h, cy + h); ctx.lineTo(cx - h, cy + h)
      ctx.closePath(); ctx.fill()
      return
    case 'triangledown':
      ctx.moveTo(cx, cy + h); ctx.lineTo(cx + h, cy - h); ctx.lineTo(cx - h, cy - h)
      ctx.closePath(); ctx.fill()
      return
    case 'arrowup':
    case 'arrowdown': {
      const d = style === 'arrowup' ? -1 : 1        // the tip's direction on screen
      ctx.moveTo(cx, cy + d * h)                     // tip
      ctx.lineTo(cx + h * 0.8, cy)
      ctx.lineTo(cx + h * 0.3, cy)
      ctx.lineTo(cx + h * 0.3, cy - d * h)
      ctx.lineTo(cx - h * 0.3, cy - d * h)
      ctx.lineTo(cx - h * 0.3, cy)
      ctx.lineTo(cx - h * 0.8, cy)
      ctx.closePath(); ctx.fill()
      return
    }
    case 'xcross':
      ctx.lineWidth = Math.max(1, s / 6)
      ctx.moveTo(cx - h, cy - h); ctx.lineTo(cx + h, cy + h)
      ctx.moveTo(cx + h, cy - h); ctx.lineTo(cx - h, cy + h)
      ctx.stroke()
      return
    case 'cross':
      ctx.lineWidth = Math.max(1, s / 6)
      ctx.moveTo(cx - h, cy); ctx.lineTo(cx + h, cy)
      ctx.moveTo(cx, cy - h); ctx.lineTo(cx, cy + h)
      ctx.stroke()
      return
    case 'flag':
      ctx.lineWidth = 1
      ctx.moveTo(cx - h, cy + h); ctx.lineTo(cx - h, cy - h)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(cx - h, cy - h); ctx.lineTo(cx + h, cy - h * 0.5); ctx.lineTo(cx - h, cy)
      ctx.closePath(); ctx.fill()
      return
    default:
  }
}

/** A filled arrowhead with its tip at (x, y), pointing away from (fx, fy). */
function drawArrowhead(ctx, fx, fy, x, y, size, c) {
  const len = Math.hypot(x - fx, y - fy)
  if (!(len > 0)) return
  const ux = (x - fx) / len
  const uy = (y - fy) / len
  ctx.save()
  ctx.setLineDash([])
  ctx.fillStyle = c
  ctx.beginPath()
  ctx.moveTo(x, y)
  ctx.lineTo(x - ux * size - uy * size * 0.5, y - uy * size + ux * size * 0.5)
  ctx.lineTo(x - ux * size + uy * size * 0.5, y - uy * size - ux * size * 0.5)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

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
 * @param {number} [m.rightInset]  the price scale's width at the right: the plot ends there
 * @returns {{drawn:object, skipped:object}}
 */
export function paintObjects(ctx, state, m) {
  const drawn = { line: 0, label: 0, box: 0, linefill: 0, table: 0 }
  const skipped = { line: 0, label: 0, box: 0, linefill: 0, table: 0 }
  // ⭐⭐ WHERE IT DREW, NOT JUST THAT IT DREW. A count says the loop ran; a
  // bounding box says whether anything landed on the pane. The first live run
  // reported `drawn: 2` beside an empty raster, and the two facts together are
  // what separate "the painter never ran" from "the painter drew off-screen" —
  // which need completely different fixes.
  const bbox = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }
  const seen = (x, y) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    if (x < bbox.x0) bbox.x0 = x
    if (y < bbox.y0) bbox.y0 = y
    if (x > bbox.x1) bbox.x1 = x
    if (y > bbox.y1) bbox.y1 = y
  }
  if (!ctx || !state) return { drawn, skipped, bbox: null }
  const { timeToX, priceToY, width, height } = m
  // ⛔⛔ `Number.isFinite`, NOT `!Number.isNaN`. A chart asked to place a time it
  // cannot resolve may answer `null`, `NaN` OR a real number far outside the
  // pane; the first two are caught here and the third is a genuine off-screen
  // object, which is why `bbox` is reported beside the counts. The earlier
  // `isNaN`-only test let `Infinity` through as a coordinate.
  const finite = (v) => typeof v === 'number' && Number.isFinite(v)
  // ⭐⭐ UIE PHASE 3 (M3B) — AN ENDPOINT THE CHART HOLDS NO SLOT FOR. A line from a pivot
  // 300 bars back on a chart that loaded 200 used to be DROPPED whole: `timeToX` has no
  // coordinate for a time before the first loaded bar (or past the last, beyond the
  // chart's own future slots). Such an endpoint is placed by BAR, from the spacing of the
  // two loaded bars at that end (the chart spaces bars uniformly, so this is its own
  // coordinate, not a guess), and the canvas clip below cuts the line at the plot's edge.
  // ⛔ Only an `xloc.bar_index` endpoint OUTSIDE the loaded bars: a loaded bar the chart
  // cannot place, or a `bar_time` instant, stays unplaced and the object is skipped.
  const fr = state.frame
  const spacingAt = new Map()
  const spacing = (ta, tb) => {
    const key = `${ta}|${tb}`
    if (!spacingAt.has(key)) {
      const xa = timeToX(ta)
      const xb = timeToX(tb)
      spacingAt.set(key, finite(xa) && finite(xb) && xb > xa ? { x: xa, dx: xb - xa } : null)
    }
    return spacingAt.get(key)
  }
  const barX = (bi) => {
    if (!fr || !Number.isInteger(bi)) return null
    if (bi < 0) { const sp = spacing(fr.first, fr.second); return sp ? sp.x + bi * sp.dx : null }
    if (bi > fr.n - 1) { const sp = spacing(fr.prev, fr.last); return sp ? sp.x + (bi - (fr.n - 2)) * sp.dx : null }
    return null
  }
  const xy = (t, p, bi) => {
    let x = timeToX(t)
    if (!finite(x)) x = barX(bi)
    const y = p === null || p === undefined ? null : priceToY(p)
    return finite(x) ? { x, y: finite(y) ? y : null } : null
  }
  // ⭐ UIE PHASE 3 (M3B) — EVERYTHING IS CLIPPED TO THE PLOT: a line placed past the
  // loaded bars, or extended, stops at the plot's left edge and at the price scale
  // (`rightInset`), never painted over the axis labels.
  const plotRight = width - (finite(m.rightInset) && m.rightInset > 0 ? m.rightInset : 0)
  const clipped = typeof ctx.rect === 'function' && typeof ctx.clip === 'function'
  if (clipped) {
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, 0, plotRight, height)
    ctx.clip()
  }
  /** How far right an `extend`ed edge runs — the pane, never a guess. */
  const RIGHT = width
  const LEFT = 0

  const lineById = new Map()

  // ── boxes first: they are backgrounds, and a line drawn under a box is a
  // line the author cannot see. Pine paints in creation order within a family,
  // and families in this order, which is what a member is used to.
  for (const b of state.boxes || []) {
    const a = xy(b.left, b.top, b.bleft)
    const c = xy(b.right, b.bottom, b.bright)
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
    // ⭐⭐ UIE PHASE 2 (M5) — A BOX'S TEXT, where its author put it (`text_halign` /
    // `text_valign`, centred unless said), one line per `\n`. It was carried into the
    // render state and never painted.
    if (b.text) {
      const px = TEXT_SIZE_PX[b.text_size] || 12
      const lines = String(b.text).split('\n')
      const left = Math.min(x1, x2)
      const right = Math.max(x1, x2)
      const top = Math.min(a.y, c.y)
      const bottom = Math.max(a.y, c.y)
      ctx.setLineDash([])
      ctx.font = `${px}px -apple-system, Segoe UI, sans-serif`
      ctx.fillStyle = b.text_color || '#000000'
      ctx.textAlign = b.text_halign === 'left' ? 'left' : b.text_halign === 'right' ? 'right' : 'center'
      ctx.textBaseline = 'middle'
      const tx = b.text_halign === 'left' ? left + 4 : b.text_halign === 'right' ? right - 4 : (left + right) / 2
      const lh = px + 2
      const block = lh * lines.length
      const y0 = b.text_valign === 'top' ? top + 2 + lh / 2
        : b.text_valign === 'bottom' ? bottom - 2 - block + lh / 2
          : (top + bottom) / 2 - block / 2 + lh / 2
      lines.forEach((t, i) => ctx.fillText(t, tx, y0 + i * lh))
    }
    ctx.restore()
    seen(x1, a.y); seen(x2, c.y)
    drawn.box += 1
  }

  for (const l of state.lines || []) {
    const a = xy(l.x1, l.y1, l.bx1)
    const b = xy(l.x2, l.y2, l.bx2)
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
    // ⭐ UIE PHASE 2 (M5) — `line.style_arrow_*` were drawn as plain solid lines: the
    // head sits on the end the style names, pointing along the line.
    if (l.style === 'arrow_right' || l.style === 'arrow_left' || l.style === 'arrow_both') {
      const size = 5 + 2 * Math.max(1, l.width || 1)
      if (l.style !== 'arrow_left') drawArrowhead(ctx, x1, y1, x2, y2, size, l.color)
      if (l.style !== 'arrow_right') drawArrowhead(ctx, x2, y2, x1, y1, size, l.color)
    }
    lineById.set(l.id, { x1, y1, x2, y2 })
    seen(x1, y1); seen(x2, y2)
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
    const p = xy(lb.x, lb.y, lb.bx)
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
    const anchor = LABEL_ANCHOR[lb.style] || LABEL_ANCHOR.label_center
    // ⭐⭐ UIE PHASE 2 (M5) — `dy` IS PINE'S SENSE (+1 = the body sits BELOW the anchor,
    // `label_up`'s pointer pointing up at it), and SCREEN y GROWS DOWNWARD, so the body's
    // y moves by +dy. ⚰️ It moved by −dy: every `label_down` (the "sell" callout above a
    // bar) was drawn BELOW its anchor, over the candle it names.
    if (SHAPE_STYLES.has(lb.style)) {
      // a GLYPH at the anchor, the text beyond it on the side the style faces
      const s = SHAPE_PX[lb.size] || SHAPE_PX.normal
      const cx = p.x + (anchor.dx * s) / 2
      const cy = y + (anchor.dy * s) / 2
      drawShape(ctx, lb.style, cx, cy, s, lb.color || '#2962FF')
      if (text) {
        ctx.fillStyle = lb.textcolor || lb.color || '#2962FF'
        const side = anchor.dy < 0 ? -1 : 1
        ctx.fillText(text, cx, cy + side * (s / 2 + px / 2 + 2))
      }
      ctx.restore()
      seen(cx - s / 2, cy - s / 2); seen(cx + s / 2, cy + s / 2)
      drawn.label += 1
      continue
    }
    if (lb.style === 'none' || lb.style === 'text_outline') {
      // TEXT ALONE at the anchor — no body (a `none` label's colour is its shape's,
      // and it has none); `text_outline` rings the text in the label's colour
      if (text) {
        if (lb.style === 'text_outline' && lb.color && typeof ctx.strokeText === 'function') {
          ctx.strokeStyle = lb.color
          ctx.lineWidth = 3
          ctx.strokeText(text, p.x, y)
        }
        ctx.fillStyle = lb.textcolor || '#FFFFFF'
        ctx.fillText(text, p.x, y)
      }
      ctx.restore()
      seen(p.x, y)
      drawn.label += 1
      continue
    }
    const w = text ? ctx.measureText(text).width + 8 : 10
    const h = px + 6
    const pointer = POINTER_STYLES.has(lb.style) ? POINTER_PX : 0
    const bx = p.x - (w / 2) + anchor.dx * (w / 2 + pointer)
    const by = y - (h / 2) + anchor.dy * (h / 2 + pointer)
    if (lb.color) {
      ctx.fillStyle = lb.color
      ctx.fillRect(bx, by, w, h)
      if (pointer) {
        // the POINTER: its tip on the anchor, its base on the body's near edge
        ctx.beginPath()
        ctx.moveTo(p.x, y)
        if (anchor.dx === 0) {
          ctx.lineTo(p.x - pointer, y + anchor.dy * pointer)
          ctx.lineTo(p.x + pointer, y + anchor.dy * pointer)
        } else if (anchor.dy === 0) {
          ctx.lineTo(p.x + anchor.dx * pointer, y - pointer)
          ctx.lineTo(p.x + anchor.dx * pointer, y + pointer)
        } else {
          ctx.lineTo(p.x + anchor.dx * pointer * 2, y + anchor.dy * pointer)
          ctx.lineTo(p.x + anchor.dx * pointer, y + anchor.dy * pointer * 2)
        }
        ctx.closePath()
        ctx.fill()
      }
    }
    if (text) {
      ctx.fillStyle = lb.textcolor || '#FFFFFF'
      const tx = ctx.textAlign === 'left' ? bx + 4 : ctx.textAlign === 'right' ? bx + w - 4 : bx + w / 2
      ctx.fillText(text, tx, by + h / 2)
    }
    ctx.restore()
    seen(bx, by); seen(bx + w, by + h)
    drawn.label += 1
  }

  // ⚰⚰ THE TABLE USED TO BE PAINTED HERE, AND IS NOT ANY MORE. R2 step 6
  // moved it to `objectTableDom.js`, which reads the same `layoutTables(state)`
  // and builds a real `<table>`: the cell text becomes readable by an
  // instrument (a raster cannot carry a TRAILING SPACE, and the vendor
  // captures this is compared against were taken by wrapping `fillText` for
  // exactly that reason), the type stays crisp at any `devicePixelRatio`
  // without a backing store to scale, and nine CSS corners re-place it on a
  // resize with nothing having run.
  //
  // ⛔ IT IS A MOVE, NOT AN ADDITION. Leaving `paintTable` here beside the DOM
  // layer would draw one table twice, from one layout, through two different
  // sets of measured column widths — the second-authority-over-one-value defect
  // this repo keeps paying for, in its most visible possible form.
  // `drawn.table` and `skipped.table` stay in the shape below and stay ZERO:
  // the counters an observer reads are the DOM layer's own, on its own node.

  if (clipped) ctx.restore()
  return {
    drawn,
    skipped,
    bbox: Number.isFinite(bbox.x0)
      ? { x0: Math.round(bbox.x0), y0: Math.round(bbox.y0), x1: Math.round(bbox.x1), y1: Math.round(bbox.y1) }
      : null,
  }
}

/** ⭐ THE MARGIN IS THE TABLE'S, AND THE DOM ADAPTER READS IT. How far a
 *  dashboard sits off the pane edge is one number, not one per renderer. */
export const TABLE_MARGIN = 8

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
    // ⭐ A MERGED CELL COVERS its rectangle: every other address in it is
    // marked `covered`, so the renderer spans the top-left cell over them
    // instead of drawing them beside it.
    for (const c of t.cells || []) {
      const cs = c.colspan > 1 ? c.colspan : 1
      const rs = c.rowspan > 1 ? c.rowspan : 1
      if (cs === 1 && rs === 1) continue
      for (let r = c.row; r < Math.min(rows, c.row + rs); r += 1) {
        for (let k = c.col; k < Math.min(cols, c.col + cs); k += 1) {
          if (r === c.row && k === c.col) continue
          grid[r][k] = { ...(grid[r][k] || { col: k, row: r, text: '' }), covered: true }
        }
      }
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
