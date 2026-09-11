/* Canvas painters for the drawing layer.
 *
 * Phase 0 moved these bodies out of `ChartDrawingOverlay.jsx` verbatim so they
 * could be executed by a test. Phase 1 changed exactly four things, each of them
 * an approved shared fix:
 *
 *   • every painter that extended a line now takes a PANE RECT instead of a bare
 *     `w, h`, and gets its geometry from the deterministic Liang–Barsky clip;
 *   • `renderPitchfork` / `renderChannel` build their band fills from UNCLIPPED,
 *     far-extended lines and let `ctx.clip()` trim them — a band clipped to a
 *     rect is not always a quadrilateral, which is why a corner used to go
 *     unfilled;
 *   • every painter checks `ok(pts, n)` rather than `pts.length`, because
 *     resolution is now index-stable and an unresolvable anchor is marked rather
 *     than dropped;
 *   • `renderSelectionHandles` takes the drawing's rendered ink.
 *
 * ─── THE CONTRACT THESE PAINTERS HAVE ───────────────────────────────────────
 *
 * ⚠️ IT IS NOT "LEAVE THE CONTEXT AS YOU FOUND IT". The caller (`redraw`) wraps
 * EVERY drawing in its own `ctx.save()` / `ctx.restore()` — now including the
 * pane clip — and re-establishes `strokeStyle`, `lineWidth` and the dash before
 * each one. That outer pair is what contains the leaks, and several painters
 * lean on it:
 *
 *   • `renderFib` / `renderFibExtension` overwrite `strokeStyle` and `fillStyle`
 *     per level and never put them back (they do reset the dash).
 *   • `renderPitchfork` sets `globalAlpha = 0.4` for its handle bar and then
 *     writes `globalAlpha = 1` — NOT the layer alpha it found. Under Model
 *     Book's focus-zoom fade that means the prong fill paints at full strength
 *     for the rest of THAT drawing. Still pinned by test rather than fixed:
 *     it is contained by the caller's restore, and changing it is a visible
 *     change to a surface Phase 1 was told not to touch.
 *   • `renderMeasure` restores `textAlign` to `'start'` rather than to whatever
 *     it found.
 *
 * So the contract is: **a painter may mutate ctx freely; the caller owns the
 * save/restore boundary.** `drawingRenderers.test.js` asserts that boundary
 * balances for all 20 painters — the invariant the share/screenshot capture
 * depends on, and the one the new per-drawing clip makes load-bearing.
 */
import { isCoarsePointer, hitThreshold, handleRadius, handleGrabRadius } from './coarsePointer'
import { UCT_DRAW_GOLD } from './drawingColors'
import {
  boundsOf, cupControlPoint, extendLineFar, extendRay, extendToEdges, pointsUsable,
} from './drawingGeometry'
import {
  READOUT_BG, drawLabel, drawLabelBlock, formatPercent, formatPrice, inkOn, labelBox,
} from './drawingLabels'
import { labelPosOf, resolveLabelY } from './drawingMeasure'
import { bgColorOf, fontStringFor, textBoxFor } from './drawingText'
import {
  FIB_LEVELS, FIB_COLORS, FIB_EXT_LEVELS, FIB_EXT_COLORS,
  fibLevelPrice, resolveBands, resolveLevels,
} from './drawingFib'
import { arrowSizeFor, borderFor, fillFor } from './drawingStyle'

/** Index-stable resolution keeps a slot for every stored anchor and marks the
 *  unresolvable ones. A painter must ask before it draws — the alternative is
 *  what used to happen: a null x numeric-coerced to 0 and the shape snapped to
 *  the left edge of the chart. */
const ok = pointsUsable

const HIT_THRESHOLD = () => hitThreshold()
const HANDLE_R = () => handleRadius()

// ⚰️ THE FOUR FIB TABLES MOVED TO `drawingFib.js` and are re-exported here.
// They are data, not painting, and Phase 7 gave three more callers a reason to
// read them — the settings editor, the hit test and the alert anchors. Every
// existing importer of `FIB_LEVELS`/`FIB_COLORS` from this module still works.
export { FIB_LEVELS, FIB_COLORS, FIB_EXT_LEVELS, FIB_EXT_COLORS }

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
  if (!ok(pts, 2)) return
  ctx.beginPath()
  ctx.moveTo(pts[0].x, pts[0].y)
  ctx.lineTo(pts[1].x, pts[1].y)
  ctx.stroke()
}

export function renderRay(ctx, pts, rect) {
  if (!ok(pts, 2)) return
  const seg = extendRay(pts[0], pts[1], rect)
  if (!seg) return              // wholly outside its pane — draw nothing
  ctx.beginPath()
  ctx.moveTo(seg[0].x, seg[0].y)
  ctx.lineTo(seg[1].x, seg[1].y)
  ctx.stroke()
}

export function renderExtended(ctx, pts, rect) {
  if (!ok(pts, 2)) return
  const seg = extendToEdges(pts[0], pts[1], rect)
  if (!seg) return
  ctx.beginPath()
  ctx.moveTo(seg[0].x, seg[0].y)
  ctx.lineTo(seg[1].x, seg[1].y)
  ctx.stroke()
}

