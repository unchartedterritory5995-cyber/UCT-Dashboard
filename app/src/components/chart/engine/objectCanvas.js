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
export const LABEL_ANCHOR = Object.freeze({
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
import { POINT_SIZE_ANCHORS, pointSizeWord } from './objectPointSizes.js'

/** ⭐⭐ A BOX's TEXT and a TABLE cell, MEASURED ON TRADINGVIEW (queue row Q-LB3, 2026-11-17): probe
 *  `tools/visual_conformance/probes/vw-lb3-box-table-sizes.pine` on NYSE:RDDT 1D, TradingView's own
 *  `fillText` traced read-only: tiny 8, small 10, normal 14, large 20, huge 36 px, the same for a box and a
 *  cell, and the very numbers the Pine reference equates the words with (`POINT_SIZE_ANCHORS.boxTable`).
 *  ⚰️ They were the engine's own 8 / 10 / 12 / 16 / 22. `auto` is not measured and keeps 12.
 *  ⛔ A LABEL's font is its own (`LABEL_GEOMETRY`, Q-LB2), not this table. */
export const TEXT_SIZE_PX = Object.freeze({
  tiny: 8, small: 10, normal: 14, large: 20, huge: 36, auto: 12,
})

/** ⭐⭐ ENGINE 52 — a drawing's text size: a `size.*` word, or a v6 int in points that the
 *  reference equates with a word (`objectPointSizes.js`), drawn exactly as that word. Both lanes
 *  withhold any other int by name, so none reaches here; were one to, it is the word table's
 *  `normal` only because nothing else is witnessed (and a rail pins that both lanes withhold). */
export function textSizePx(size, kind = 'label', table = TEXT_SIZE_PX) {
  if (typeof size === 'number') {
    const w = pointSizeWord(size, kind)
    return w ? table[w] : table.normal
  }
  return table[size] || table.normal
}
export { POINT_SIZE_ANCHORS }
/** ⭐ P2 — a label's or a box's `text_formatting` → the canvas font's style/weight
 *  prefix (two independent axes, as `objectTableDom.js` reads a cell's). */
export const fontStyleOf = (fmt) => {
  const f = typeof fmt === 'string' ? fmt : ''
  return `${f.includes('italic') ? 'italic ' : ''}${f.includes('bold') ? 'bold ' : ''}`
}

const DASH = Object.freeze({
  solid: [], dashed: [6, 4], dotted: [2, 3], arrow_left: [], arrow_right: [], arrow_both: [],
})

// ─── ⭐⭐ UIE PHASE 2 (M5) — WHAT A LABEL'S STYLE IS, NOT ONLY WHERE IT SITS ───────
//
// Every label used to be the same filled rectangle, offset by its style. Pine's styles
// are two different things: the `label_*` ones are a BODY with a POINTER at the anchor,
// and the shape ones (`circle`, `triangleup`, `xcross`, …) are a GLYPH at the anchor with
// the text beside it; `none` is text alone, `text_outline` outlined text.
const SHAPE_STYLES = new Set(['circle', 'square', 'diamond', 'triangleup', 'triangledown', 'arrowup',
  'arrowdown', 'xcross', 'cross', 'flag'])
const POINTER_STYLES = new Set(['label_down', 'label_up', 'label_left', 'label_right', 'label_lower_left',
  'label_lower_right', 'label_upper_left', 'label_upper_right'])
/** A shape glyph's side in pixels, by Pine's size word: ONLY for the glyphs no capture measured
 *  (`arrowup`, `arrowdown`, `xcross`, `cross`), which keep the size and place they had. */
const SHAPE_PX = Object.freeze({ tiny: 6, small: 9, normal: 13, large: 19, huge: 27, auto: 13 })

/**
 * ⭐⭐ A LABEL'S GEOMETRY, MEASURED ON TRADINGVIEW (queue rows Q-LB1 / Q-LB2, 2026-11-17).
 *
 * Probe `tools/visual_conformance/probes/vw-lb2-label-geometry.pine` on NYSE:RDDT 1D, one capture
 * per size word, with TradingView's own canvas calls traced read-only. The numbers, and only the
 * numbers, are in `__tests__/__fixtures__/labelGeometry.tradingview.json`; the rails hold the
 * painter to them. Pixel offsets are from the label's anchor, and screen y grows downward.
 *
 * ⚰️ Until then the geometry was this engine's own (a 12 / 16 px font, a body `px + 6` tall and
 * `text + 8` wide, a 6 px pointer, a 13 px glyph with its text beside it). TradingView draws
 * `size.large` at 18 px, a one-line body twice the font tall, a 30 px circle at `size.normal`,
 * `style_none` text ABOVE its anchor, and a glyph's text ABOVE the glyph whichever way it points.
 *
 *   px          the font
 *   pitch       one line to the next
 *   bodyH       a one-line body's height (each further line adds a pitch)
 *   padW        a body's width beyond its widest line; minW, the narrowest body (a short text's)
 *   pointerV    an up / down pointer's length; pointerH, a left / right one's
 *   noneTop     `style_none`: the LAST line's top (the block ends at the anchor)
 *   centredTop  a CENTRED one-line text's top from the centre: `style_text_outline`'s from its anchor,
 *               a body's from the body's middle (a block of lines is centred there by its pitch)
 *   glyphTop    a glyph style: the LAST line's top, above the glyph (the block grows upward)
 * `auto` reads `normal`. Text is placed by its TOP (`textBaseline = 'top'`), as TradingView's is.
 */
export const LABEL_GEOMETRY = Object.freeze({
  tiny: Object.freeze({ px: 7.2, pitch: 8.2, bodyH: 14, padW: 10.97, pointerV: 5, pointerH: 4, minW: 18, noneTop: -7, centredTop: -3, glyphTop: -22 }),
  small: Object.freeze({ px: 9.6, pitch: 11.6, bodyH: 18, padW: 12.63, pointerV: 7, pointerH: 5, minW: 22, noneTop: -10, centredTop: -4, glyphTop: -29 }),
  normal: Object.freeze({ px: 12, pitch: 14, bodyH: 24, padW: 17.29, pointerV: 8, pointerH: 6, minW: 29, noneTop: -12, centredTop: -5, glyphTop: -37 }),
  large: Object.freeze({ px: 18, pitch: 21, bodyH: 37, padW: 24.43, pointerV: 12, pointerH: 9, minW: 42, noneTop: -18, centredTop: -7, glyphTop: -55 }),
  huge: Object.freeze({ px: 24, pitch: 28, bodyH: 50, padW: 32.57, pointerV: 16, pointerH: 12, minW: 56, noneTop: -24, centredTop: -10, glyphTop: -74 }),
})
/** ⭐ A LABEL's font, read off `LABEL_GEOMETRY` (one authority). A box's text and a table cell keep
 *  `TEXT_SIZE_PX`, which no capture has measured for them (queue row Q-LB3). */
const LABEL_FONT_PX = Object.freeze({
  ...Object.fromEntries(Object.entries(LABEL_GEOMETRY).map(([w, g]) => [w, g.px])), auto: LABEL_GEOMETRY.normal.px,
})
/** The measured glyphs' boxes, `[width, height, top]` (top from the anchor), by size word. */
export const GLYPH_BOX = Object.freeze({
  circle: Object.freeze({ tiny: [18, 18, -8.87], small: [24, 24, -11.87], normal: [30, 30, -14.87], large: [45, 45, -22.37], huge: [60, 60, -29.87] }),
  square: Object.freeze({ tiny: [16, 16, -7.5], small: [20, 20, -9.5], normal: [26, 26, -12.5], large: [38, 38, -18.5], huge: [50, 50, -24.5] }),
  diamond: Object.freeze({ tiny: [16, 16, -7.87], small: [20, 20, -9.87], normal: [26, 26, -12.87], large: [38, 38, -18.87], huge: [50, 50, -24.87] }),
  triangleup: Object.freeze({ tiny: [19, 15.5, -10], small: [25, 20.5, -14], normal: [31, 25.5, -16], large: [45, 38.5, -26], huge: [61, 50.5, -34] }),
  triangledown: Object.freeze({ tiny: [19, 14.5, -4.5], small: [25, 19.5, -6.5], normal: [31, 24.5, -7.5], large: [45, 37.5, -12.5], huge: [61, 49.5, -16.5] }),
  flag: Object.freeze({ tiny: [18, 15, -7.37], small: [24, 20, -9.87], normal: [30, 25, -12.37], large: [45, 37.5, -18.62], huge: [60, 50, -24.87] }),
})
/** A label's size word (`auto`, an unknown word and an unmapped point size read `normal`). */
export function labelSizeWord(size) {
  const w = typeof size === 'number' ? pointSizeWord(size, 'label') : size
  return Object.prototype.hasOwnProperty.call(LABEL_GEOMETRY, w) ? w : 'normal'
}
/**
 * ⭐⭐ A LABEL'S TEXT IS ONE LINE PER `\n` (2026-11-17), as Pine draws it and as a box's text is here.
 * ⚰️ It was ONE `fillText`, and a canvas ignores `\n`, so RS Rating's rating (`'\n\n       ' + rating`,
 * written to sit two lines below "RS Rating") was drawn ON the "RS Rating" line. An EMPTY line keeps
 * its height (a pitch) and paints nothing.
 */
const labelLines = (text) => String(text).split('\n')

/** ⭐ A MEASURED glyph (`GLYPH_BOX`), drawn to fill its measured box: `x` the anchor's x, `[w, h, top]`
 *  the box (top from the anchor's y). A triangle's apex is the box's far edge; a flag is a pennant on
 *  a pole down its left side. */
function drawGlyphBox(ctx, style, x, y, [w, h, top], c) {
  const x0 = x - w / 2
  const y0 = y + top
  ctx.fillStyle = c
  ctx.strokeStyle = c
  ctx.beginPath()
  switch (style) {
    case 'circle':
      if (typeof ctx.arc === 'function') ctx.arc(x, y0 + h / 2, w / 2, 0, Math.PI * 2)
      ctx.fill()
      return
    case 'square':
      ctx.fillRect(x0, y0, w, h)
      return
    case 'diamond':
      ctx.moveTo(x, y0); ctx.lineTo(x0 + w, y0 + h / 2); ctx.lineTo(x, y0 + h); ctx.lineTo(x0, y0 + h / 2)
      ctx.closePath(); ctx.fill()
      return
    case 'triangleup':
      ctx.moveTo(x, y0); ctx.lineTo(x0 + w, y0 + h); ctx.lineTo(x0, y0 + h)
      ctx.closePath(); ctx.fill()
      return
    case 'triangledown':
      ctx.moveTo(x, y0 + h); ctx.lineTo(x0 + w, y0); ctx.lineTo(x0, y0)
      ctx.closePath(); ctx.fill()
      return
    case 'flag':
      ctx.lineWidth = 1
      ctx.moveTo(x0, y0 + h); ctx.lineTo(x0, y0)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(x0, y0); ctx.lineTo(x0 + w, y0 + h / 2); ctx.lineTo(x0, y0 + h)
      ctx.closePath(); ctx.fill()
      return
    default:
  }
}

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
  // ⭐ (owner ruling 2026-11-24, "room for labels") HOW FAR A LABEL WHOSE ANCHOR IS ON THE PLOT RUNS PAST ITS RIGHT
  // EDGE (the price scale starts there), in px; 0 = every such label fits. Fred RS writes "RS Rating" and its number at
  // the newest bar; TradingView's 10-bar right margin leaves them room and ours did not. The host widens the gap by this
  // much (`labelRoom.js`). A label anchored OFF the plot (the member scrolled it away) is not counted. Read off the
  // labels with a BODY (`label_center` and the pointed styles, Fred's), whose width is already measured: a text-only
  // label adds no canvas call for it (the painter's calls are pinned by golden).
  let labelOverflowRight = 0
  const overflowsAt = (anchorX, rightEdge) => {
    if (!(anchorX >= 0 && anchorX <= plotRight) || !Number.isFinite(rightEdge)) return
    if (rightEdge - plotRight > labelOverflowRight) labelOverflowRight = rightEdge - plotRight
  }
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
      const px = textSizePx(b.text_size, 'boxTable')
      const lines = String(b.text).split('\n')
      const left = Math.min(x1, x2)
      const right = Math.max(x1, x2)
      const top = Math.min(a.y, c.y)
      const bottom = Math.max(a.y, c.y)
      ctx.setLineDash([])
      ctx.font = `${fontStyleOf(b.text_formatting)}${px}px -apple-system, Segoe UI, sans-serif`
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
    const px = textSizePx(lb.size, 'label', LABEL_FONT_PX)
    const word = labelSizeWord(lb.size)
    const g = LABEL_GEOMETRY[word]
    ctx.save()
    ctx.font = `${fontStyleOf(lb.text_formatting)}${px}px -apple-system, Segoe UI, sans-serif`
    // ⭐ text is placed by its TOP, as TradingView places it (every measured offset is a top)
    ctx.textBaseline = 'top'
    ctx.textAlign = lb.textalign === 'left' ? 'left' : lb.textalign === 'right' ? 'right' : 'center'
    const text = lb.text || ''
    const lines = text ? labelLines(text) : []
    const n = lines.length
    const anchor = LABEL_ANCHOR[lb.style] || LABEL_ANCHOR.label_center
    // ⭐⭐ UIE PHASE 2 (M5) — `dy` IS PINE'S SENSE (+1 = the body sits BELOW the anchor,
    // `label_up`'s pointer pointing up at it), and SCREEN y GROWS DOWNWARD, so the body's
    // y moves by +dy. ⚰️ It moved by −dy: every `label_down` (the "sell" callout above a
    // bar) was drawn BELOW its anchor, over the candle it names.
    if (SHAPE_STYLES.has(lb.style)) {
      // a GLYPH on the anchor; its text ABOVE it, whichever way it points (measured: every glyph
      // style's text top is the same), the last line's top at `glyphTop`, the block growing upward
      const box = GLYPH_BOX[lb.style] ? GLYPH_BOX[lb.style][word] : null
      let gx0, gy0, gx1, gy1
      if (box) {
        drawGlyphBox(ctx, lb.style, p.x, y, box, lb.color || '#2962FF')
        gx0 = p.x - box[0] / 2; gx1 = p.x + box[0] / 2; gy0 = y + box[2]; gy1 = y + box[2] + box[1]
      } else {
        // ⚠️ NOT MEASURED (arrowup / arrowdown / xcross / cross: TradingView strokes them, and the
        // trace read fills): the size and place they had
        const s = textSizePx(lb.size, 'label', SHAPE_PX)
        const cx = p.x + (anchor.dx * s) / 2
        const cy = y + (anchor.dy * s) / 2
        drawShape(ctx, lb.style, cx, cy, s, lb.color || '#2962FF')
        gx0 = cx - s / 2; gx1 = cx + s / 2; gy0 = cy - s / 2; gy1 = cy + s / 2
      }
      if (text) {
        ctx.fillStyle = lb.textcolor || lb.color || '#2962FF'
        lines.forEach((t, i) => { if (t) ctx.fillText(t, p.x, y + g.glyphTop - (n - 1 - i) * g.pitch) })
      }
      ctx.restore()
      seen(gx0, gy0); seen(gx1, gy1)
      drawn.label += 1
      continue
    }
    if (lb.style === 'none' || lb.style === 'text_outline') {
      // TEXT ALONE — no body (a `none` label's colour is its shape's, and it has none).
      // `none`: the block ENDS at the anchor (its last line's top at `noneTop`);
      // `text_outline`: the block is CENTRED on the anchor (a one-line text's top at `centredTop`)
      if (text) {
        const lineTop = lb.style === 'none'
          ? (i) => y + g.noneTop - (n - 1 - i) * g.pitch
          : (i) => y + g.centredTop + (i - (n - 1) / 2) * g.pitch
        if (lb.style === 'text_outline' && lb.color && typeof ctx.strokeText === 'function') {
          ctx.strokeStyle = lb.color
          ctx.lineWidth = 3
          lines.forEach((t, i) => { if (t) ctx.strokeText(t, p.x, lineTop(i)) })
        }
        ctx.fillStyle = lb.textcolor || '#FFFFFF'
        lines.forEach((t, i) => { if (t) ctx.fillText(t, p.x, lineTop(i)) })
      }
      ctx.restore()
      seen(p.x, y)
      drawn.label += 1
      continue
    }
    // a BODY: `padW` wider than its widest line and never narrower than `minW`, `bodyH` tall plus a
    // pitch per further line, the text block centred in it as `text_outline`'s is on its anchor; a
    // pointer of `pointerV` (up / down) or `pointerH` (left / right) to the anchor
    const textW = text ? Math.max(...lines.map((t) => (t ? ctx.measureText(t).width : 0))) : 0
    const w = Math.max(textW + g.padW, g.minW)
    const h = g.bodyH + (n > 1 ? (n - 1) * g.pitch : 0)
    const pointed = POINTER_STYLES.has(lb.style)
    const pv = pointed ? g.pointerV : 0
    const ph = pointed ? g.pointerH : 0
    const bx = p.x - (w / 2) + anchor.dx * (w / 2 + ph)
    const by = y - (h / 2) + anchor.dy * (h / 2 + pv)
    if (lb.color) {
      ctx.fillStyle = lb.color
      ctx.fillRect(bx, by, w, h)
      if (pointed) {
        // the POINTER: its tip on the anchor, its base on the body's near edge
        ctx.beginPath()
        ctx.moveTo(p.x, y)
        if (anchor.dx === 0) {
          ctx.lineTo(p.x - pv, y + anchor.dy * pv)
          ctx.lineTo(p.x + pv, y + anchor.dy * pv)
        } else if (anchor.dy === 0) {
          ctx.lineTo(p.x + anchor.dx * ph, y - ph)
          ctx.lineTo(p.x + anchor.dx * ph, y + ph)
        } else {
          // ⚠️ a diagonal pointer is not measured: the two lengths, as for the straight ones
          ctx.lineTo(p.x + anchor.dx * ph * 2, y + anchor.dy * pv)
          ctx.lineTo(p.x + anchor.dx * ph, y + anchor.dy * pv * 2)
        }
        ctx.closePath()
        ctx.fill()
      }
    }
    if (text) {
      ctx.fillStyle = lb.textcolor || '#FFFFFF'
      const inset = g.padW / 2
      const tx = ctx.textAlign === 'left' ? bx + inset : ctx.textAlign === 'right' ? bx + w - inset : bx + w / 2
      const lineTop = (i) => by + h / 2 + g.centredTop + (i - (n - 1) / 2) * g.pitch
      lines.forEach((t, i) => { if (t) ctx.fillText(t, tx, lineTop(i)) })
    }
    ctx.restore()
    seen(bx, by); seen(bx + w, by + h)
    if (text) overflowsAt(p.x, bx + w)
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
    // ⛔ only when a label overflows: the painter's report is pinned by golden (labelSingleLine.golden.json)
    ...(labelOverflowRight > 0 ? { labelOverflowRight: Math.ceil(labelOverflowRight) } : {}),
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
