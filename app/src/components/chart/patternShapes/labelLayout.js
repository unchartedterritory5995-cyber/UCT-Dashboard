// app/src/components/chart/patternShapes/labelLayout.js — where the overlay's TEXT goes. Labels only.
//
// Two defects this exists for (WDAY daily, 2026-10-23): the base metrics / textbook block was drawn
// right-aligned to the pivot line's extended tip, i.e. at the right price edge beside the latest candles,
// and its second line printed straight over the learned drawer's level labels ("learned swing H 207.67",
// "learned gap 197.13"), so neither could be read.
//
//   1. placeMetricsBlock: the block sits at the TOP-LEFT of the base's own span, either just above the box
//      top or just inside it, whichever covers fewer candle pixels (ties: above). Kept inside the pane.
//   2. stackLabels: right-edge pattern labels whose boxes overlap are pushed apart vertically.
//   3. droppedLearnedLabels: a learned label that would touch the metrics block or a pattern label loses
//      its TEXT (its line still draws). Pattern and metrics text always win over learned text.
//
// Nothing here moves a line, a box or a number: every function returns text positions or offsets only.
// Pure; no React. Text extents are estimated (no layout engine in jsdom, and no getBBox per frame).

export const CHAR_W = 6          // ~0.6em at fontSize 10
export const LINE_H = 12         // the metrics block's line pitch (tspan dy)
export const ASCENT = 8          // baseline to top of a 10px glyph (cap height ~7)
export const DESCENT = 3
const GAP = 4                    // block to box-top clearance (keeps the old pivot - 18 baseline for 2 lines)
const EDGE = 2                   // minimum distance from the pane edge

/** The estimated box of one line of text whose baseline is at `y`. */
export function textBox(x, y, text, anchor = 'start') {
  const w = String(text || '').length * CHAR_W
  const x0 = anchor === 'end' ? x - w : x
  return { x0, x1: x0 + w, y0: y - ASCENT, y1: y + DESCENT }
}

export function boxesOverlap(a, b) {
  return !!a && !!b && a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1
}

export function overlapArea(a, b) {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0)
  return w > 0 && h > 0 ? w * h : 0
}

/**
 * Where the metrics block goes.
 * @param {object} p
 * @param {string[]} p.lines         the block's lines (2 or 3)
 * @param {{xL:number, yTop:number, yBottom:?number}} p.box  the base's left edge, top (pivot) and floor in px
 * @param {{w:number, h:number}} [p.pane]  the chart pane; 0/absent = no clamping on that axis
 * @param {Array<{x:number, yHigh:number, yLow:number}>} [p.candles]  candle extents in px
 * @param {number} [p.halfW]         half a candle's width in px
 * @param {Array<object>} [p.obstacles]  pattern label boxes the block should avoid
 * @returns {{x:number, y:number, side:'above'|'inside', rect:object}}  x = left edge (text-anchor start),
 *   y = the FIRST line's baseline, rect = the block's estimated box
 */
export function placeMetricsBlock({ lines, box, pane = null, candles = null, halfW = 4, obstacles = null }) {
  const n = lines.length
  const w = Math.max(...lines.map((s) => String(s).length)) * CHAR_W
  const h = n * LINE_H
  const pw = pane && pane.w > 0 ? pane.w : 0
  const ph = pane && pane.h > 0 ? pane.h : 0
  const clampX = (x) => (pw ? Math.max(EDGE, Math.min(x, pw - w - EDGE)) : x)
  // the TOP edge is clamped (a base whose top is above the pane still gets a readable block inside it);
  // the bottom is not: a base drawn below the pane has nothing on screen for a block to describe
  const clampTop = (t) => (ph || pw ? Math.max(EDGE, t) : t)
  const left = clampX(box.xL + EDGE)
  const cands = [{ side: 'above', top: box.yTop - GAP - h }]
  const roomInside = box.yBottom == null || Math.abs(box.yBottom - box.yTop) >= h + 2 * GAP
  if (roomInside) cands.push({ side: 'inside', top: box.yTop + GAP })

  let best = null
  for (const c of cands) {
    const top = clampTop(c.top)
    const rect = { x0: left, x1: left + w, y0: top, y1: top + h }
    let score = 0
    for (const k of candles || []) {
      score += overlapArea(rect, { x0: k.x - halfW, x1: k.x + halfW, y0: k.yHigh, y1: k.yLow })
    }
    // another label is worth more than any candle: never trade a readable label for a clear candle
    for (const o of obstacles || []) score += overlapArea(rect, o) * 1000
    if (!best || score < best.score) best = { side: c.side, top, rect, score }
  }
  // the first line's baseline: an `above` block on an unclamped 2-line base reads pivot - 18, as before
  return { x: left, y: best.top + LINE_H - DESCENT + 1, side: best.side, rect: best.rect }
}

