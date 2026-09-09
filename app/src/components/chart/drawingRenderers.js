/* Canvas painters for the drawing layer.
 *
 * ⛔ MOVED VERBATIM FROM `ChartDrawingOverlay.jsx` (Phase 0). Not one drawing
 * order, dash reset, alpha, font string or `save()/restore()` pair was changed
 * on the way across. Canvas is a STATE MACHINE: a painter that sets
 * `globalAlpha` and does not put it back changes the drawing painted after it,
 * so "tidying" a stray assignment here is not a cleanup, it is a behaviour
 * change in a different tool. `drawingRenderers.test.js` records the exact call
 * sequence each painter emits and will fail if any of that drifts.
 *
 * ─── THE CONTRACT THESE PAINTERS ACTUALLY HAVE ──────────────────────────────
 *
 * ⚠️ IT IS NOT "LEAVE THE CONTEXT AS YOU FOUND IT", AND PRETENDING OTHERWISE
 * WOULD HAVE BROKEN THINGS. The caller (`redraw`) wraps EVERY drawing in its own
 * `ctx.save()` / `ctx.restore()` and re-establishes `strokeStyle`, `lineWidth`
 * and `setLineDash` before each one. That outer pair is what actually contains
 * the leaks, and several painters lean on it:
 *
 *   • `renderFib` / `renderFibExtension` overwrite `strokeStyle` and `fillStyle`
 *     per level and never put them back (they do reset the dash).
 *   • `renderPitchfork` sets `globalAlpha = 0.4` for its handle bar and then
 *     writes `globalAlpha = 1` — NOT the layer alpha it found. Under Model
 *     Book's focus-zoom fade the layer alpha can be < 1, so the prong fill after
 *     it paints at full strength for the rest of that drawing. Pinned by test,
 *     NOT fixed here: it is a real (small) bug and it belongs to a phase that
 *     can look at it on a real chart.
 *   • `renderMeasure` sets `textAlign` and restores it to `'start'` rather than
 *     saving the previous value — harmless only because the caller sets what it
 *     needs.
 *
 * So the honest contract is: **a painter may mutate ctx freely; the caller owns
 * the save/restore boundary.** Phase 0 writes that down and tests it. Tightening
 * it to per-painter save/restore is a real improvement and a real risk, and it
 * is Phase 1's to make deliberately — with these tests already in place to say
 * what changed.
 */
import { isCoarsePointer, hitThreshold, handleRadius } from './coarsePointer'
import { UCT_DRAW_GOLD } from './drawingColors'
import { boundsOf, cupControlPoint, extendRay, extendToEdges } from './drawingGeometry'

const HIT_THRESHOLD = () => hitThreshold()
const HANDLE_R = () => handleRadius()

export const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1]
export const FIB_COLORS = ['#ef4444', '#fb923c', '#c9a84c', '#a8a290', '#4ade80', '#60a5fa', '#a78bfa']

export const FIB_EXT_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.272, 1.618, 2, 2.618]
export const FIB_EXT_COLORS = ['#ef4444', '#fb923c', '#c9a84c', '#a8a290', '#4ade80', '#60a5fa', '#a78bfa', '#e879f9', '#f472b6', '#22d3ee', '#818cf8']

export function drawArrowhead(ctx, from, to, size = 8) {
  const angle = Math.atan2(to.y - from.y, to.x - from.x)
  ctx.beginPath()
  ctx.moveTo(to.x, to.y)
  ctx.lineTo(to.x - size * Math.cos(angle - 0.4), to.y - size * Math.sin(angle - 0.4))
  ctx.lineTo(to.x - size * Math.cos(angle + 0.4), to.y - size * Math.sin(angle + 0.4))
  ctx.closePath()
  ctx.fill()
}

// ─── Lines ───────────────────────────────────────────────────────────────────

export function renderTrendline(ctx, pts) {
  if (pts.length < 2) return
  ctx.beginPath()
  ctx.moveTo(pts[0].x, pts[0].y)
  ctx.lineTo(pts[1].x, pts[1].y)
  ctx.stroke()
}