/**
 * ⚰️ WHAT THIS LABEL USED TO BE. It was `price.toFixed(2)` in bare 10px text at
 * `canvasWidth − textWidth − 4` — inside the price-axis strip, which `redraw()`
 * clips away. So the Horizontal Line's price label existed in the source, cost a
 * `measureText` every frame, and had never been seen by a user on any chart with
 * a price axis. Phase 4 makes it real: a chip on the INSIDE edge of the plot, in
 * the line's own colour, behind a per-drawing toggle.
 *
 * ⭐ IT HUGS THE PRICE SCALE BECAUSE THAT IS THE QUESTION IT ANSWERS. "What price
 * is this line at?" is read against the axis, so the answer belongs at the axis —
 * one row of the scale, in the line's colour, so which line it belongs to needs
 * no thought. `rect.x1` IS the plot's right edge (the pane zone spans the plot
 * area), so the chip lands flush against the scale without knowing the axis width.
 *
 * @param {object} [o]           label options; omit for a bare line
 * @param {boolean} [o.showLabel]  false = line only (the shipped behaviour)
 * @param {string} [o.ink]       the chip fill — the drawing's RENDERED colour
 * @param {function} [o.fmt]     price → string; defaults to `formatPrice`
 * @param {Array} [o.avoid]      boxes already placed this frame (mutated)
 */
export function renderHorizontal(ctx, pts, rect, o = null) {
  // 'y' ONLY: a horizontal line is a price LEVEL stored as `{ price }` with no
  // `time`, so it has no x and the span comes from the pane rect. Requiring x
  // here made every horizontal line in the product stop rendering.
  if (!ok(pts, 1, 'y')) return
  ctx.beginPath()
  ctx.moveTo(rect.x0, pts[0].y)
  ctx.lineTo(rect.x1, pts[0].y)
  ctx.stroke()
  if (!o || !o.showLabel || pts[0].price == null) return
  const ink = o.ink || ctx.strokeStyle
  drawLabel(ctx, {
    text: (o.fmt || formatPrice)(pts[0].price),
    x: rect.x1 - 1, y: pts[0].y,
    align: 'right', baseline: 'middle',
    bg: ink, color: inkOn(ink),
    bounds: rect, avoid: o.avoid || null,
  })
}

/**
 * ⭐ THE RAY'S LABEL DELIBERATELY GOES SOMEWHERE ELSE THAN THE LINE'S. A
 * horizontal LINE spans the chart, so the only place its price means anything is
 * the axis. A horizontal RAY starts AT a bar — the setup candle, the breakout —
 * and the price it names belongs to that bar, so the label sits just above the
 * starting anchor and travels with it. Two tools, two questions, two placements;
 * the shipped code already made this call and Phase 4 keeps it.
 *
 * ⚰️ WHAT CHANGED IS EVERYTHING ELSE ABOUT IT: bare 10px text became the shared
 * chip, `toFixed(2)` became the series' own formatter, and `showLabel` — which
 * the overlay hard-coded to `false`, so this branch had never run — became the
 * drawing's own toggle.
 */
export function renderHRay(ctx, pts, w, o = null) {
  if (!ok(pts, 1)) return
  const x = pts[0].x
  ctx.beginPath()
  ctx.moveTo(x, pts[0].y)
  ctx.lineTo(w, pts[0].y)
  ctx.stroke()
  if (!o || !o.showLabel || pts[0].price == null) return
  const ink = o.ink || ctx.strokeStyle
  drawLabel(ctx, {
    text: (o.fmt || formatPrice)(pts[0].price),
    // Sits ON the ray's start: left edge at the anchor, bottom edge a hair above
    // the line, so the chip reads as a tag on that end rather than as free text.
    x, y: pts[0].y - 3,
    align: 'left', baseline: 'bottom',
    bg: ink, color: inkOn(ink),
    bounds: o.bounds || null, avoid: o.avoid || null,
  })
}

export function renderVertical(ctx, pts, rect) {
  if (!ok(pts, 1, 'x')) return          // a time marker needs no price
  ctx.beginPath()
  ctx.moveTo(pts[0].x, rect.y0)
  ctx.lineTo(pts[0].x, rect.y1)
  ctx.stroke()
}

// ─── Shapes ──────────────────────────────────────────────────────────────────

/**
 * ⚰️ THE DEAD `.replace()` CHAIN IS GONE. It built a nonsense colour string
 * (`'c9a84c, 0.08)'`) by chained replaces and assigned it to `fillStyle`; canvas
 * silently ignores an unparseable value and four lines later `fillStyle` was set
 * again before anything was filled. Phase 0 kept it because Phase 0 was
 * behaviour-neutral; the fill test in `drawingRenderers.test.js` is what let it
 * be deleted here.
 *
 * ⭐ BORDER AND FILL ARE NOW SEPARATE QUESTIONS. Border = the outline, and it is
 * still the drawing's own `color` (so every rectangle ever drawn is untouched,
 * and the width/style controls keep meaning what they meant). Fill = the inside
 * tint, its own colour with its own alpha. A rectangle that names no fill tints
 * itself with its border at the shipped 0.08 — which is exactly what it did.
 *
 * ⛔ ONE `fillRect`, ONE `strokeRect`, AND THE LABEL IS OPTIONAL. The percent
 * label costs a `measureText` only when it is switched on, and it is dropped
 * outright when the rectangle is too small to hold it — a chip wider than its own
 * box reads as a bug, not as information.
 */