/**
 * Vertical offsets that pull overlapping right-edge labels apart. Labels are taken top-down (then by input
 * order); each one that overlaps an already-placed label is moved down just below it. Labels that do not
 * collide keep offset 0.
 * @param {Array<{id:string, box:object}>} items
 * @returns {Object<string, number>}  id -> dy (only for moved labels)
 */
export function stackLabels(items) {
  const order = items
    .map((it, i) => ({ ...it, i }))
    .filter((it) => it.box)
    .sort((a, b) => a.box.y0 - b.box.y0 || a.i - b.i)
  const placed = []
  const dy = {}
  for (const it of order) {
    let off = 0
    for (let guard = 0; guard < order.length + 1; guard++) {
      const b = { ...it.box, y0: it.box.y0 + off, y1: it.box.y1 + off }
      const hit = placed.find((p) => boxesOverlap(b, p))
      if (!hit) break
      off = hit.y1 + 1 - it.box.y0
    }
    if (off) dy[it.id] = off
    placed.push({ ...it.box, y0: it.box.y0 + off, y1: it.box.y1 + off })
  }
  return dy
}

/**
 * Vertical offsets that move each of `items` clear of the FIXED boxes and of each other (top-down; a label that
 * collides moves down just below what it hit). The fixed boxes never move -- this is how a lower-priority layer's
 * labels (textbook support / resistance) yield to pattern and metrics text instead of pushing it.
 * @param {Array<{id:string, box:object}>} items
 * @param {Array<object>} fixed
 * @returns {Object<string, number>}  id -> dy (only for moved labels)
 */
export function stackLabelsAround(items, fixed) {
  const order = items
    .map((it, i) => ({ ...it, i }))
    .filter((it) => it.box)
    .sort((a, b) => a.box.y0 - b.box.y0 || a.i - b.i)
  const placed = (fixed || []).filter(Boolean).slice()
  const dy = {}
  for (const it of order) {
    let off = 0
    for (let guard = 0; guard < placed.length + 2; guard++) {
      const b = { ...it.box, y0: it.box.y0 + off, y1: it.box.y1 + off }
      const hit = placed.find((p) => boxesOverlap(b, p))
      if (!hit) break
      off = hit.y1 + 1 - it.box.y0
    }
    if (off) dy[it.id] = off
    placed.push({ ...it.box, y0: it.box.y0 + off, y1: it.box.y1 + off })
  }
  return dy
}

/**
 * Which learned labels lose their text: any whose box touches a winner (the metrics block or a pattern
 * label). Their lines are untouched; only the text is dropped.
 * @param {Array<{key:string, box:object}>} learned
 * @param {Array<object>} winners
 * @returns {Set<string>}
 */
export function droppedLearnedLabels(learned, winners) {
  const out = new Set()
  for (const l of learned || []) {
    if ((winners || []).some((w) => boxesOverlap(l.box, w))) out.add(l.key)
  }
  return out
}

/**
 * Where a LevelSegment's label text goes, before any collision offset: 4px right of the line's end, on
 * the line. Null when the segment would not draw or has no label. The ONE authority for that position,
 * shared by the component and by PatternOverlay's label-collision pass. Pure — exported for tests.
 */
export function levelLabelPosition(detection, tToX, priceToY, extendRight = 0) {
  const anchors = detection?.geometry?.anchors || []
  if (!anchors.length) return null
  const y = priceToY(anchors[0].price)
  if (y == null) return null
  const xs = anchors.map((a) => tToX(a.t)).filter((v) => v != null)
  if (!xs.length) return null
  const x1 = Math.min(...xs)
  const x2 = Math.max(...xs) + extendRight
  if (x2 - x1 < 1) return null
  const label = detection?.geometry?.label || detection?.pattern_name || ''
  if (!label) return null
  return { x: x2 + 4, y: y + 3, label }
}