export function renderRay(ctx, pts, w, h) {
  if (pts.length < 2) return
  const [a, b] = extendRay(pts[0], pts[1], w, h)
  ctx.beginPath()
  ctx.moveTo(a.x, a.y)
  ctx.lineTo(b.x, b.y)
  ctx.stroke()
}

export function renderExtended(ctx, pts, w, h) {
  if (pts.length < 2) return
  const [a, b] = extendToEdges(pts[0], pts[1], w, h)
  ctx.beginPath()
  ctx.moveTo(a.x, a.y)
  ctx.lineTo(b.x, b.y)
  ctx.stroke()
}

/** ⚠️ `showLabel` IS EFFECTIVELY DEAD TODAY AND THE LABEL IS INVISIBLE.
 *  The label is written at `w − textWidth − 4`, but `redraw()` clips to
 *  `plotRight = w − axisWidth − 1`. A ~30px label inside a ~56px price axis is
 *  entirely inside the clipped-away strip, on every chart that has an axis.
 *  That is why the Horizontal Line has never appeared to have a price label.
 *  Phase 4 re-anchors it to `plotRight`; Phase 0 leaves it exactly where it is. */
export function renderHorizontal(ctx, pts, w, showLabel = true) {
  if (!pts.length) return
  ctx.beginPath()
  ctx.moveTo(0, pts[0].y)
  ctx.lineTo(w, pts[0].y)
  ctx.stroke()
  // Price label
  if (showLabel && pts[0].price != null) {
    const label = pts[0].price.toFixed(2)
    ctx.font = '10px "Instrument Sans", sans-serif'
    ctx.fillStyle = ctx.strokeStyle
    ctx.fillText(label, w - ctx.measureText(label).width - 4, pts[0].y - 4)
  }
}

/** ⚠️ THE CALLER PASSES `showLabel: false`, ALWAYS. This body already does what
 *  Phase 4's "Horizontal Ray → show price label" asks for — above the anchor, in
 *  the ray's own colour — and the overlay hard-codes `false` at the call site.
 *  Phase 4 replaces that literal with the drawing's own toggle. */
export function renderHRay(ctx, pts, w, showLabel = true) {
  if (!pts.length) return
  const x = pts[0].x ?? 0
  ctx.beginPath()
  ctx.moveTo(x, pts[0].y)
  ctx.lineTo(w, pts[0].y)
  ctx.stroke()
  // Price label — placed just ABOVE the ray's anchor (the setup bar/start of
  // the ray), not at the right price scale, so it sits over the candle it marks.
  if (showLabel && pts[0].price != null) {
    const label = pts[0].price.toFixed(2)
    ctx.font = '10px "Instrument Sans", sans-serif'
    ctx.fillStyle = ctx.strokeStyle
    ctx.textBaseline = 'bottom'
    ctx.fillText(label, x, pts[0].y - 5)
    ctx.textBaseline = 'alphabetic'
  }
}

export function renderVertical(ctx, pts, h) {
  if (!pts.length) return
  ctx.beginPath()
  ctx.moveTo(pts[0].x, 0)
  ctx.lineTo(pts[0].x, h)
  ctx.stroke()
}

// ─── Shapes ──────────────────────────────────────────────────────────────────

export function renderRect(ctx, pts) {
  if (pts.length < 2) return
  const { x1: x, y1: y, w, h } = boundsOf(pts)
  // ⚰️ DEAD LINE, KEPT ON PURPOSE (Phase 0 is behaviour-neutral). This builds a
  // nonsense colour string by chained .replace() and assigns it; canvas ignores
  // an unparseable fillStyle, and four lines below fillStyle is set again before
  // anything is filled. It has never had an effect. Phase 4 (Rectangle
  // border/fill split) deletes it — as a change with a test in front of it.
  ctx.fillStyle = ctx.strokeStyle.replace(')', ', 0.08)').replace('rgb', 'rgba').replace('#', '')
  // Parse hex to rgba fill
  const sc = ctx.strokeStyle
  ctx.save()
  ctx.globalAlpha = 0.08
  ctx.fillStyle = sc
  ctx.fillRect(x, y, w, h)
  ctx.restore()
  ctx.strokeRect(x, y, w, h)
}