export function renderRect(ctx, pts, drawing = null, o = null) {
  if (!ok(pts, 2)) return
  const { x1: x, y1: y, w, h } = boundsOf(pts)
  const stroke = ctx.strokeStyle
  const fill = fillFor(drawing, stroke, 0.08)
  ctx.save()
  ctx.globalAlpha = fill.opacity
  ctx.fillStyle = fill.color
  ctx.fillRect(x, y, w, h)
  ctx.restore()
  ctx.strokeStyle = borderFor(drawing, stroke)
  ctx.strokeRect(x, y, w, h)

  if (!o || !o.showPercent) return
  // ⛔ ANCHOR ORDER, NOT BOUNDS. `boundsOf` normalises the corners, so reading the
  // move off it would print +4.2% for a rectangle drawn top-down and bottom-up
  // alike. The user drew from the first click to the second; that is the
  // direction of the move, and a drop must read as a drop.
  const a = pts[0].price, b = pts[1].price
  if (a == null || b == null || !(Math.abs(a) > 0)) return
  const text = formatPercent(((b - a) / Math.abs(a)) * 100)
  // Too small to hold the chip → no chip. Measured with the SAME metrics the
  // label will be drawn with, so the cutoff moves with the font instead of
  // being a guess that goes stale the first time the font changes.
  const box = labelBox(ctx, text, { x: x + w / 2, y: y + h / 2, align: 'center', baseline: 'middle' })
  if (w < box.w + 6 || h < box.h + 6) return
  drawLabel(ctx, {
    text,
    x: x + w / 2, y: y + h / 2,
    align: 'center', baseline: 'middle',
    bg: borderFor(drawing, stroke), color: null,
    bounds: o.bounds || null,
  })
}

export function renderCircle(ctx, pts) {
  if (!ok(pts, 2)) return
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

/**
 * ⭐ HEAD SIZE STAYS INDEPENDENT OF LINE WIDTH, and that independence was already
 * right — the shipped code passed a literal `10` — so Phase 4 adds the control
 * without changing the model. `arrowSizeFor` returns 10 for any arrow that names
 * no size, which is every arrow drawn before today, so none of them move.
 *
 * ⛔ THE SHAFT STOPS SHORT OF THE TIP. Drawn all the way to `pts[1]`, a thick
 * shaft under a large head pokes a stub out of the arrow's point — the line's
 * round-ish end cap sticks past the triangle's apex. Backing the shaft off by
 * most of the head's length hides the join under the head at every combination of
 * the three sizes and the four line widths. The head still lands exactly on the
 * anchor: the ARROW points where the user clicked, which is the whole job.
 */
export function renderArrow(ctx, pts, drawing = null) {
  if (!ok(pts, 2)) return
  const size = arrowSizeFor(drawing)
  const dx = pts[1].x - pts[0].x, dy = pts[1].y - pts[0].y
  const len = Math.hypot(dx, dy)
  // Never eat more than 60% of a short arrow, or the shaft disappears entirely.
  const inset = len > 0 ? Math.min(size * 0.8, len * 0.6) : 0
  ctx.beginPath()
  ctx.moveTo(pts[0].x, pts[0].y)
  ctx.lineTo(pts[1].x - (len ? (dx / len) * inset : 0), pts[1].y - (len ? (dy / len) * inset : 0))
  ctx.stroke()
  ctx.fillStyle = ctx.strokeStyle
  drawArrowhead(ctx, pts[0], pts[1], size)
}

// Cup curve (for cup & handle patterns): a smooth arc through three anchors —
// left rim, bottom, right rim (clicked in that order). Two placed points
// (mid-draw) fall back to a straight guide line.
export function renderCup(ctx, pts) {
  if (!ok(pts, 2)) return
  const L = pts[0]
  const R = pts[pts.length - 1]
  if (!ok(pts, 3)) {
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
/**
 * A Text Note.
 *
 * ⚰️ WHAT THIS USED TO BE: one hard-coded font string built inline, and a
 * `fillText` per line at `(i + 1) * fs * 1.4`. One face, one weight, no box —
 * and because the string was built here, nothing else could agree with it.
 * Every layout number now comes from `drawingText.js`, which the DOM editor
 * reads too, so the two engines cannot drift apart.
 *
 * ⛔ THE BOX IS PAINTED FIRST AND THE TEXT LAST, so a background can never sit
 * over its own text — and both come from the SAME `textBoxFor` result the editor,
 * the hit test and the selection use. One geometry, four consumers.
 *
 * ⭐ BACKGROUND AND BORDER ARE INDEPENDENT. A hairline around unfilled text over
 * candles is a real choice, so they are two properties and two draws rather than
 * one "boxed" flag.
 *
 * Returns the box it drew, so the overlay can hit-test the ink instead of an
 * estimate of it.
 */
export function renderText(ctx, pts, drawing, opacity = 1) {
  if (!ok(pts, 1) || !drawing.text || opacity <= 0.02) return null
  const prevAlpha = ctx.globalAlpha
  ctx.globalAlpha = prevAlpha * opacity
  ctx.font = fontStringFor(drawing)
  const ink = ctx.strokeStyle
  const box = textBoxFor(ctx, drawing, pts[0].x, pts[0].y, wrapTextLines)

  if (drawing.bgEnabled) {
    // ⭐ THE COLOUR'S OWN ALPHA IS THE OPACITY. ColorPanel emits `#rrggbbaa`, so
    // a separate slider would be a second source of truth for one fact — the
    // same call Phase 4 made for Rectangle fill.
    ctx.fillStyle = bgColorOf(drawing)
    roundRectPath(ctx, box.x, box.y, box.w, box.h, TEXT_RADIUS)
    ctx.fill()
  }
  if (drawing.borderEnabled) {
    // ⛔ SUBTLE ON PURPOSE — 1px, a small radius, no shadow and no glow. This
    // marks the bounds of a note; it is not a callout bubble.
    ctx.save()
    ctx.strokeStyle = drawing.borderColor || ink
    ctx.lineWidth = 1
    ctx.setLineDash([])
    roundRectPath(ctx, box.x + 0.5, box.y + 0.5, box.w - 1, box.h - 1, TEXT_RADIUS)
    ctx.stroke()
    ctx.restore()
  }

  ctx.fillStyle = ink
  box.lines.forEach((line, i) => {
    ctx.fillText(line, box.textX, box.firstBaseline + i * box.lineH)
  })
  ctx.globalAlpha = prevAlpha
  return box
}

/** The note's corner radius — the editor's, so the two match. */
const TEXT_RADIUS = 4

/** A rounded rect that works whether or not the context has `roundRect`
 *  (jsdom's recorder does not, and neither do older Safaris). */
function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath()
  if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, w, h, r)
  else ctx.rect(x, y, w, h)
}

// User-placed "+X%" advance label (manual version of the auto setup-advance label).
// % = directional move between the 1st and 2nd clicked candles (computeAdvancePct).
/**
 * Price Move — a compact annotation of how big a run was.
 *
 * ⭐ THE LABEL IS THE DRAWING. The two anchors define the MEASUREMENT; they are
 * data, not geometry, and nothing is drawn between them. That was already true
 * of this painter and Phase 5 keeps it — what Phase 5 adds is the ability for the
 * label to sit somewhere the user PUT it rather than only where the anchors
 * happen to imply.
 *
 * ⛔ WHERE THE LABEL GOES, IN PRECEDENCE ORDER:
 *   1. `o.at` — the user dragged it there. Absolute, honoured exactly.
 *   2. Derived: above the run's HIGH for an advance, below its LOW for a
 *      decline, offset by a fixed number of screen pixels.
 * A legacy drawing has no stored position and therefore takes branch 2, which is
 * the code that has always run — so every existing Price Move label is where it
 * was, to the pixel.
 *
 * ⭐ A DECLINE ANCHORS TO THE LOW, NOT THE HIGH, so a drop reads tucked under the
 * trough with the same clearance an advance gets above the peak. Anchoring both
 * to the high would land a decline's label on the candle body.
 */
export function renderAdvance(ctx, pts, drawing, toPixelY, offset = 16, canvasW = null, autoInk = '#ffffff', o = null) {
  const lines = (o && o.lines && o.lines.length) ? o.lines : null
  if (!pts.length) return null
  if (!lines && drawing.advPct == null) return null
  const p = pts[pts.length - 1]
  if (!p || p.valid === false || !Number.isFinite(p.x)) return null

  const at = (o && o.at) || null
  // Off-screen guard: an anchor scrolled outside the plot must take its label
  // with it rather than being pinned to the edge by the clamp below. A label the
  // user has explicitly placed is exempt — its position is its own fact.
  if (!at && canvasW != null && (p.x < -1 || p.x > canvasW + 1)) return null

  const isDecline = (drawing.advPct ?? 0) < 0
  let px, py
  if (at && Number.isFinite(at.x) && Number.isFinite(at.y)) {
    px = at.x; py = at.y
  } else {
    const anchorPrice = (isDecline && drawing.advLow != null) ? drawing.advLow : drawing.advHigh
    const anchorY = anchorPrice != null ? toPixelY(null, anchorPrice) : null
    const baseY = anchorY != null ? anchorY : p.y
    px = p.x
    py = isDecline ? baseY + offset : baseY - offset
  }

  ctx.save()
  ctx.font = '600 11px "Instrument Sans", sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = at ? 'middle' : (isDecline ? 'top' : 'bottom')
  // ⚰️ THE ROUNDED PERCENT AND ITS THOUSANDS SEPARATOR ARE PRESERVED. A run is
  // reported as `+1,156%`, not `+1156.00%` — the decimals on a number that size
  // are noise, and the separator is what makes it readable at a glance. The
  // caller builds the string now, so this is the fallback for a drawing whose
  // fields have not been resolved (the placement preview).
  const text = lines ? null : `${Math.round(drawing.advPct) >= 0 ? '+' : ''}${Math.round(drawing.advPct).toLocaleString('en-US')}%`
  const rows = lines || [text]
  let w = 0
  for (const r of rows) w = Math.max(w, ctx.measureText(r).width)
  let x = Math.round(px)
  if (canvasW) {
    const half = w / 2 + 3
    x = Math.max(half, Math.min(x, canvasW - half))
  }
  ctx.fillStyle = drawing.labelColor || autoInk
  const lh = 13
  const base = ctx.textBaseline
  const top = base === 'middle' ? Math.round(py) - ((rows.length - 1) * lh) / 2
    : base === 'top' ? Math.round(py)
      : Math.round(py) - (rows.length - 1) * lh
  rows.forEach((r, i) => ctx.fillText(r, x, top + i * lh))
  ctx.restore()
  // The box the label actually occupies, so hit testing and the selection
  // handle can use the thing the user can SEE rather than the anchors they
  // cannot. ⛔ Returned rather than recomputed by the caller: two independent
  // derivations of "where is the label" is exactly how a hitbox drifts.
  // Visual height: the rows' spacing plus one cap height for the glyphs.
  const h = (rows.length - 1) * lh + 11
  const cy = base === 'middle' ? Math.round(py)
    : base === 'top' ? Math.round(py) + h / 2
      : Math.round(py) - h / 2
  return { x: x - w / 2 - 3, y: cy - h / 2 - 2, w: w + 6, h: h + 4, cx: x, cy }
}

// ─── Fibonacci ───────────────────────────────────────────────────────────────

/** ⚠️ LEVELS AND COLOURS ARE MODULE CONSTANTS, and `d.color` is ignored entirely
 *  (every level overwrites `strokeStyle`). Phase 7 moves the ladder onto the
 *  drawing, defaulted from exactly these arrays so an existing Fib renders
 *  identically until somebody edits it. */
/**
 * Fibonacci Retracement.
 *
 * ⭐ BOTH FIB TOOLS ARE ONE PAINTER NOW. They differ in exactly one thing — how a
 * level ratio becomes a price — and that difference lives in `fibLevelPrice`.
 * Everything else (which levels are visible, what colour each is, which bands
 * are filled, how the labels read) is the same question asked of the same model,
 * so keeping two copies of it was two places for a Phase 8 alert or a Phase 10
 * fix to be applied to only one tool.
 *
 * ⛔ A DRAWING WITH NO OVERRIDES IS PIXEL-IDENTICAL TO WHAT SHIPPED. `resolveLevels`
 * returns the canonical table for it, `resolveBands` returns nothing (the shipped
 * tool had no band fill at all), and the dash ladder and label wording are the
 * ones that were here. Every Fib on every chart is untouched.
 *
 * Returns the level lines it drew — `[{level, key, y, color}]` — so the hit test
 * grabs the lines the user can see and cannot grab the ones they hid.
 */
export function renderFib(ctx, pts, rect, toPixel, o = null) {
  return paintFib(ctx, pts, rect, toPixel, o, 'fib')
}

/** Fibonacci Extension — the same painter, projecting past the swing end. */
export function renderFibExtension(ctx, pts, rect, toPixel, o = null) {
  return paintFib(ctx, pts, rect, toPixel, o, 'fibext')
}

function paintFib(ctx, pts, rect, toPixel, o, fallbackType) {
  if (!ok(pts, 2)) return null
  const { x0, x1: w } = rect
  const drawing = (o && o.drawing) || { type: fallbackType }
  const type = drawing.type || fallbackType
  const a = pts[0].rawPrice, b = pts[1].rawPrice

  const levels = resolveLevels(drawing)
  // ⭐ RESOLVED ONCE, then used by the bands, the lines and the labels. A Fib is
  // up to eleven lines and ten bands; asking the override map per element would
  // be ~30 lookups and as many key formats inside the paint loop.
  const rows = []
  for (const lv of levels) {
    const price = fibLevelPrice(type, lv.level, a, b)
    const y = price == null ? null : toPixel(null, price)
    rows.push({ ...lv, price, y })
  }
  if (!rows.some((r) => r.y != null)) return null

  // ── bands first, so no fill ever sits over a line or a label ──
  const byLevel = new Map(rows.map((r) => [r.level, r]))
  for (const band of resolveBands(drawing)) {
    const ra = byLevel.get(band.from), rb = byLevel.get(band.to)
    if (!ra || !rb || ra.y == null || rb.y == null) continue
    // ⛔ THE BAND IS ITS TWO BOUNDARIES, NOT ITS TWO LINES. Hiding a level is a
    // statement about a line; a configured fill survives it, because losing a
    // band to a visibility click would make styling destructive.
    ctx.fillStyle = band.color
    ctx.fillRect(x0, Math.min(ra.y, rb.y), w - x0, Math.abs(rb.y - ra.y))
  }

  ctx.font = '10px "Instrument Sans", sans-serif'
  const drawn = []
  for (const r of rows) {
    if (!r.visible || r.y == null) continue
    ctx.strokeStyle = r.color
    ctx.setLineDash(r.dash)
    ctx.beginPath()
    ctx.moveTo(x0, r.y)
    ctx.lineTo(w, r.y)
    ctx.stroke()
    // ⚰️ THE LABEL'S WORDING AND PLACEMENT ARE THE SHIPPED ONES — ratio as a
    // percentage to 1dp, an em dash, the price, 4px in and 3px above the line.
    // What changed is that the price goes through the SERIES' own formatter when
    // the caller supplies one, so a Fib on a sub-dollar name stops reading
    // `$0.00`, and that the text takes THIS level's colour rather than the
    // table's — so a recoloured level's readout follows it.
    ctx.fillStyle = r.color
    const money = o && o.fmt ? o.fmt(r.price) : `$${r.price.toFixed(2)}`
    ctx.fillText(`${(r.level * 100).toFixed(1)}% — ${money}`, x0 + 4, r.y - 3)
    drawn.push({ level: r.level, key: r.key, y: r.y, color: r.color })
  }
  ctx.setLineDash([])
  return drawn
}


// ─── Multi-line tools ────────────────────────────────────────────────────────

/** ⚠️ TWO PHASE-2 BUGS LIVE IN HERE, both inherited from `extendToEdges`:
 *  the prongs can be drawn between two off-canvas points (so they visibly jump
 *  as the slope changes), and the prong FILL is a 4-gon built from clipped
 *  endpoints — which is not the shape of a band clipped to a rectangle whenever
 *  the two edges exit through different sides, so a corner goes unfilled.
 *  Also note `globalAlpha = 1` after the handle bar: that is a WRITE, not a
 *  restore, and it discards a Model Book layer fade for the rest of the drawing. */
export function renderPitchfork(ctx, pts, rect) {
  if (!ok(pts, 3)) return
  // P1 = pivot, P2 = left shoulder, P3 = right shoulder
  const [p1, p2, p3] = pts
  // Median line anchor = midpoint of P2–P3
  const mid = { x: (p2.x + p3.x) / 2, y: (p2.y + p3.y) / 2 }
  const dir = { x: mid.x - p1.x, y: mid.y - p1.y }
  const along = (p) => ({ x: p.x + dir.x, y: p.y + dir.y })

  // Median line (solid). `null` = this line does not cross the pane at all, so
  // nothing is drawn — the old code would have drawn a wrong segment instead.
  ctx.setLineDash([])
  const median = extendToEdges(p1, mid, rect)
  if (median) {
    ctx.beginPath()
    ctx.moveTo(median[0].x, median[0].y)
    ctx.lineTo(median[1].x, median[1].y)
    ctx.stroke()
  }

  // Upper and lower prongs (dashed)
  ctx.setLineDash([5, 3])
  const upper = extendToEdges(p2, along(p2), rect)
  const lower = extendToEdges(p3, along(p3), rect)
  for (const seg of [upper, lower]) {
    if (!seg) continue
    ctx.beginPath()
    ctx.moveTo(seg[0].x, seg[0].y)
    ctx.lineTo(seg[1].x, seg[1].y)
    ctx.stroke()
  }
  ctx.setLineDash([])

  // Handle bar connecting P2–P3.
  // ⚰️ THIS USED TO WRITE `globalAlpha = 1` AFTERWARDS, NOT RESTORE WHAT IT
  // FOUND. On the normal chart the layer alpha IS 1, so nothing changed — but
  // under Model Book's focus-zoom fade the layer alpha is < 1, and everything
  // this painter drew after the handle bar (the bar itself, then the prong fill)
  // ignored the fade and painted at full strength while the rest of the drawing
  // faded around it. Multiply, never overwrite.
  const layerAlpha = ctx.globalAlpha
  ctx.globalAlpha = layerAlpha * 0.4
  ctx.beginPath()
  ctx.moveTo(p2.x, p2.y)
  ctx.lineTo(p3.x, p3.y)
  ctx.stroke()
  ctx.globalAlpha = layerAlpha

  // Fill between upper and lower prongs.
  // ⭐ BUILT FROM UNCLIPPED, FAR-EXTENDED LINES AND TRIMMED BY `ctx.clip()`.
  // The band between two parallel lines clipped to a rectangle is a pentagon
  // whenever the two edges leave through different sides, so the old 4-gon built
  // from clipped endpoints left a corner unfilled. `extendLineFar` also returns
  // both lines traversed the SAME way, so the quad can never bow-tie.
  const uf = extendLineFar(p2, along(p2), rect)
  const lf = extendLineFar(p3, along(p3), rect)
  if (uf && lf) {
    ctx.save()
    ctx.globalAlpha = layerAlpha * 0.04
    ctx.fillStyle = ctx.strokeStyle
    ctx.beginPath()
    ctx.moveTo(uf[0].x, uf[0].y)
    ctx.lineTo(uf[1].x, uf[1].y)
    ctx.lineTo(lf[1].x, lf[1].y)
    ctx.lineTo(lf[0].x, lf[0].y)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  }
}

export function renderChannel(ctx, pts, rect) {
  if (!ok(pts, 2)) return
  // First line: p1 to p2
  const first = extendToEdges(pts[0], pts[1], rect)
  if (first) {
    ctx.beginPath()
    ctx.moveTo(first[0].x, first[0].y)
    ctx.lineTo(first[1].x, first[1].y)
    ctx.stroke()
  }
  // Second line: parallel through p3
  if (ok(pts, 3)) {
    const dx = pts[1].x - pts[0].x, dy = pts[1].y - pts[0].y
    const p3a = { x: pts[2].x, y: pts[2].y }
    const p3b = { x: pts[2].x + dx, y: pts[2].y + dy }
    const second = extendToEdges(p3a, p3b, rect)
    ctx.setLineDash([4, 3])
    if (second) {
      ctx.beginPath()
      ctx.moveTo(second[0].x, second[0].y)
      ctx.lineTo(second[1].x, second[1].y)
      ctx.stroke()
    }
    ctx.setLineDash([])
    // Fill between.
    // ⚰️ THIS IS THE "part of the tint disappears" FIX. The old polygon was
    // [a1, b1, b2, a2] built from CLIPPED endpoints, which assumed (a) the band
    // is always a quadrilateral and (b) both edges come back traversed the same
    // way. Neither held: a band clipped to a rect is a pentagon when its edges
    // leave through different sides, and `extendToEdges` used to return whichever
    // two of four candidate crossings passed a ±100px test first — so the quad
    // could self-intersect and the nonzero winding fill cancelled its own area.
    // Extending past the rect and letting the pane clip trim is right for every
    // case, and `extendLineFar` guarantees a consistent traversal.
    const fa = extendLineFar(pts[0], pts[1], rect)
    const fb = extendLineFar(p3a, p3b, rect)
    if (fa && fb) {
      ctx.save()
      // Multiplied, not absolute — see renderPitchfork. A faded layer must fade
      // the tint too, and on the normal chart the layer alpha is 1 so this is
      // byte-identical to the shipped 0.04.
      ctx.globalAlpha = ctx.globalAlpha * 0.04
      ctx.fillStyle = ctx.strokeStyle
      ctx.beginPath()
      ctx.moveTo(fa[0].x, fa[0].y)
      ctx.lineTo(fa[1].x, fa[1].y)
      ctx.lineTo(fb[1].x, fb[1].y)
      ctx.lineTo(fb[0].x, fb[0].y)
      ctx.closePath()
      ctx.fill()
      ctx.restore()
    }
  }
}

// ─── Measurement ─────────────────────────────────────────────────────────────

/** ⚠️ `drawing.barCount` IS READ, NEVER RECOMPUTED. It is stamped once at
 *  creation and the drag path writes only `{points}`, so resizing a Measure
 *  leaves a stale count and changing timeframe leaves one that was never right
 *  for the new bars. Phase 5 derives it here instead. */
/**
 * The Measure box.
 *
 * ⚰️ WHAT MOVED OUT OF HERE. This function used to compute the percentage
 * inline, print `toFixed(2)`, read a bar count the OVERLAY had frozen at
 * creation, and choose its text with a four-branch `if (type === …)` ladder over
 * `measure` / `priceRange` / `dateRange` / pctOnly. All four of those are now
 * decided before the painter is called: the caller hands it finished `lines`,
 * so this draws a box and a readout and knows nothing about what is in it.
 *
 * ⭐ THE BOX IS UNCHANGED — dashed border, 6% fill, same colours. Only the
 * readout inside it moved: one chip instead of two stacked plates, and it can
 * now sit at the top or the bottom of the box instead of always dead centre.
 */
export function renderMeasure(ctx, pts, drawing, o = null) {
  if (!ok(pts, 2)) return
  const { x1, y1, x2, y2 } = boundsOf(pts)
  ctx.setLineDash([3, 3])
  ctx.strokeRect(x1, y1, x2 - x1, y2 - y1)
  ctx.setLineDash([])
  ctx.save()
  ctx.globalAlpha = 0.06
  ctx.fillStyle = ctx.strokeStyle
  ctx.fillRect(x1, y1, x2 - x1, y2 - y1)
  ctx.restore()

  const lines = (o && o.lines) || []
  if (!lines.length) return
  const bounds = o && o.bounds
  // Measured before placing, because where the label goes depends on how tall
  // it is: "top" means "its top edge just inside the box", not "at y1".
  const h = lines.length * 14 + 6
  const y = resolveLabelY(labelPosOf(drawing), { y0: y1, y1: y2 }, h, bounds)
  drawLabelBlock(ctx, lines, {
    x: (x1 + x2) / 2, y, align: 'center', baseline: 'top',
    color: ctx.strokeStyle, bg: READOUT_BG, bounds,
  })
}

/**
 * Bars & Time — the horizontal ruler.
 *
 * ⭐ IT IS DELIBERATELY NOT A MEASURE BOX. Measure asks a two-dimensional
 * question (this much price, over this much time) and a box is the honest shape
 * for it. Bars & Time asks a one-dimensional one, so it draws a one-dimensional
 * object: a span between two caps, at one price row, with no fill and no height.
 * Dropped on the same two anchors the two tools should look like different
 * instruments, not like the same instrument with different text — which is the
 * whole reason the half-landed `dateRange` (a measure box printing only a bar
 * count) never felt like a real tool.
 *
 * ⛔ ONE PRICE ROW, TAKEN FROM THE FIRST ANCHOR. A ruler that can tilt is a
 * trend line with numbers on it. The stored points are kept horizontal by
 * `constrainPoints`, and this reads `pts[0].y` for both ends anyway, so a legacy
 * `dateRange` with two different prices still renders as a proper ruler.
 */
export function renderBarsTime(ctx, pts, drawing, o = null) {
  if (!ok(pts, 2)) return
  const y = pts[0].y
  const xa = Math.min(pts[0].x, pts[1].x), xb = Math.max(pts[0].x, pts[1].x)
  const CAP = 5
  ctx.beginPath()
  ctx.moveTo(xa, y); ctx.lineTo(xb, y)
  ctx.moveTo(xa, y - CAP); ctx.lineTo(xa, y + CAP)
  ctx.moveTo(xb, y - CAP); ctx.lineTo(xb, y + CAP)
  ctx.stroke()

  const lines = (o && o.lines) || []
  if (!lines.length) return
  const bounds = o && o.bounds
  const h = lines.length * 14 + 6
  const pos = labelPosOf(drawing)
  // The band a ruler's label positions within is the CAPS, not a box — so "top"
  // is above the line and "bottom" below it, and centre sits ON the span (the
  // chip's own plate covering the middle of the rule, which is what a ruler
  // looks like).
  const band = pos === 'center'
    ? { y0: y - h / 2, y1: y + h / 2 }
    : { y0: y - CAP - 3 - h, y1: y + CAP + 3 + h }
  const at = resolveLabelY(pos, band, h, bounds)
  drawLabelBlock(ctx, lines, {
    x: (xa + xb) / 2, y: at, align: 'center', baseline: 'top',
    color: ctx.strokeStyle, bg: READOUT_BG, bounds,
  })
}

/** Long/short position (risk-reward): 3 points — entry, stop, target.
 *  ⚠️ RETIRED IN PHASE 9, BUT THIS PAINTER STAYS. The tool goes; the reader
 *  does not, so a chart (or a Model Book example) that already carries a
 *  Position drawing keeps rendering it, keeps naming it in the Objects manager,
 *  and keeps letting the owner delete it. Deleting this function is how you turn
 *  "we retired a tool" into "we silently erased somebody's chart". */
export function renderPosition(ctx, pts) {
  if (!ok(pts, 3)) return
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

/**
 * Selection handles — one dot per resolved anchor, in the drawing's own colour.
 *
 * ⚰️ THEY USED TO BE GOLD FOR EVERY TOOL, and the reason was structural: this
 * painter took only points, so it could not see the drawing. A green trend line
 * got gold handles because nothing here knew the line was green.
 *
 * ⭐ `ink` MUST BE THE *BRIGHTENED* COLOUR, NOT `d.color`. `brightenAnnotationColor`
 * silently remaps five stored hexes on the way to the canvas (#ef4444 → #ff5b5b,
 * three greens → #1ae51a), so a handle painted from the raw stored value would be
 * a visibly different shade from the line it sits on — which is worse than gold,
 * because it looks like a bug rather than a convention. The caller resolves the
 * stroke colour once and hands the same value here.
 *
 * ⛔ THE DARK RING STAYS, AND IS NOT NEGOTIABLE. It is what keeps a handle
 * visible on top of its own line at any colour; without it a thick line and its
 * handles merge into one blob and the grab points become invisible.
 *
 * ⛔ THE COARSE HALO STAYS NEUTRAL GOLD. It is not part of the shape — it is a
 * readout of the grab radius, chrome that means "you can touch here". Tinting it
 * per drawing would make it read as part of the drawing and, on a dark red line,
 * nearly invisible at 16% alpha.
 *
 * Positions are still one-per-anchor. The Circle's on-circumference handles and
 * Price Move's label handle are per-tool overrides and belong to their own phases.
 */
export function renderSelectionHandles(ctx, pts, ink = UCT_DRAW_GOLD) {
  // Pure canvas painter — no hook available here, so it asks the store directly.
  // That is precisely why coarsePointer.js exposes a synchronous read as well as
  // a hook: one fact, two doors, and they cannot disagree.
  const coarse = isCoarsePointer()
  const fill = ink || UCT_DRAW_GOLD
  for (const p of pts) {
    if (!p || p.valid === false || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue
    if (coarse) {
      // Halo = the actual grab zone (`handleGrabRadius()` — the SAME read the
      // overlay's `hitTestHandle` makes), so a finger sees exactly how close is
      // close enough. ⚰️ This was `HIT_THRESHOLD() + 2` — a second derivation of
      // the grab zone beside the one that decided it, which is how a wider grab
      // could ship with a halo that still said 17px.
      ctx.beginPath()
      ctx.arc(p.x, p.y, handleGrabRadius(), 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(201, 168, 76, 0.16)'
      ctx.fill()
    }
    ctx.beginPath()
    ctx.arc(p.x, p.y, HANDLE_R(), 0, Math.PI * 2)
    ctx.fillStyle = fill
    ctx.fill()
    ctx.strokeStyle = '#1a1c17'
    ctx.lineWidth = 1
    ctx.stroke()
  }
}

export function renderCrosshair(ctx, x, y, price, rect) {
  const { x0, y0, x1: w, y1: h } = rect
  ctx.save()
  ctx.strokeStyle = 'rgba(168, 162, 144, 0.35)'
  ctx.lineWidth = 0.5
  ctx.setLineDash([3, 3])
  ctx.beginPath()
  ctx.moveTo(x, y0); ctx.lineTo(x, h)
  ctx.moveTo(x0, y); ctx.lineTo(w, y)
  ctx.stroke()
  ctx.setLineDash([])
  // No floating "$price" label at the cursor while a tool is armed — it read as
  // clutter next to the crosshair; the price scale's own crosshair label already
  // shows it. (`price` kept in the signature for the existing call site.)
  ctx.restore()
}