export function renderCircle(ctx, pts) {
  if (pts.length < 2) return
  const cx = (pts[0].x + pts[1].x) / 2
  const cy = (pts[0].y + pts[1].y) / 2
  const rx = Math.abs(pts[1].x - pts[0].x) / 2
  const ry = Math.abs(pts[1].y - pts[0].y) / 2
  ctx.beginPath()
  ctx.ellipse(cx, cy, Math.max(rx, 1), Math.max(ry, 1), 0, 0, Math.PI * 2)
  ctx.save()
  ctx.globalAlpha = 0.08
  ctx.fillStyle = ctx.strokeStyle
  ctx.fill()
  ctx.restore()
  ctx.stroke()
}

/** ⚠️ THE ARROWHEAD SIZE IS THE LITERAL `10`, independent of `lineWidth`.
 *  That independence is what Phase 4's "Arrow size" asks for — the control is
 *  missing, not the separation. */
export function renderArrow(ctx, pts) {
  if (pts.length < 2) return
  ctx.beginPath()
  ctx.moveTo(pts[0].x, pts[0].y)
  ctx.lineTo(pts[1].x, pts[1].y)
  ctx.stroke()
  ctx.fillStyle = ctx.strokeStyle
  drawArrowhead(ctx, pts[0], pts[1], 10)
}

// Cup curve (for cup & handle patterns): a smooth arc through three anchors —
// left rim, bottom, right rim (clicked in that order). Two placed points
// (mid-draw) fall back to a straight guide line.
export function renderCup(ctx, pts) {
  if (pts.length < 2) return
  const L = pts[0]
  const R = pts[pts.length - 1]
  if (pts.length < 3) {
    ctx.beginPath()
    ctx.moveTo(L.x, L.y)
    ctx.lineTo(R.x, R.y)
    ctx.stroke()
    return
  }
  const c = cupControlPoint(L, pts[1], R)
  ctx.beginPath()
  ctx.moveTo(L.x, L.y)
  ctx.quadraticCurveTo(c.x, c.y, R.x, R.y)
  ctx.stroke()
}

// ─── Text ────────────────────────────────────────────────────────────────────

// Wrap `text` to `maxWidth` (canvas px) using `ctx`'s current font — honoring
// explicit newlines AND soft-wrapping long lines the way the edit textarea does
// (word wrap, with a character-level break for a single token wider than the box,
// e.g. a pasted no-space string). `maxWidth` falsy → split on \n only (legacy notes
// with no stored box width keep their old single-line-per-\n rendering).
export function wrapTextLines(ctx, text, maxWidth) {
  const out = []
  for (const para of String(text ?? '').split('\n')) {
    if (!maxWidth || maxWidth <= 0) { out.push(para); continue }
    let cur = ''
    for (let token of para.split(/(\s+)/)) {   // keep whitespace tokens so words rejoin
      if (token === '') continue
      while (token.length) {
        const test = cur + token
        if (ctx.measureText(test).width <= maxWidth) { cur = test; token = ''; break }
        if (cur.trim()) { out.push(cur.replace(/\s+$/, '')); cur = ''; continue }  // flush, retry on new line
        // cur empty and this single token is wider than the box → break it by chars.
        let i = 1
        while (i < token.length && ctx.measureText(token.slice(0, i + 1)).width <= maxWidth) i++
        out.push(token.slice(0, i))
        token = token.slice(i)
      }
    }
    out.push(cur.replace(/\s+$/, ''))
  }
  return out
}

/** ⚠️ THE FIRST BASELINE IS ONE FULL LINE-HEIGHT BELOW THE ANCHOR
 *  (`+ (i + 1) * fs * 1.4`), while the edit textarea puts its first line ~6px
 *  below the same anchor. That ~10px disagreement is one of the three causes of
 *  the "text note moves after I place it" report. Phase 6 makes both sides
 *  render from one origin; Phase 0 changes neither. */
export function renderText(ctx, pts, drawing, opacity = 1) {
  if (!pts.length || !drawing.text || opacity <= 0.02) return
  const fs = drawing.fontSize || 13   // rendered at its true size; visibility fades with zoom
  const prevAlpha = ctx.globalAlpha
  ctx.globalAlpha = prevAlpha * opacity
  ctx.font = `${fs}px "Instrument Sans", sans-serif`
  ctx.fillStyle = ctx.strokeStyle
  // Wrap to the width the box was resized to, so the on-chart text reads EXACTLY
  // like it did in the edit box (matches lineHeight 1.4 too).
  const lines = wrapTextLines(ctx, drawing.text, drawing.boxWidth)
  lines.forEach((line, i) => {
    ctx.fillText(line, pts[0].x, pts[0].y + (i + 1) * fs * 1.4)
  })
  ctx.globalAlpha = prevAlpha
}

// User-placed "+X%" advance label (manual version of the auto setup-advance label).
// % = directional move between the 1st and 2nd clicked candles (computeAdvancePct).
export function renderAdvance(ctx, pts, drawing, toPixelY, offset = 16, canvasW = null, autoInk = '#ffffff') {
  if (!pts.length || drawing.advPct == null) return
  const p = pts[pts.length - 1]   // the "to" candle
  if (p.x == null) return
  // If the anchor candle is itself scrolled OUTSIDE the plot area (e.g. a setup
  // months to the right while zoomed in on a different setup), don't render —
  // otherwise the on-canvas clamp below would pin the label to the screen edge
  // instead of letting it scroll away with its candle. Only labels whose anchor
  // is on-screen (but whose centered text overflows the edge) get nudged inward.
  if (canvasW != null && (p.x < -1 || p.x > canvasW + 1)) return
  // Advance → label ABOVE the candle's HIGH; decline → BELOW its LOW, so a drop
  // reads "-24%" tucked under the trough. Anchoring a decline to the LOW (not the
  // high) gives it the SAME clearance from the candle as an advance gets above the
  // high — otherwise "below the high" lands on the candle body, looking closer.
  const isDecline = drawing.advPct < 0
  const anchorPrice = (isDecline && drawing.advLow != null) ? drawing.advLow : drawing.advHigh
  const anchorY = anchorPrice != null ? toPixelY(null, anchorPrice) : null
  const baseY = anchorY != null ? anchorY : p.y
  const y = isDecline ? baseY + offset : baseY - offset
  ctx.save()
  // Match the swing price labels exactly (swingLabelsPrimitive): 600 11px
  // Instrument Sans, no outline/shadow — just a clean fill.
  ctx.font = '600 11px "Instrument Sans", sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = isDecline ? 'top' : 'bottom'
  // Thousands separator for big moves: +1,156% (toLocaleString carries the sign).
  const n = Math.round(drawing.advPct)
  const text = `${n >= 0 ? '+' : ''}${n.toLocaleString('en-US')}%`
  // Keep the (center-aligned) label fully on-canvas: if a label on one of the
  // last candles would overflow the right edge (the plot area, price-axis
  // excluded) or the left, shift it inward so it's never clipped.
  let px = Math.round(p.x)
  if (canvasW) {
    const half = ctx.measureText(text).width / 2 + 3
    px = Math.max(half, Math.min(px, canvasW - half))
  }
  const py = Math.round(y)
  // Color: a user-chosen color (right-click → Color) wins; otherwise auto-ink
  // (black on a light canvas, white on a dark one). No stroke/shadow.
  ctx.fillStyle = drawing.labelColor || autoInk
  ctx.fillText(text, px, py)
  ctx.restore()
}

// ─── Fibonacci ───────────────────────────────────────────────────────────────

/** ⚠️ LEVELS AND COLOURS ARE MODULE CONSTANTS, and `d.color` is ignored entirely
 *  (every level overwrites `strokeStyle`). Phase 7 moves the ladder onto the
 *  drawing, defaulted from exactly these arrays so an existing Fib renders
 *  identically until somebody edits it. */
export function renderFib(ctx, pts, w, toPixel) {
  if (pts.length < 2) return
  const highPrice = Math.max(pts[0].rawPrice, pts[1].rawPrice)
  const lowPrice = Math.min(pts[0].rawPrice, pts[1].rawPrice)
  const range = highPrice - lowPrice
  if (range <= 0) return

  ctx.font = '10px "Instrument Sans", sans-serif'
  FIB_LEVELS.forEach((level, i) => {
    const price = highPrice - range * level
    const y = toPixel(null, price)
    if (y == null) return
    ctx.strokeStyle = FIB_COLORS[i] || ctx.strokeStyle
    ctx.setLineDash(level === 0 || level === 1 ? [] : [4, 3])
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(w, y)
    ctx.stroke()
    // Label
    ctx.fillStyle = FIB_COLORS[i] || '#a8a290'
    const label = `${(level * 100).toFixed(1)}% — $${price.toFixed(2)}`
    ctx.fillText(label, 4, y - 3)
  })
  ctx.setLineDash([])
}

export function renderFibExtension(ctx, pts, w, toPixel) {
  if (pts.length < 2) return
  // P0 = swing start, P1 = swing end. Extensions project beyond P1 in P0→P1 direction.
  const p0Price = pts[0].rawPrice
  const p1Price = pts[1].rawPrice
  const range = p1Price - p0Price  // positive = upward swing
  if (range === 0) return

  ctx.font = '10px "Instrument Sans", sans-serif'
  FIB_EXT_LEVELS.forEach((level, i) => {
    // level=0 → p0Price, level=1 → p1Price, level>1 → extensions beyond p1
    const price = p0Price + range * level
    const y = toPixel(null, price)
    if (y == null) return
    ctx.strokeStyle = FIB_EXT_COLORS[i] || '#a8a290'
    ctx.setLineDash(level > 1 ? [6, 3] : level === 0 || level === 1 ? [] : [4, 3])
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(w, y)
    ctx.stroke()
    ctx.fillStyle = FIB_EXT_COLORS[i] || '#a8a290'
    const label = `${(level * 100).toFixed(1)}% — $${price.toFixed(2)}`
    ctx.fillText(label, 4, y - 3)
  })
  ctx.setLineDash([])
}

// ─── Multi-line tools ────────────────────────────────────────────────────────

/** ⚠️ TWO PHASE-2 BUGS LIVE IN HERE, both inherited from `extendToEdges`:
 *  the prongs can be drawn between two off-canvas points (so they visibly jump
 *  as the slope changes), and the prong FILL is a 4-gon built from clipped
 *  endpoints — which is not the shape of a band clipped to a rectangle whenever
 *  the two edges exit through different sides, so a corner goes unfilled.
 *  Also note `globalAlpha = 1` after the handle bar: that is a WRITE, not a
 *  restore, and it discards a Model Book layer fade for the rest of the drawing. */
export function renderPitchfork(ctx, pts, w, h) {
  if (pts.length < 3) return
  // P1 = pivot, P2 = left shoulder, P3 = right shoulder
  const [p1, p2, p3] = pts
  // Median line anchor = midpoint of P2–P3
  const mid = { x: (p2.x + p3.x) / 2, y: (p2.y + p3.y) / 2 }

  // Extend all three lines to canvas edges
  const [ma1, ma2] = extendToEdges(p1, mid, w, h)
  const [ua1, ua2] = extendToEdges(p2, { x: p2.x + (mid.x - p1.x), y: p2.y + (mid.y - p1.y) }, w, h)
  const [la1, la2] = extendToEdges(p3, { x: p3.x + (mid.x - p1.x), y: p3.y + (mid.y - p1.y) }, w, h)

  // Median line (solid)
  ctx.setLineDash([])
  ctx.beginPath()
  ctx.moveTo(ma1.x, ma1.y)
  ctx.lineTo(ma2.x, ma2.y)
  ctx.stroke()

  // Upper and lower prongs (dashed)
  ctx.setLineDash([5, 3])
  ctx.beginPath()
  ctx.moveTo(ua1.x, ua1.y)
  ctx.lineTo(ua2.x, ua2.y)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(la1.x, la1.y)
  ctx.lineTo(la2.x, la2.y)
  ctx.stroke()
  ctx.setLineDash([])

  // Handle bar connecting P2–P3
  ctx.globalAlpha = 0.4
  ctx.beginPath()
  ctx.moveTo(p2.x, p2.y)
  ctx.lineTo(p3.x, p3.y)
  ctx.stroke()
  ctx.globalAlpha = 1

  // Fill between upper and lower prongs
  ctx.save()
  ctx.globalAlpha = 0.04
  ctx.fillStyle = ctx.strokeStyle
  ctx.beginPath()
  ctx.moveTo(ua1.x, ua1.y)
  ctx.lineTo(ua2.x, ua2.y)
  ctx.lineTo(la2.x, la2.y)
  ctx.lineTo(la1.x, la1.y)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

/** ⚠️ THE FILL IS THE PHASE-2 BUG. `[a1, b1, b2, a2]` assumes the two clipped
 *  lines come back in a matching direction. `extendToEdges` gives no such
 *  guarantee — it returns whichever two of four candidate crossings happened to
 *  pass first — so the quad can self-intersect into a bow-tie and the nonzero
 *  winding fill cancels part of itself. That is the "part of the tint
 *  disappears" report, and it is a geometry bug, not a repaint bug. */
export function renderChannel(ctx, pts, w, h) {
  if (pts.length < 2) return
  // First line: p1 to p2
  const [a1, b1] = extendToEdges(pts[0], pts[1], w, h)
  ctx.beginPath()
  ctx.moveTo(a1.x, a1.y)
  ctx.lineTo(b1.x, b1.y)
  ctx.stroke()
  // Second line: parallel through p3
  if (pts.length >= 3) {
    const dx = pts[1].x - pts[0].x, dy = pts[1].y - pts[0].y
    const p3a = { x: pts[2].x, y: pts[2].y }
    const p3b = { x: pts[2].x + dx, y: pts[2].y + dy }
    const [a2, b2] = extendToEdges(p3a, p3b, w, h)
    ctx.setLineDash([4, 3])
    ctx.beginPath()
    ctx.moveTo(a2.x, a2.y)
    ctx.lineTo(b2.x, b2.y)
    ctx.stroke()
    ctx.setLineDash([])
    // Fill between
    ctx.save()
    ctx.globalAlpha = 0.04
    ctx.fillStyle = ctx.strokeStyle
    ctx.beginPath()
    ctx.moveTo(a1.x, a1.y)
    ctx.lineTo(b1.x, b1.y)
    ctx.lineTo(b2.x, b2.y)
    ctx.lineTo(a2.x, a2.y)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  }
}

// ─── Measurement ─────────────────────────────────────────────────────────────

/** ⚠️ `drawing.barCount` IS READ, NEVER RECOMPUTED. It is stamped once at
 *  creation and the drag path writes only `{points}`, so resizing a Measure
 *  leaves a stale count and changing timeframe leaves one that was never right
 *  for the new bars. Phase 5 derives it here instead. */
export function renderMeasure(ctx, pts, drawing, pctOnly = false) {
  if (pts.length < 2) return
  const { x1, y1, x2, y2 } = boundsOf(pts)
  // Dashed rect
  ctx.setLineDash([3, 3])
  ctx.strokeRect(x1, y1, x2 - x1, y2 - y1)
  ctx.setLineDash([])
  // Fill
  ctx.save()
  ctx.globalAlpha = 0.06
  ctx.fillStyle = ctx.strokeStyle
  ctx.fillRect(x1, y1, x2 - x1, y2 - y1)
  ctx.restore()
  // Labels
  const p1Price = pts[0].rawPrice, p2Price = pts[1].rawPrice
  if (p1Price != null && p2Price != null) {
    const diff = p2Price - p1Price
    const pct = ((diff / p1Price) * 100).toFixed(2)
    const bars = drawing.barCount || ''
    const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2
    const type = drawing.type
    ctx.font = 'bold 11px "Instrument Sans", sans-serif'
    ctx.textAlign = 'center'
    // Legibility chip: the measure color is tuned bright for the dark canvas and
    // washes out as plain text on a LIGHT canvas (the readability complaint).
    // Back each line with the same neutral dark chip the crosshair legend uses —
    // it disappears into a dark canvas (so that look is unchanged) but gives the
    // colored text solid contrast on a light one.
    const labelColor = ctx.strokeStyle
    const putLabel = (t, x, y) => {
      if (!t) return
      const tw = ctx.measureText(t).width
      const padX = 5
      ctx.fillStyle = 'rgba(20, 22, 18, 0.82)'
      ctx.beginPath()
      ctx.roundRect(x - tw / 2 - padX, y - 11, tw + padX * 2, 15, 3)
      ctx.fill()
      ctx.fillStyle = labelColor
      ctx.fillText(t, x, y)
    }
    if (pctOnly) {
      // Just the % move — for marking the size of an index correction.
      putLabel(`${diff >= 0 ? '+' : ''}${pct}%`, cx, cy + 4)
    } else if (type === 'priceRange') {
      // Price delta only: $ move + %.
      putLabel(`${diff >= 0 ? '+' : ''}${diff.toFixed(2)} (${diff >= 0 ? '+' : ''}${pct}%)`, cx, cy + 4)
    } else if (type === 'dateRange') {
      // Horizontal span only: bar count.
      putLabel(bars ? `${bars} bars` : '', cx, cy + 4)
    } else {
      const line1 = `${diff >= 0 ? '+' : ''}${diff.toFixed(2)} (${diff >= 0 ? '+' : ''}${pct}%)`
      const line2 = bars ? `${bars} bars` : ''
      putLabel(line1, cx, cy - 4)
      putLabel(line2, cx, cy + 12)
    }
    ctx.textAlign = 'start'
  }
}

/** Long/short position (risk-reward): 3 points — entry, stop, target.
 *  ⚠️ RETIRED IN PHASE 9, BUT THIS PAINTER STAYS. The tool goes; the reader
 *  does not, so a chart (or a Model Book example) that already carries a
 *  Position drawing keeps rendering it, keeps naming it in the Objects manager,
 *  and keeps letting the owner delete it. Deleting this function is how you turn
 *  "we retired a tool" into "we silently erased somebody's chart". */
export function renderPosition(ctx, pts) {
  if (pts.length < 3) return
  const [entry, stop, target] = pts
  const xs = pts.map(p => p.x)
  const xL = Math.min(...xs), xR = Math.max(...xs)
  const wBox = Math.max(40, xR - xL)
  ctx.save()
  ctx.globalAlpha = 0.10
  ctx.fillStyle = '#ef4444'
  ctx.fillRect(xL, Math.min(entry.y, stop.y), wBox, Math.abs(stop.y - entry.y))
  ctx.fillStyle = '#22c55e'
  ctx.fillRect(xL, Math.min(entry.y, target.y), wBox, Math.abs(target.y - entry.y))
  ctx.restore()
  const line = (y, color) => {
    ctx.strokeStyle = color; ctx.lineWidth = 1.5
    ctx.beginPath(); ctx.moveTo(xL, y); ctx.lineTo(xL + wBox, y); ctx.stroke()
  }
  line(entry.y, UCT_DRAW_GOLD); line(stop.y, '#ef4444'); line(target.y, '#22c55e')
  const e = entry.rawPrice, s = stop.rawPrice, t = target.rawPrice
  if (e != null && s != null && t != null) {
    const risk = Math.abs(e - s), reward = Math.abs(t - e)
    const rr = risk > 0 ? (reward / risk).toFixed(2) : '∞'
    ctx.font = 'bold 11px "Instrument Sans", sans-serif'
    ctx.fillStyle = '#e8e6e0'
    ctx.textAlign = 'left'
    ctx.fillText(`R:R ${rr} · risk ${risk.toFixed(2)} · reward ${reward.toFixed(2)}`, xL + 6, Math.min(entry.y, stop.y, target.y) - 6)
    ctx.textAlign = 'start'
  }
}

export function renderAnchoredVwap(ctx, anchorPt, bars, timeToIndex, toPixelFn) {
  if (!anchorPt || anchorPt.time == null) return
  const anchorIdx = timeToIndex.get(anchorPt.time)
  if (anchorIdx == null || !bars?.length) return

  // Compute full VWAP series from anchor forward (regardless of visibility)
  let cumPV = 0, cumV = 0
  const vwapSeries = [] // { time, vwap } for every bar from anchor onward

  for (let i = anchorIdx; i < bars.length; i++) {
    const b = bars[i]
    const tp = (b.h + b.l + b.c) / 3
    const vol = b.v || 0
    cumPV += tp * vol
    cumV += vol
    if (cumV === 0) continue
    vwapSeries.push({ time: b.t, vwap: cumPV / cumV })
  }

  if (vwapSeries.length < 1) return

  // Convert to pixels — include all points (even off-screen) so the line
  // clips naturally at canvas edges instead of disappearing
  const points = []
  for (const v of vwapSeries) {
    const px = toPixelFn(v.time, v.vwap)
    // Allow off-screen x (null) — interpolate from neighbors later
    // But y must exist (price axis doesn't scroll)
    if (px?.y != null) {
      points.push({ x: px.x, y: px.y, vwap: v.vwap })
    }
  }

  // Filter to points with valid x for drawing
  const drawable = points.filter(p => p.x != null)
  if (drawable.length < 1) return

  // Draw VWAP line
  ctx.beginPath()
  ctx.moveTo(drawable[0].x, drawable[0].y)
  for (let i = 1; i < drawable.length; i++) {
    ctx.lineTo(drawable[i].x, drawable[i].y)
  }
  ctx.stroke()

  // Price label at rightmost visible point
  const last = drawable[drawable.length - 1]
  const lastVwap = cumV > 0 ? cumPV / cumV : 0
  ctx.font = '10px "Instrument Sans", sans-serif'
  ctx.fillStyle = ctx.strokeStyle
  ctx.fillText(`VWAP ${lastVwap.toFixed(2)}`, last.x + 6, last.y - 4)

  // Anchor dot — place on the VWAP line at anchor bar (not at user click price)
  const anchorVwap = vwapSeries[0]
  if (anchorVwap) {
    const anchorPx = toPixelFn(anchorVwap.time, anchorVwap.vwap)
    if (anchorPx?.x != null && anchorPx?.y != null) {
      ctx.beginPath()
      ctx.arc(anchorPx.x, anchorPx.y, 4, 0, Math.PI * 2)
      ctx.fillStyle = ctx.strokeStyle
      ctx.fill()

      // "A" label at anchor
      ctx.font = 'bold 9px "Instrument Sans", sans-serif'
      ctx.fillText('A', anchorPx.x - 3, anchorPx.y - 8)
    }
  }
}

// ─── Chrome ──────────────────────────────────────────────────────────────────

/** ⚠️ THE FILL IS UNCONDITIONALLY GOLD, FOR EVERY TOOL. This painter takes only
 *  points — it has no access to the drawing — which is exactly why a green trend
 *  line gets gold handles. Phase 1 passes the drawing in and fills with the
 *  drawing's own (brightened) colour. The dark ring stays: it is what keeps a
 *  handle visible on top of its own line whatever colour that line is. */
export function renderSelectionHandles(ctx, pts) {
  // Pure canvas painter — no hook available here, so it asks the store directly.
  // That is precisely why coarsePointer.js exposes a synchronous read as well as
  // a hook: one fact, two doors, and they cannot disagree.
  const coarse = isCoarsePointer()
  for (const p of pts) {
    if (coarse) {
      // Halo = the actual grab zone (HIT_THRESHOLD + the handle slack), so a
      // finger sees exactly how close is close enough.
      ctx.beginPath()
      ctx.arc(p.x, p.y, HIT_THRESHOLD() + 2, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(201, 168, 76, 0.16)'
      ctx.fill()
    }
    ctx.beginPath()
    ctx.arc(p.x, p.y, HANDLE_R(), 0, Math.PI * 2)
    ctx.fillStyle = UCT_DRAW_GOLD
    ctx.fill()
    ctx.strokeStyle = '#1a1c17'
    ctx.lineWidth = 1
    ctx.stroke()
  }
}

export function renderCrosshair(ctx, x, y, price, w, h) {
  ctx.save()
  ctx.strokeStyle = 'rgba(168, 162, 144, 0.35)'
  ctx.lineWidth = 0.5
  ctx.setLineDash([3, 3])
  ctx.beginPath()
  ctx.moveTo(x, 0); ctx.lineTo(x, h)
  ctx.moveTo(0, y); ctx.lineTo(w, y)
  ctx.stroke()
  ctx.setLineDash([])
  // No floating "$price" label at the cursor while a tool is armed — it read as
  // clutter next to the crosshair; the price scale's own crosshair label already
  // shows it. (`price` kept in the signature for the existing call site.)
  ctx.restore()
}
