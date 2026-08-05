// app/src/components/chart/ChartDrawingOverlay.jsx — Canvas overlay for chart annotations
import { useEffect, useLayoutEffect, useRef, useState, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import ColorPanel from './ColorPanel'

// ─── Tool definitions ────────────────────────────────────────────────────────
const POINT_COUNT = {
  trendline: 2, ray: 2, extended: 2, horizontal: 1, hray: 1, vertical: 1,
  rect: 2, circle: 2, arrow: 2, text: 1, fib: 2, fibext: 2, channel: 3, measure: 2, avwap: 1,
  pitchfork: 3, advance: 2, cup: 3,
  priceRange: 2, dateRange: 2, position: 3,
}

// Alt+<letter> → drawing tool (keyboard arm). Keyed on KeyboardEvent.code so it is
// layout-independent (and unaffected by the special characters Mac emits with Alt).
const ALT_TOOL = {
  KeyT: 'trendline', KeyH: 'horizontal', KeyJ: 'hray', KeyV: 'vertical',
  KeyR: 'rect', KeyC: 'circle', KeyA: 'arrow', KeyF: 'fib', KeyE: 'fibext',
  KeyW: 'avwap', KeyX: 'text', KeyP: 'position',
}
// Alt+Shift+<letter> → the power-user tools.
const ALT_SHIFT_TOOL = { KeyP: 'priceRange', KeyD: 'dateRange', KeyE: 'eraser' }

// How many bars past the last candle a drawing point may be placed/dragged (into
// the empty right-pad — e.g. extending a trendline forward). Bounded so a stray
// far-right click can't fling a point thousands of bars into the void.
const FUTURE_BARS_CAP = 500

const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1]
const FIB_COLORS = ['#ef4444', '#fb923c', '#c9a84c', '#a8a290', '#4ade80', '#60a5fa', '#a78bfa']

const FIB_EXT_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.272, 1.618, 2, 2.618]
const FIB_EXT_COLORS = ['#ef4444', '#fb923c', '#c9a84c', '#a8a290', '#4ade80', '#60a5fa', '#a78bfa', '#e879f9', '#f472b6', '#22d3ee', '#818cf8']

// Render-time color remap so existing drawings pop on the dark chart without
// rewriting stored data: the palette reds brighten, and the palette greens snap
// to the exact bold candle green (#1ae51a) so a green level matches the candles.
const _ANNOTATION_REMAP = {
  '#e74c3c': '#ff5b5b', '#ef4444': '#ff5b5b',   // brighter red
  '#4ade80': '#1ae51a', '#3cb868': '#1ae51a', '#22c55e': '#1ae51a',   // match the bold candle green
}
function brightenAnnotationColor(color) {
  return (color && _ANNOTATION_REMAP[color.toLowerCase()]) || color
}
// Line tools whose right-click menu offers "Set level" (type an exact price) and,
// for the sloped ones, "Make horizontal" (flatten to the left endpoint's price).
const LEVEL_LINE_TYPES = new Set(['trendline', 'ray', 'extended', 'horizontal', 'hray'])
const SLOPED_LINE_TYPES = new Set(['trendline', 'ray', 'extended'])
// Trim a price to a tidy prefill string (max 4 decimals, no trailing zeros).
function fmtLevel(v) {
  if (v == null || !Number.isFinite(+v)) return ''
  return String(+(+v).toFixed(4))
}
// Coarse pointers (finger/stylus) need a bigger grab radius than a mouse.
const _COARSE_POINTER = typeof window !== 'undefined'
  && !!window.matchMedia?.('(pointer: coarse)')?.matches
const HIT_THRESHOLD = _COARSE_POINTER ? 15 : 8 // pixels

// ─── Geometry helpers ────────────────────────────────────────────────────────

function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return Math.hypot(px - x1, py - y1)
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))
}

function distToLine(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return Math.hypot(px - x1, py - y1)
  return Math.abs(dy * px - dx * py + x2 * y1 - y2 * x1) / Math.sqrt(lenSq)
}

function extendToEdges(p1, p2, w, h) {
  const dx = p2.x - p1.x, dy = p2.y - p1.y
  if (dx === 0) return [{ x: p1.x, y: 0 }, { x: p1.x, y: h }]
  if (dy === 0) return [{ x: 0, y: p1.y }, { x: w, y: p1.y }]
  const m = dy / dx, b = p1.y - m * p1.x
  const pts = []
  const yAt0 = b, yAtW = m * w + b
  const xAt0 = -b / m, xAtH = (h - b) / m
  if (yAt0 >= -100 && yAt0 <= h + 100) pts.push({ x: 0, y: yAt0 })
  if (yAtW >= -100 && yAtW <= h + 100) pts.push({ x: w, y: yAtW })
  if (xAt0 >= -100 && xAt0 <= w + 100 && pts.length < 2) pts.push({ x: xAt0, y: 0 })
  if (xAtH >= -100 && xAtH <= w + 100 && pts.length < 2) pts.push({ x: xAtH, y: h })
  return pts.length >= 2 ? pts : [p1, p2]
}

function extendRay(p1, p2, w, h) {
  const dx = p2.x - p1.x, dy = p2.y - p1.y
  if (dx === 0 && dy === 0) return [p1, p2]
  // Extend from p1 through p2 to edge
  const edges = extendToEdges(p1, p2, w, h)
  // Pick the edge point on the p2 side of p1
  const dotA = (edges[0].x - p1.x) * dx + (edges[0].y - p1.y) * dy
  const dotB = edges[1] ? (edges[1].x - p1.x) * dx + (edges[1].y - p1.y) * dy : -1
  const farPt = dotA >= dotB ? edges[0] : edges[1]
  return [p1, farPt || p2]
}

function drawArrowhead(ctx, from, to, size = 8) {
  const angle = Math.atan2(to.y - from.y, to.x - from.x)
  ctx.beginPath()
  ctx.moveTo(to.x, to.y)
  ctx.lineTo(to.x - size * Math.cos(angle - 0.4), to.y - size * Math.sin(angle - 0.4))
  ctx.lineTo(to.x - size * Math.cos(angle + 0.4), to.y - size * Math.sin(angle + 0.4))
  ctx.closePath()
  ctx.fill()
}

// ─── Render functions ────────────────────────────────────────────────────────

function renderTrendline(ctx, pts) {
  if (pts.length < 2) return
  ctx.beginPath()
  ctx.moveTo(pts[0].x, pts[0].y)
  ctx.lineTo(pts[1].x, pts[1].y)
  ctx.stroke()
}

function renderRay(ctx, pts, w, h) {
  if (pts.length < 2) return
  const [a, b] = extendRay(pts[0], pts[1], w, h)
  ctx.beginPath()
  ctx.moveTo(a.x, a.y)
  ctx.lineTo(b.x, b.y)
  ctx.stroke()
}

function renderExtended(ctx, pts, w, h) {
  if (pts.length < 2) return
  const [a, b] = extendToEdges(pts[0], pts[1], w, h)
  ctx.beginPath()
  ctx.moveTo(a.x, a.y)
  ctx.lineTo(b.x, b.y)
  ctx.stroke()
}

function renderHorizontal(ctx, pts, w, showLabel = true) {
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

function renderHRay(ctx, pts, w, showLabel = true) {
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

function renderVertical(ctx, pts, h) {
  if (!pts.length) return
  ctx.beginPath()
  ctx.moveTo(pts[0].x, 0)
  ctx.lineTo(pts[0].x, h)
  ctx.stroke()
}

function renderRect(ctx, pts) {
  if (pts.length < 2) return
  const x = Math.min(pts[0].x, pts[1].x)
  const y = Math.min(pts[0].y, pts[1].y)
  const w = Math.abs(pts[1].x - pts[0].x)
  const h = Math.abs(pts[1].y - pts[0].y)
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

function renderCircle(ctx, pts) {
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

function renderArrow(ctx, pts) {
  if (pts.length < 2) return
  ctx.beginPath()
  ctx.moveTo(pts[0].x, pts[0].y)
  ctx.lineTo(pts[1].x, pts[1].y)
  ctx.stroke()
  ctx.fillStyle = ctx.strokeStyle
  drawArrowhead(ctx, pts[0], pts[1], 10)
}

// Cup curve (for cup & handle patterns): a smooth arc through three anchors —
// left rim, bottom, right rim (clicked in that order). Drawn as a single
// quadratic Bézier whose control point is placed so the curve passes EXACTLY
// through the bottom anchor at its midpoint, giving a clean U regardless of
// where the bottom sits horizontally. Two placed points (mid-draw) fall back
// to a straight guide line.
function cupControlPoint(L, B, R) {
  // Quadratic B(0.5) = 0.25·L + 0.5·C + 0.25·R; solve C so B(0.5) === bottom.
  return { x: 2 * B.x - 0.5 * (L.x + R.x), y: 2 * B.y - 0.5 * (L.y + R.y) }
}

function renderCup(ctx, pts) {
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

function renderText(ctx, pts, drawing, opacity = 1) {
  if (!pts.length || !drawing.text || opacity <= 0.02) return
  const fs = drawing.fontSize || 13   // rendered at its true size; visibility fades with zoom
  const prevAlpha = ctx.globalAlpha
  ctx.globalAlpha = prevAlpha * opacity
  ctx.font = `${fs}px "Instrument Sans", sans-serif`
  ctx.fillStyle = ctx.strokeStyle
  const lines = drawing.text.split('\n')
  lines.forEach((line, i) => {
    ctx.fillText(line, pts[0].x, pts[0].y + (i + 1) * fs * 1.3)
  })
  ctx.globalAlpha = prevAlpha
}

// Directional price move between two candles, using the TRUE extremes so the
// label reflects the real swing (independent of log/linear scale):
//   • advance (B sits higher than A): A's LOW → B's HIGH   → the full run-up
//   • decline (B sits lower  than A): A's HIGH → B's LOW    → the full draw-down
// Returns a signed % (negative = decline), or null if it can't be computed.
function computeAdvancePct(A, B) {
  if (!A || !B) return null
  const aHi = A.h, aLo = A.l, bHi = B.h, bLo = B.l
  if ([aHi, aLo, bHi, bLo].some(v => v == null)) return null
  const isDecline = (bHi + bLo) < (aHi + aLo)   // B lower than A on average
  if (isDecline) return aHi > 0 ? (bLo - aHi) / aHi * 100 : null
  return aLo > 0 ? (bHi - aLo) / aLo * 100 : null
}

// User-placed "+X%" advance label (manual version of the auto setup-advance label).
// % = directional move between the 1st and 2nd clicked candles (see computeAdvancePct).
function renderAdvance(ctx, pts, drawing, toPixelY, offset = 16, canvasW = null) {
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
  ctx.font = '600 12px "Instrument Sans", system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = isDecline ? 'top' : 'bottom'
  ctx.lineJoin = 'round'
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
  ctx.lineWidth = 3
  ctx.strokeStyle = 'rgba(0,0,0,0.85)'
  ctx.strokeText(text, px, py)
  ctx.fillStyle = '#ffffff'
  ctx.fillText(text, px, py)
  ctx.restore()
}

function renderFib(ctx, pts, w, toPixel) {
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

function renderFibExtension(ctx, pts, w, toPixel) {
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

function renderPitchfork(ctx, pts, w, h) {
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

function renderChannel(ctx, pts, w, h) {
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

function renderMeasure(ctx, pts, drawing, pctOnly = false) {
  if (pts.length < 2) return
  const x1 = Math.min(pts[0].x, pts[1].x)
  const y1 = Math.min(pts[0].y, pts[1].y)
  const x2 = Math.max(pts[0].x, pts[1].x)
  const y2 = Math.max(pts[0].y, pts[1].y)
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

// Long/short position (risk-reward): 3 points — entry, stop, target. Shades the
// risk zone (entry→stop) red and the reward zone (entry→target) green, and labels
// the R multiple + per-share risk/reward.
function renderPosition(ctx, pts) {
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
  line(entry.y, '#c9a84c'); line(stop.y, '#ef4444'); line(target.y, '#22c55e')
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

function renderAnchoredVwap(ctx, anchorPt, bars, timeToIndex, toPixelFn) {
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

function renderSelectionHandles(ctx, pts) {
  ctx.fillStyle = '#c9a84c'
  for (const p of pts) {
    ctx.beginPath()
    ctx.arc(p.x, p.y, 4, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = '#1a1c17'
    ctx.lineWidth = 1
    ctx.stroke()
  }
}

function renderCrosshair(ctx, x, y, price, w, h) {
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

// ─── Hit testing ─────────────────────────────────────────────────────────────

function hitTestDrawing(d, pts, mx, my, w, h) {
  if (!pts.length) return false
  switch (d.type) {
    case 'trendline':
      return pts.length >= 2 && distToSegment(mx, my, pts[0].x, pts[0].y, pts[1].x, pts[1].y) < HIT_THRESHOLD
    case 'ray': {
      if (pts.length < 2) return false
      const [a, b] = extendRay(pts[0], pts[1], w, h)
      return distToSegment(mx, my, a.x, a.y, b.x, b.y) < HIT_THRESHOLD
    }
    case 'extended': {
      if (pts.length < 2) return false
      return distToLine(mx, my, pts[0].x, pts[0].y, pts[1].x, pts[1].y) < HIT_THRESHOLD
    }
    case 'horizontal':
      return Math.abs(my - pts[0].y) < HIT_THRESHOLD
    case 'hray':
      return Math.abs(my - pts[0].y) < HIT_THRESHOLD && mx >= (pts[0].x || 0) - HIT_THRESHOLD
    case 'vertical':
      return Math.abs(mx - pts[0].x) < HIT_THRESHOLD
    case 'rect':
    case 'circle': {
      if (pts.length < 2) return false
      const x1 = Math.min(pts[0].x, pts[1].x) - HIT_THRESHOLD
      const y1 = Math.min(pts[0].y, pts[1].y) - HIT_THRESHOLD
      const x2 = Math.max(pts[0].x, pts[1].x) + HIT_THRESHOLD
      const y2 = Math.max(pts[0].y, pts[1].y) + HIT_THRESHOLD
      return mx >= x1 && mx <= x2 && my >= y1 && my <= y2
    }
    case 'arrow':
      return pts.length >= 2 && distToSegment(mx, my, pts[0].x, pts[0].y, pts[1].x, pts[1].y) < HIT_THRESHOLD
    case 'text': {
      // Simple bounding box
      const textW = (d.text?.length || 1) * 8
      const textH = (d.text?.split('\n').length || 1) * 16
      return mx >= pts[0].x - 4 && mx <= pts[0].x + textW + 4 && my >= pts[0].y - textH && my <= pts[0].y + 8
    }
    case 'advance': {
      // Label sits above the 2nd point's candle; box a vertical strip above it.
      const p = pts[pts.length - 1]
      if (!p || p.x == null || p.y == null) return false
      return mx >= p.x - 26 && mx <= p.x + 26 && my >= p.y - 70 && my <= p.y + 10
    }
    case 'fib':
    case 'fibext':
      if (pts.length < 2) return false
      return mx >= 0 && mx <= w && (Math.abs(my - pts[0].y) < HIT_THRESHOLD * 2 || Math.abs(my - pts[1].y) < HIT_THRESHOLD * 2)
    case 'pitchfork':
      if (pts.length < 3) return false
      return distToLine(mx, my, pts[0].x, pts[0].y, (pts[1].x + pts[2].x) / 2, (pts[1].y + pts[2].y) / 2) < HIT_THRESHOLD * 2
    case 'channel':
      if (pts.length < 2) return false
      return distToLine(mx, my, pts[0].x, pts[0].y, pts[1].x, pts[1].y) < HIT_THRESHOLD * 2
    case 'cup': {
      if (pts.length < 3) return pts.length >= 2 && distToSegment(mx, my, pts[0].x, pts[0].y, pts[1].x, pts[1].y) < HIT_THRESHOLD
      const L = pts[0], R = pts[2]
      const c = cupControlPoint(L, pts[1], R)
      // Sample the quadratic and test each chord against the cursor.
      let px = L.x, py = L.y
      for (let i = 1; i <= 20; i++) {
        const t = i / 20, u = 1 - t
        const qx = u * u * L.x + 2 * u * t * c.x + t * t * R.x
        const qy = u * u * L.y + 2 * u * t * c.y + t * t * R.y
        if (distToSegment(mx, my, px, py, qx, qy) < HIT_THRESHOLD) return true
        px = qx; py = qy
      }
      return false
    }
    case 'measure':
    case 'priceRange':
    case 'dateRange': {
      if (pts.length < 2) return false
      const bx1 = Math.min(pts[0].x, pts[1].x), by1 = Math.min(pts[0].y, pts[1].y)
      const bx2 = Math.max(pts[0].x, pts[1].x), by2 = Math.max(pts[0].y, pts[1].y)
      return mx >= bx1 && mx <= bx2 && my >= by1 && my <= by2
    }
    case 'position': {
      if (pts.length < 3) return false
      const xs = pts.map(p => p.x), ys = pts.map(p => p.y)
      return mx >= Math.min(...xs) && mx <= Math.max(...xs) && my >= Math.min(...ys) && my <= Math.max(...ys)
    }
    case 'avwap':
      return pts.length >= 1 && Math.hypot(mx - pts[0].x, my - pts[0].y) < HIT_THRESHOLD * 2
    default: return false
  }
}

// In-memory clipboard for copy/paste of a drawing — module-level so a copy on one
// chart can be pasted onto another (any symbol). Holds a drawing minus its id.
let _drawingClipboard = null

// Clone a drawing's points with a small visible offset (price −0.5%, or +0.03 of the
// volume-pane fraction), keeping the time anchors. Shared by Duplicate + Paste so a
// clone never lands exactly on top of the original.
function offsetPoints(points) {
  return (points || []).map(p => ({
    ...p,
    ...(p.paneRelY != null
      ? { paneRelY: Math.min(1, p.paneRelY + 0.03) }
      : (p.price != null ? { price: p.price * 0.995 } : {})),
  }))
}

// 'YYYY-MM-DD' in America/New_York for a unix-seconds bar time. Formatter built
// once (Intl construction is the expensive part).
const _etDateFmt = typeof Intl !== 'undefined'
  ? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' })
  : null
function etDateStr(tSeconds) {
  if (!_etDateFmt) return null
  try { return _etDateFmt.format(new Date(tSeconds * 1000)) } catch { return null }
}

// Resolve a catalyst's anchor to a bar index. A catalyst carries only a DATE
// ('YYYY-MM-DD'). On a DAILY/WEEKLY chart that maps straight to a bar via
// nearestIndex. On an INTRADAY chart the bars are numeric epochs, so the date
// would fail nearestIndex's type check (returning null → the callout never
// places). Instead we snap to the candle where the news actually broke: the FIRST
// high-volume candle of that ET session (fallback: the day's max-volume candle).
// Binary-searched to a mid-day seed so it's cheap even when the day isn't loaded.
export function resolveCatalystAnchor(anchorTime, bars, nearestIndex) {
  if (!bars?.length) return null
  const intraday = typeof bars[0].t === 'number'
  const isDate = typeof anchorTime === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(anchorTime)
  if (!intraday || !isDate) return nearestIndex(anchorTime)
  const day = anchorTime.slice(0, 10)
  const approx = Math.floor(Date.parse(`${day}T16:30:00Z`) / 1000)   // ~12:30 ET seed
  if (!Number.isFinite(approx)) return nearestIndex(anchorTime)
  let lo = 0, hi = bars.length - 1, seed = 0
  while (lo <= hi) { const m = (lo + hi) >> 1; if (bars[m].t <= approx) { seed = m; lo = m + 1 } else hi = m - 1 }
  const idxs = []
  for (let i = seed; i >= 0; i--) { if (etDateStr(bars[i].t) === day) idxs.unshift(i); else break }
  for (let i = seed + 1; i < bars.length; i++) { if (etDateStr(bars[i].t) === day) idxs.push(i); else break }
  if (!idxs.length) return null   // day not loaded → defer (don't fall back to a wrong bar)
  const volOf = (i) => Number(bars[i].v ?? bars[i].volume ?? 0)
  const rngOf = (i) => {
    const h = bars[i].h ?? bars[i].high, l = bars[i].l ?? bars[i].low
    return (h != null && l != null) ? Math.abs(h - l) : 0
  }
  // Session averages to measure EXPANSION against.
  let sumV = 0, sumR = 0, n = 0
  for (const i of idxs) { sumV += volOf(i); sumR += rngOf(i); n++ }
  const avgV = n ? sumV / n : 0
  const avgR = n ? sumR / n : 0
  // Where the news broke = the FIRST candle that expands on BOTH range AND volume
  // (≥2× the session average of each) — the classic catalyst breakout/breakdown bar
  // (owner ask: "first large range expansion AND volume expansion candle"), NOT just
  // the first big-volume bar (which fired on the 9:30 open long before the news move).
  if (avgV > 0 && avgR > 0) {
    const hit = idxs.find(i => volOf(i) >= 2 * avgV && rngOf(i) >= 2 * avgR)
    if (hit != null) return hit
    // Fallback: the single candle with the greatest combined range × volume expansion.
    let best = idxs[0], bestScore = -1
    for (const i of idxs) {
      const s = (volOf(i) / avgV) * (rngOf(i) / avgR)
      if (s > bestScore) { bestScore = s; best = i }
    }
    return best
  }
  // Last resort (no usable volume/range): first candle ≥50% of peak volume, else peak.
  let maxV = 0
  for (const i of idxs) maxV = Math.max(maxV, volOf(i))
  let target = maxV > 0 ? idxs.find(i => volOf(i) >= maxV * 0.5) : null
  if (target == null) { target = idxs[0]; for (const i of idxs) if (volOf(i) > volOf(target)) target = i }
  return target
}

// ─── Catalyst callout auto-placement (News widget) ───────────────────────────
// A News-widget catalyst is TWO linked drawings — a `text` label + a `trendline`
// leader — each independently editable. Both arrive with points:[] + a shared
// calloutId; the label carries calloutAnchorTime + calloutAutoPlace. This picks a
// blank spot near the anchor candle (same idea as the Model Book callout overlay:
// dodge every visible candle AND any callouts already placed) and returns the label
// box + the anchor pixel; the overlay converts those to chart points for BOTH
// drawings. Returns null when the anchor candle isn't on screen (placement is
// deferred until it scrolls in). PIXELS only — the caller does the pixel→chart map.
function placeCalloutPoint({ ctx, bars, toPixel, nearestIndex, drawings, anchorTime, text, fontSize, plotRight, h, vRange }) {
  if (!bars?.length) return null
  const ai = nearestIndex(anchorTime)
  if (ai == null || !bars[ai]) return null
  const b0 = bars[ai]
  const hi = b0.h ?? b0.high ?? b0.c
  const aHi = toPixel(b0.t, hi)
  if (!aHi || !Number.isFinite(aHi.x) || !Number.isFinite(aHi.y)) return null   // candle off-screen → defer
  const anchorX = aHi.x, anchorHiY = aHi.y
  // The leader connects at the candle's HIGH (top) for BOTH up and down catalysts, so
  // the headline floats UP into the blank space above the move (owner ask, matches the
  // reference). Anchoring a big down-breakdown at its LOW pushed the blank-space search
  // far to the right and dragged the leader off-screen — the reported bug.
  const anchorY = anchorHiY

  ctx.save()
  ctx.font = `${fontSize}px "Instrument Sans", sans-serif`
  // Multi-line labels (earnings: headline + EPS/REV lines): box = widest line ×
  // line count, so placement + the leader endpoint account for the full block.
  const tlines = String(text || '').split('\n')
  let tw = 24
  for (const ln of tlines) tw = Math.max(tw, ctx.measureText(ln).width)
  const firstLineW = tlines.length ? ctx.measureText(tlines[0]).width : tw   // headline width
  const boxW = tw + 2                                     // tight to the text
  const boxH = Math.max(1, tlines.length) * fontSize * 1.4
  // Visible candle high/low segments (pixels) so the label + line dodge candles.
  let from = 0, to = bars.length - 1
  if (vRange) { from = Math.max(0, Math.floor(vRange.from) - 1); to = Math.min(bars.length - 1, Math.ceil(vRange.to) + 1) }
  const segs = []
  for (let i = from; i <= to; i++) {
    const b = bars[i]; if (!b) continue
    const pH = toPixel(b.t, b.h ?? b.high ?? b.c)
    const pL = toPixel(b.t, b.l ?? b.low ?? b.c)
    if (!pH || !pL || !Number.isFinite(pH.x)) continue
    segs.push({ x: pH.x, top: Math.min(pH.y, pL.y), bottom: Math.max(pH.y, pL.y) })
  }
  // Callouts already on the chart → obstacle boxes so a 2nd catalyst doesn't stack.
  const obstacles = []
  for (const d of drawings) {
    if (d.type !== 'text' || !d.points?.length || d.calloutAnchorTime == null) continue
    const p = toPixel(d.points[0].time, d.points[0].price)
    if (!p || !Number.isFinite(p.x)) continue
    const olines = String(d.text || '').split('\n')
    let ow = 24
    for (const ln of olines) ow = Math.max(ow, ctx.measureText(ln).width)
    obstacles.push({ x: p.x, y: p.y, w: ow + 2, h: Math.max(1, olines.length) * (d.fontSize || 13) * 1.4 })
  }
  ctx.restore()

  const plotLeft = 4
  const pRight = Number.isFinite(plotRight) ? plotRight : 100000
  const priceBottom = h * 0.82   // keep labels in the price pane, above volume
  const hitsCandles = (x, y, bw, bh) => {
    for (const s of segs) {
      if (s.x < x - 2 || s.x > x + bw + 2) continue
      if (s.bottom < y || s.top > y + bh) continue
      return true
    }
    return false
  }
  const lineHitsCandles = (x0, y0, x1, y1) => {
    const minx = Math.min(x0, x1), maxx = Math.max(x0, x1)
    for (const s of segs) {
      if (Math.abs(s.x - anchorX) < 3) continue          // its own candle — ok to touch
      if (s.x < minx - 0.5 || s.x > maxx + 0.5) continue
      const t = (x1 === x0) ? 0 : (s.x - x0) / (x1 - x0)
      const y = y0 + t * (y1 - y0)
      if (y >= s.top - 1 && y <= s.bottom + 1) return true
    }
    return false
  }
  const overlapsObstacle = (x, y, bw, bh) =>
    obstacles.some(o => !(x + bw < o.x - 6 || o.x + o.w < x - 6 || y + bh < o.y - 4 || o.y + o.h < y - 4))

  // Build a SMOOTH ~45° leader (owner ask): put the headline attach point on a 45°
  // ray from the candle open, then derive the box from it. `right` = the box sits
  // left of the candle so the leader meets the headline's RIGHT edge (and vice-versa).
  // Take the nearest such placement that clears candles + other labels.
  const fs = fontSize
  const SQRT2 = Math.SQRT2
  const DIRS = [
    { sx: -1, sy: -1, right: true },   // up-left (preferred)
    { sx: 1, sy: -1, right: false },   // up-right
    { sx: -1, sy: 1, right: true },    // down-left
    { sx: 1, sy: 1, right: false },    // down-right
  ]
  const DISTS = [46, 62, 82, 106, 134, 168, 206]   // leader length along the 45° ray
  const BLOCKED = 1e6
  // A candle near the RIGHT edge is a current/live candle — there's no clean room
  // to its right (the price axis lives there), so force the headline into the open
  // space to the LEFT (dr.right = box sits left of the candle).
  const nearRight = anchorX > pRight - (boxW + 60)
  let best = null, bestCost = Infinity
  for (const dist of DISTS) {
    for (const dr of DIRS) {
      const step = dist / SQRT2
      const attachX0 = anchorX + dr.sx * step
      const headY0 = anchorY + dr.sy * step
      let x = dr.right ? attachX0 - firstLineW : attachX0   // box x from the attach side
      let y = headY0 - fs * 0.9                             // headline near the box top
      x = Math.max(plotLeft, Math.min(pRight - boxW, x))
      y = Math.max(4, Math.min(priceBottom - boxH, y))
      // Attach point recomputed from the (possibly clamped) box so scoring is honest.
      const ax = dr.right ? x + firstLineW : x
      const hy = y + fs * 0.9
      let cost = Math.hypot(ax - anchorX, hy - anchorY)     // leader length (≈ dist)
      cost += (dr.sy < 0 ? -10 : 0) + (dr.sx < 0 ? -6 : 0)  // prefer up + left on ties
      if (nearRight && !dr.right) cost += BLOCKED            // current candle → never place right
      if (hitsCandles(x, y, boxW, boxH)) cost += BLOCKED
      if (lineHitsCandles(anchorX, anchorY, ax, hy)) cost += BLOCKED
      if (overlapsObstacle(x, y, boxW, boxH)) cost += BLOCKED
      if (cost < bestCost) { bestCost = cost; best = { x, y } }
    }
  }
  if (!best) best = { x: Math.max(plotLeft, anchorX - firstLineW - 60), y: Math.max(4, anchorY - 60 - fs) }
  return {
    rect: { x: best.x, y: best.y, w: boxW, h: boxH },
    anchorPx: { x: anchorX, y: anchorY },   // leader anchors at the day's high (up) / low (down)
    firstLineW,
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function ChartDrawingOverlay({
  chartRef, seriesRef, bars,
  activeTool, setActiveTool,
  color, lineWidth,
  lineStyle = 'solid',
  magnet = false,
  drawings, addDrawing, updateDrawing, removeDrawing, reorderDrawing = null,
  onMigrate = null,          // (drawings[]) => void — re-anchor legacy volume-pane points to paneRelY (called once when the view settles)
  selectedId, setSelectedId,
  repeatMode = true,
  hidePriceLabels = false,   // Model Book setup hrays: line only, no price label
  measurePctOnly = false,    // Model Book index pane: measure label shows ONLY the % move (drop the $ amount + bar count)
  lineData = null,           // Model Book index pane: [{time, value}] of the underlying LINE series. When set the overlay is in "line mode" — magnet snaps to the line, and the advance % is computed from the line values (not candle O/H) since the pane has no candles.
  fontSize = 13,             // default size for new text annotations
  textFadeRef = null,        // 0..1 opacity for text annotations (Model Book focus-zoom fade); null = always visible
  fadeWholeLayer = false,    // Model Book "show all" OFF: fade the WHOLE layer (lines + text) with the zoom, not just text
  redrawHandleRef = null,    // parent-held ref; the overlay assigns its redraw fn here so a chart snap (instant Setup⇄Result flip) can force the annotations to re-resolve to the NEW mapping in the same frame (no 1-frame position pop)
  undo = null,               // undo/redo/snapshotHistory — wired for the MAIN user-drawings
  redo = null,               //   overlay (useChartDrawings). Annotation overlays omit them
  snapshotHistory = null,    //   (no-op), so Ctrl+Z there does nothing.
  onSaveDefaults = null,     // (”Save as default”) persist {color,width,style} to cs.drawingDefaults
  savedColors = [],          // shared saved-color swatches (same list as Chart Settings)
  onSaveColor = null,        //   → the drawing color picker (ColorPanel) reuses them
  onDeleteColor = null,
  readOnly = false,          // display-only layer (multi-chart grid cells): skip the window
                             //   keydown handler entirely — a NOOP-wired instance would still
                             //   preventDefault Escape/Ctrl+Z/Ctrl+V app-wide, ×N cells.
}) {
  const canvasRef = useRef(null)
  const [pendingPoints, setPendingPoints] = useState([])
  const [mouseCoords, setMouseCoords] = useState(null)
  const [textInput, setTextInput] = useState(null)
  const [ctxMenu, setCtxMenu] = useState(null) // { x, y, drawingId }
  const rafRef = useRef(null)
  // Instant frame-snap handling: LWC updates priceToCoordinate ASYNC (on its next
  // paint), so right after a snap the price mapping is stale. To keep price-anchored
  // annotations instant AND correct, the parent hands us the snap's TARGET price
  // range and we compute Y from it directly (edge-to-edge over the price pane) until
  // LWC's own mapping settles to the same range — then we hand back to
  // priceToCoordinate seamlessly. snapBaseYRef = the pre-snap sample used to detect
  // the settle.
  const snapActiveRef = useRef(false)   // formula-based Y active during the snap transient
  const snapVertRef = useRef(null)      // { lo, hi } edge-to-edge target price range
  const snapBaseYRef = useRef(null)
  const snapSafetyRef = useRef(null)
  const sizeRef = useRef({ w: 0, h: 0 })
  const redrawRef = useRef(null)
  // Motion detection: the off-screen guard is suspended while the view is moving
  // (focus zoom / pan) so lines transition WITH the candles, then re-applied once
  // the view settles (~140ms stable) so off-screen setups stay hidden at rest.
  const lastRangeKeyRef = useRef('')
  const movingRef = useRef(false)
  const settleTimerRef = useRef(null)

  // ── Drag state ──
  // { drawingId, handleIdx (null=whole, 0/1/2=specific point), startPixel, originalPoints }
  const dragRef = useRef(null)
  // Touch support: track concurrent pointers (so a 2nd finger aborts a draw and
  // lets the chart pinch) + a long-press timer that opens the context menu.
  const activePointersRef = useRef(new Set())
  const longPressRef = useRef(null)
  // True only while a touch that landed ON a drawing is being routed through
  // handlePointerDown (from the wrapper touch listener). Lets the no-tool cursor
  // branch fire on touch the way `hoverActive` does for the mouse. Never true for
  // mouse input, so the shipped mouse path is unaffected.
  const touchHitRef = useRef(false)
  const [isDragging, setIsDragging] = useState(false)
  const [hoverDrawingId, setHoverDrawingId] = useState(null)
  // Direct-manipulation: true when the mouse is over a drawing while NO tool is
  // armed. Flips the transparent overlay to interactive JUST for that moment so a
  // drawing can be grabbed / moved / reshaped / right-clicked without first
  // arming the cursor tool. Empty space keeps the overlay transparent (chart pans).
  const [hoverActive, setHoverActive] = useState(false)
  // Live drawings snapshot for the window-level keydown handler (avoids
  // re-subscribing the listener on every drawings change, incl. mid-drag).
  const drawingsRef = useRef(drawings)
  drawingsRef.current = drawings

  // ── Time → bar index lookup ──
  const timeToIndex = useMemo(() => {
    const map = new Map()
    bars?.forEach((b, i) => map.set(b.t, i))
    return map
  }, [bars])

  // Nearest bar index for a time that may not be an EXACT bar on the current
  // timeframe. A drawing placed on the daily chart anchors to a daily date
  // (e.g. '2025-08-15'); on the weekly chart that exact date isn't a bar, so an
  // exact lookup misses and the annotation/line would vanish or streak full
  // width. Snap to the bar whose period CONTAINS the date — the greatest bar
  // time <= the target (binary search; ISO 'YYYY-MM-DD' sorts chronologically).
  // Only snaps when the time type matches the bars' (both strings for D/W) so
  // intraday epoch-number bars are never mis-compared; same-timeframe lookups
  // hit the exact map and never reach the search.
  const nearestIndex = useCallback((time) => {
    if (time == null || !bars?.length) return null
    const exact = timeToIndex.get(time)
    if (exact != null) return exact
    if (typeof time !== typeof bars[0].t) return null
    let lo = 0, hi = bars.length - 1, res = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (bars[mid].t <= time) { res = mid; lo = mid + 1 } else { hi = mid - 1 }
    }
    return res < 0 ? 0 : res   // before the first bar → first bar
  }, [bars, timeToIndex])

  // Bottom edge (CSS px) of the price pane = pane-0 height. Annotations below it
  // live in the volume (or index) pane, which the candle price scale doesn't map.
  const pricePaneBottomPx = useCallback(() => {
    try { const h = seriesRef?.current?.getPane?.()?.getHeight?.(); if (h > 0) return h } catch { /* older API */ }
    try { const h = chartRef?.current?.panes?.()?.[0]?.getHeight?.(); if (h > 0) return h } catch { /* older API */ }
    return null
  }, [chartRef, seriesRef])

  // ── Coordinate conversion: chart → pixel ──
  // Uses refs at call-time so always gets latest chart/series
  const toPixel = useCallback((time, price, futureBars = null) => {
    const chart = chartRef?.current
    const series = seriesRef?.current
    if (!chart || !series) return null
    let x = null
    // FUTURE point: drawn/dragged into the empty right-pad PAST the last candle
    // (e.g. extending a trendline forward). It's anchored to the last bar's time +
    // a whole-bar offset; LWC maps logical indices beyond the data onto the
    // right-pad, so extrapolate there. Gated on `futureBars` so every in-data point
    // takes the byte-identical original path below — no regression to existing
    // drawings. Falls through to the normal mapping if extrapolation fails.
    if (Number.isFinite(futureBars) && futureBars > 0 && bars?.length) {
      try { x = chart.timeScale().logicalToCoordinate((bars.length - 1) + futureBars) } catch {}
    }
    if (x == null && time != null) {
      try { x = chart.timeScale().timeToCoordinate(time) } catch {}
      // Fallback: extrapolate from logical index. Uses the CONTAINING bar so a
      // daily-anchored drawing maps onto the right weekly/monthly bar (and vice
      // versa) instead of disappearing when the exact date isn't a bar.
      if (x == null && bars?.length) {
        const idx = nearestIndex(time)
        if (idx != null) {
          try { x = chart.timeScale().logicalToCoordinate(idx) } catch {}
        }
      }
    }
    let y = null
    if (price != null) {
      // During an instant-snap transient, LWC's priceToCoordinate is still the
      // pre-snap mapping this frame. Compute Y directly from the snap's target
      // range (edge-to-edge over the price pane) so the line is instantly at its
      // correct height; hands back to priceToCoordinate once LWC settles (the tick
      // clears snapActiveRef), which equals this by construction — no jump.
      const sv = snapActiveRef.current ? snapVertRef.current : null
      if (sv && Number.isFinite(sv.lo) && Number.isFinite(sv.hi) && sv.hi > sv.lo) {
        const H = pricePaneBottomPx()
        if (H && H > 0) y = H * (sv.hi - price) / (sv.hi - sv.lo)
      }
      if (y == null) { try { y = series.priceToCoordinate(price) } catch {} }
    }
    return { x, y }
  }, [chartRef, seriesRef, bars, nearestIndex, pricePaneBottomPx])

  // Helper: convert to pixel, returning { x, y, rawPrice } with nulls handled.
  // A point with `paneRelY` (placed below the price pane — see toChart) is
  // anchored to a fraction of the canvas height, NOT the candle price scale, so
  // it stays in the volume pane across a Setup⇄Result rescale.
  const resolvePixels = useCallback((points) => {
    const H = sizeRef.current.h || 0
    return points.map(p => {
      const px = toPixel(p.time, p.price, p.futureBars)
      const y = (p.paneRelY != null && H) ? p.paneRelY * H : px?.y
      return { x: px?.x, y, rawPrice: p.price, price: p.price, time: p.time, futureBars: p.futureBars }
    }).filter(p => p.x != null || p.y != null)
  }, [toPixel])

  // One-time migration of LEGACY volume-pane annotations (saved before paneRelY
  // existed): they're price-anchored and jump onto the chart after a rescale.
  // Once the view has SETTLED at the correctly-positioned framing, capture each
  // below-the-price-pane point's pane-relative Y and bubble the patched set up so
  // it can be persisted. Idempotent — points that already have paneRelY are
  // skipped, so the re-render this triggers doesn't loop.
  const migratedRef = useRef(false)
  useEffect(() => { migratedRef.current = false }, [drawings])
  useEffect(() => {
    if (!onMigrate || !drawings?.length || !bars?.length) return
    let raf = null, tries = 0, sawMotion = false
    const attempt = () => {
      raf = null
      if (migratedRef.current) return
      tries++
      const H = sizeRef.current.h || 0
      const pb = pricePaneBottomPx()
      const series = seriesRef?.current
      // Wait for the chart to be ready AND the view to settle so we capture the
      // original, correct position — not a post-jump one. Settle = the framing
      // moved then stopped; or (rare, no motion at all) a few stable frames.
      if (!H || pb == null || !series) { if (tries < 180) raf = requestAnimationFrame(attempt); return }
      if (movingRef.current) { sawMotion = true; if (tries < 180) raf = requestAnimationFrame(attempt); return }
      if (!sawMotion && tries < 40) { raf = requestAnimationFrame(attempt); return }
      let changed = false
      const next = drawings.map(d => {
        if (!d.points?.length) return d
        let pchg = false
        const np = d.points.map(p => {
          if (p.paneRelY != null || p.price == null) return p
          let y = null
          try { y = series.priceToCoordinate(p.price) } catch { /* disposed */ }
          if (y != null && y > pb + 1) { pchg = true; return { ...p, paneRelY: y / H } }
          return p
        })
        if (pchg) { changed = true; return { ...d, points: np } }
        return d
      })
      migratedRef.current = true
      if (changed) onMigrate(next)
    }
    raf = requestAnimationFrame(attempt)
    return () => { if (raf) cancelAnimationFrame(raf) }
  }, [onMigrate, drawings, bars, pricePaneBottomPx, seriesRef])

  // ── Coordinate conversion: pixel → chart ──
  // Robust: uses visible range + linear interpolation if coordinateToLogical fails
  const toChart = useCallback((pixelX, pixelY) => {
    const chart = chartRef?.current
    const series = seriesRef?.current
    if (!chart || !series || !bars?.length) return null

    let time = null
    let futureBars = null
    const lastIdx = bars.length - 1
    // Given a raw logical index, resolve to either an in-data bar time OR (when the
    // click is PAST the last candle, i.e. in the right-pad) a future point: anchor
    // to the last bar's time + a bounded whole-bar offset. This is what lets a
    // trendline endpoint be placed in the empty space to the right.
    const fromLogical = (logical) => {
      const rounded = Math.round(logical)
      if (rounded > lastIdx) { time = bars[lastIdx].t; futureBars = Math.min(FUTURE_BARS_CAP, rounded - lastIdx) }
      else { time = bars[Math.max(0, rounded)].t; futureBars = null }
    }
    // Method 1: try coordinateToLogical (LWC v5)
    try {
      const logical = chart.timeScale().coordinateToLogical(pixelX)
      if (logical != null) fromLogical(logical)
    } catch {}

    // Method 2: fallback — interpolate from visible range
    if (!time) {
      try {
        const range = chart.timeScale().getVisibleLogicalRange()
        if (range) {
          const startX = chart.timeScale().logicalToCoordinate(Math.ceil(range.from))
          const endX = chart.timeScale().logicalToCoordinate(Math.floor(range.to))
          if (startX != null && endX != null && endX !== startX) {
            const pxPerBar = (endX - startX) / (Math.floor(range.to) - Math.ceil(range.from))
            fromLogical(Math.ceil(range.from) + (pixelX - startX) / pxPerBar)
          }
        }
      } catch {}
    }

    let price = null
    try { price = series.coordinateToPrice(pixelY) } catch {}

    // Vertical anchor for annotations placed BELOW the price pane (volume / index
    // pane). The candle price scale doesn't cover those rows, so a price stored
    // there gets re-extrapolated onto the price pane after a rescale (Setup⇄Result)
    // and the label jumps up onto the chart. Pin such points to a fraction of the
    // canvas height instead — the pane layout is stable across rescales, so they
    // stay put in the volume pane.
    let paneRelY = null
    const pb = pricePaneBottomPx()
    const H = sizeRef.current.h || 0
    if (pb != null && H && pixelY > pb + 1) paneRelY = pixelY / H

    // Allow partial coords: horizontal only needs price, vertical only needs time
    if (!time && price == null && paneRelY == null) return null
    const fb = futureBars ? { futureBars } : null
    return paneRelY != null ? { time, price, paneRelY, ...fb } : { time, price, ...fb }
  }, [chartRef, seriesRef, bars, pricePaneBottomPx])

  // Line mode (index pane): time → line value, for magnet-snap-to-line + advance %.
  const timeToLineValue = useMemo(() => {
    const m = new Map()
    if (lineData) for (const p of lineData) if (p && p.value != null) m.set(p.time, p.value)
    return m
  }, [lineData])

  // ── Magnet: snap a point's price to the nearest O/H/L/C of the bar under it ──
  // (TradingView-style). When on, drawing near a candle locks to that exact
  // open/high/low/close. Time is already snapped to the bar by toChart.
  // In line mode (index pane has no candles), magnet snaps to the line value at
  // that time instead — so a click locks exactly onto the Nasdaq line.
  const snap = useCallback((coords) => {
    if (!magnet || !coords || coords.price == null || coords.time == null) return coords
    if (lineData) {
      const lv = timeToLineValue.get(coords.time)
      return lv == null ? coords : { ...coords, price: lv }
    }
    const idx = timeToIndex.get(coords.time)
    const b = idx != null ? bars[idx] : null
    if (!b) return coords
    let best = null, bestDist = Infinity
    for (const v of [b.o, b.h, b.l, b.c]) {
      if (v == null) continue
      const d = Math.abs(coords.price - v)
      if (d < bestDist) { bestDist = d; best = v }
    }
    return best == null ? coords : { ...coords, price: best }
  }, [magnet, timeToIndex, bars, lineData, timeToLineValue])

  // ── Canvas setup & resize ──
  useEffect(() => {
    const canvas = canvasRef.current
    const wrapper = canvas?.parentElement
    if (!canvas || !wrapper) return

    const setSize = (width, height) => {
      const dpr = window.devicePixelRatio || 1
      canvas.width = width * dpr
      canvas.height = height * dpr
      canvas.style.width = width + 'px'
      canvas.style.height = height + 'px'
      sizeRef.current = { w: width, h: height }
    }

    // Set initial size immediately
    const rect = wrapper.getBoundingClientRect()
    setSize(rect.width, rect.height)

    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setSize(width, height)
      redrawRef.current?.()
    })
    ro.observe(wrapper)
    return () => ro.disconnect()
  }, [])

  // ── Track chart scroll/zoom and redraw in lockstep ──
  // Subscribe to the time scale's range change so drawings redraw on the SAME
  // frame the chart moves (fires synchronously from setVisibleLogicalRange) —
  // this keeps annotations glued to the candles during the smooth focus zoom
  // (the old 60ms/~16fps poll made them skip behind). A slow poll stays as a
  // belt-and-suspenders fallback for any movement the subscription misses.
  useEffect(() => {
    // Resolve the chart + series from the refs ON EVERY FRAME — never capture
    // them once. The overlay can mount BEFORE the chart exists (SWR-cached bars
    // render the wrapper in StockChart's first commit, and child effects run
    // before the parent effect that creates the chart) or the series can be
    // recreated later (chart-type switch). A one-time capture left this whole
    // tracker dead in those cases: on a frozen chart (Setup Library examples)
    // nothing else triggers a repaint, so the first view change (Setup ⇄ Result
    // flip) re-framed the candles while the canvas kept its STALE pixels — the
    // "trendline doesn't stay where I put it" bug.
    const onRange = () => redrawRef.current?.()
    let subscribedChart = null
    // A rAF loop samples the time range AND the price→pixel mapping each frame,
    // so drawings track VERTICAL price-scale changes too — the autoscale settling
    // after a focus zoom, or axis drags — not just horizontal range moves. (The
    // old time-only 200ms poll left annotations stuck at stale price levels for a
    // beat after the first zoom — the "2.70/5.42 in the wrong spot" glitch.)
    let raf = null
    let lastKey = ''
    const tick = () => {
      const chart = chartRef?.current
      const series = seriesRef?.current
      // (Re)subscribe whenever the chart instance appears or is replaced, so the
      // synchronous same-frame redraw on setVisibleLogicalRange is never lost.
      if (chart !== subscribedChart) {
        try { subscribedChart?.timeScale().unsubscribeVisibleLogicalRangeChange(onRange) } catch { /* gone */ }
        subscribedChart = null
        if (chart) {
          try { chart.timeScale().subscribeVisibleLogicalRangeChange(onRange); subscribedChart = chart } catch { /* older API */ }
        }
      }
      if (chart) {
        try {
          const range = chart.timeScale().getVisibleLogicalRange()
          // A disposed series must not kill range-keyed redraws — sample it
          // separately and fall back to blank mapping values.
          let y0 = null, y1 = null
          try { y0 = series?.priceToCoordinate(1); y1 = series?.priceToCoordinate(100) } catch { /* disposed series */ }
          // Snap settled? Once the price mapping moves off its pre-snap sample,
          // LWC has repainted at the new scale (which equals our target range), so
          // drop the override and hand back to priceToCoordinate — no visible jump.
          if (snapActiveRef.current && y0 != null && snapBaseYRef.current != null
              && Math.abs(y0 - snapBaseYRef.current) > 0.5) {
            snapActiveRef.current = false
            if (snapSafetyRef.current) { clearTimeout(snapSafetyRef.current); snapSafetyRef.current = null }
          }
          // Include the text-fade value so the fade renders frame-by-frame even at
          // the very end of the zoom, where the range barely changes.
          const tf = textFadeRef ? (textFadeRef.current ?? 1).toFixed(3) : ''
          const key = `${range ? `${range.from.toFixed(2)}_${range.to.toFixed(2)}` : ''}|${y0 ?? ''}|${y1 ?? ''}|${tf}`
          if (key !== lastKey) { lastKey = key; redrawRef.current?.() }
        } catch { /* chart torn down mid-frame */ }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      if (raf) cancelAnimationFrame(raf)
      try { subscribedChart?.timeScale().unsubscribeVisibleLogicalRangeChange(onRange) } catch { /* already removed */ }
    }
  }, [chartRef, seriesRef, textFadeRef])

  // ── Request redraw (debounced via rAF, uses ref for latest redraw) ──
  const requestRedraw = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => redrawRef.current?.())
  }, [])

  // ── Redraw all ──
  const redraw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const dpr = window.devicePixelRatio || 1
    const { w, h } = sizeRef.current
    if (w === 0 || h === 0) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)

    // Clip everything to the plot area (exclude the right price axis) so no line,
    // ray, or label ever renders over the price scale — e.g. an hray streaking to
    // the edge while transitioning between setups. Restored at the end of redraw.
    let axisW = 0
    try { axisW = seriesRef?.current?.priceScale?.()?.width?.() ?? 0 } catch { /* default 0 */ }
    ctx.save()
    ctx.beginPath()
    const plotRight = Math.max(0, w - axisW - 1)   // right edge of the plot area (price axis excluded)
    ctx.rect(0, 0, plotRight, h)
    ctx.clip()

    // Focus-zoom fade (Model Book). `fadeVal` eases 0→1 over the last sliver of the
    // zoom-in (and out on zoom-out). When `fadeWholeLayer` (show-all OFF) the WHOLE
    // layer fades via globalAlpha; otherwise (show-all ON) only the text fades and
    // the lines stay put. Other charts (no ref) are always fully visible.
    const fadeVal = textFadeRef ? Math.max(0, Math.min(1, textFadeRef.current ?? 1)) : 1
    const layerAlpha = fadeWholeLayer ? fadeVal : 1
    const textOpacity = fadeWholeLayer ? 1 : fadeVal
    ctx.globalAlpha = layerAlpha

    // Visible logical range — used to hide a setup's annotations when its anchor
    // bar is off-screen (e.g. the next setup to the right while zoomed in on this
    // one). Only enforced for Model Book overlays (textFadeRef present), and only
    // once the view is SETTLED — while the chart is moving the guard is off so
    // lines/labels transition smoothly with the candles instead of popping in.
    let visFrom = -Infinity, visTo = Infinity
    let guardActive = false
    if (textFadeRef) {
      try {
        const r = chartRef?.current?.timeScale?.()?.getVisibleLogicalRange?.()
        if (r) { visFrom = r.from; visTo = r.to }
      } catch { /* keep unbounded */ }
      const key = `${visFrom.toFixed(2)}_${visTo.toFixed(2)}`
      if (key !== lastRangeKeyRef.current) {
        lastRangeKeyRef.current = key
        movingRef.current = true
        if (settleTimerRef.current) clearTimeout(settleTimerRef.current)
        settleTimerRef.current = setTimeout(() => { movingRef.current = false; redrawRef.current?.() }, 140)
      }
      guardActive = !movingRef.current
    }

    const toPixelY = (_, price) => {
      const p = toPixel(null, price)
      return p?.y
    }

    // ── Callout auto-placement (News-widget catalysts) ──
    // A catalyst is TWO linked drawings the News widget drops (shared calloutId):
    // a `text` LABEL (calloutRole 'label' + calloutAnchorTime + calloutAutoPlace)
    // and a `trendline` LINE ('line'), both with empty points. The label drives ONE
    // blank-space placement (dodging candles); we then fill BOTH — the label's box
    // point and the line from the anchor candle to a point that stops a small GAP
    // short of the text — via updateDrawing (idempotent by id, so N same-symbol
    // charts can't duplicate). After that they're two ordinary, separately editable/
    // deletable/colorable drawings. Only on the user-drawings overlay (real updateDrawing).
    if (typeof updateDrawing === 'function' && typeof toChart === 'function') {
      let vRange = null
      try { vRange = chartRef?.current?.timeScale?.()?.getVisibleLogicalRange?.() } catch { /* none */ }
      const asPoint = (p) => p && ({
        time: p.time, price: p.price,
        ...(p.futureBars != null ? { futureBars: p.futureBars } : {}),
        ...(p.paneRelY != null ? { paneRelY: p.paneRelY } : {}),
      })
      for (const d of drawings) {
        if (d.type !== 'text' || d.calloutRole !== 'label' || !d.calloutAutoPlace || d.calloutAnchorTime == null) continue
        if (d.points && d.points.length) continue
        // Size the placed callout from the chart's current drawing default (the
        // overlay's `fontSize` prop = cs.drawingDefaults.fontSize) unless this
        // drawing already carries its own size.
        const calloutFs = d.fontSize || fontSize
        // Resolve the anchor to a real candle FIRST — on an intraday chart a
        // catalyst's date snaps to the session's big-volume candle (where the news
        // broke); daily/weekly stay on the daily bar. Everything downstream anchors
        // to that candle's EXACT time so placeCalloutPoint + the leader line agree.
        const ai = resolveCatalystAnchor(d.calloutAnchorTime, bars, nearestIndex)
        const b = ai != null ? bars[ai] : null
        if (!b) continue
        const res = placeCalloutPoint({
          ctx, bars, toPixel, nearestIndex, drawings,
          anchorTime: b.t, text: d.text, fontSize: calloutFs,
          plotRight, h, vRange,
        })
        if (!res) continue
        // Leader connects at the candle's HIGH for both directions (matches
        // placeCalloutPoint's anchor) so the headline floats up into blank space.
        const anchorPrice = (b.h ?? b.high ?? b.c)
        const { rect, anchorPx } = res
        const fs = calloutFs
        const labelPt = asPoint(toChart(rect.x, rect.y))
        if (!labelPt) continue
        // Attach the leader to the HEADLINE (first line) — near its right end when the
        // candle sits to the right, else its left — at the first line's height, a small
        // GAP off the text. (Owner ask: the line meets the right of the headline, not
        // the bottom-right of the whole multi-line block.) Measured from where the
        // label ACTUALLY renders (its point re-snapped to a bar), not the search rect.
        const lp = toPixel(labelPt.time, labelPt.price)
        const bx = (lp && Number.isFinite(lp.x)) ? lp.x : rect.x
        const by = (lp && Number.isFinite(lp.y)) ? lp.y : rect.y
        const flw = Number.isFinite(res.firstLineW) ? res.firstLineW : rect.w
        const headY = by + fs * 0.9                          // ~vertical center of the headline
        const attachX = anchorPx.x >= bx + flw / 2 ? bx + flw : bx   // side facing the candle
        const ddx = anchorPx.x - attachX, ddy = anchorPx.y - headY
        const dlen = Math.hypot(ddx, ddy) || 1
        const GAP = 8
        const ex = attachX + (ddx / dlen) * GAP
        const ey = headY + (ddy / dlen) * GAP
        const endPt = asPoint(toChart(ex, ey))
        if (!endPt) continue
        // Stamp THIS chart's current drawing default (color + width) so a placed
        // catalyst matches whatever the user last "Saved as default" for drawings —
        // then each is a normal, independently-recolorable drawing.
        updateDrawing(d.id, { points: [labelPt], color, fontSize: fs, calloutAutoPlace: false }, { record: false })
        const line = drawings.find(x => x.calloutRole === 'line' && x.calloutId === d.calloutId)
        if (line) updateDrawing(line.id, { points: [{ time: b.t, price: anchorPrice }, endPt], color, lineWidth, calloutAutoPlace: false }, { record: false })
      }
    }

    // Draw completed drawings
    for (const d of drawings) {
      // AVWAP uses time-based lookup, doesn't need resolved pixels to render
      if (d.type === 'avwap' && d.points?.[0]?.time != null) {
        ctx.save()
        ctx.strokeStyle = brightenAnnotationColor(d.color) || '#c9a84c'
        ctx.lineWidth = d.lineWidth || 1
        ctx.setLineDash([])
        renderAnchoredVwap(ctx, d.points[0], bars, timeToIndex, toPixel)
        if (d.id === selectedId) {
          const pts = resolvePixels(d.points)
          if (pts.length) renderSelectionHandles(ctx, pts)
        }
        ctx.restore()
        continue
      }

      const pts = resolvePixels(d.points || [])
      if (!pts.length) continue
      // Off-screen guard (Model Book): if this drawing's anchor bar — its setup
      // candle (rightmost point / rightBoundTime) — is outside the visible range,
      // skip it so a neighbouring setup's label/lines don't bleed in at the edge.
      // Suspended while the view is moving (guardActive) so lines transition in.
      if (guardActive) {
        const idxs = []
        for (const p of (d.points || [])) { const i = nearestIndex(p.time); if (i != null) idxs.push(i) }
        if (d.rightBoundTime != null) { const ri = nearestIndex(d.rightBoundTime); if (ri != null) idxs.push(ri) }
        if (idxs.length) {
          const anchorIdx = Math.max(...idxs)
          if (anchorIdx > visTo + 0.5 || anchorIdx < visFrom - 0.5) continue
        }
      }
      ctx.save()
      ctx.strokeStyle = brightenAnnotationColor(d.color) || '#c9a84c'
      ctx.lineWidth = d.lineWidth || 1
      // Per-drawing dashed style (e.g. a dashed horizontal level). Most shapes
      // set their own dash internally; lines respect this before they draw.
      ctx.setLineDash(d.lineStyle === 'dashed' ? [6, 4] : [])

      switch (d.type) {
        case 'trendline': renderTrendline(ctx, pts); break
        case 'ray': renderRay(ctx, pts, w, h); break
        case 'extended': renderExtended(ctx, pts, w, h); break
        case 'horizontal': renderHorizontal(ctx, pts, w, !hidePriceLabels); break
        case 'hray': {
          // Optional right bound (time-anchored): stop the ray at this bar
          // instead of running to the canvas edge. Model Book uses it so that,
          // when all setups are shown on the zoomed-out chart, each ray ends at
          // its setup candle rather than streaking across the whole year.
          let hrayRight = w
          if (d.rightBoundTime != null) {
            const bx = toPixel(d.rightBoundTime, pts[0].price)?.x
            if (bx != null) hrayRight = Math.max(pts[0].x ?? 0, Math.min(w, bx))
          }
          // No price label on a horizontal ray — the bare line is what the user
          // wants; the price is already read from the axis/crosshair. (The
          // full-width horizontal line keeps its right-edge label.)
          renderHRay(ctx, pts, hrayRight, false)
          break
        }
        case 'vertical': renderVertical(ctx, pts, h); break
        case 'rect': renderRect(ctx, pts); break
        case 'circle': renderCircle(ctx, pts); break
        case 'arrow': renderArrow(ctx, pts); break
        case 'text': renderText(ctx, pts, d, textOpacity); break
        case 'fib': renderFib(ctx, pts, w, toPixelY); break
        case 'fibext': renderFibExtension(ctx, pts, w, toPixelY); break
        case 'pitchfork': renderPitchfork(ctx, pts, w, h); break
        case 'channel': renderChannel(ctx, pts, w, h); break
        case 'cup': renderCup(ctx, pts); break
        case 'measure': renderMeasure(ctx, pts, d, measurePctOnly); break
        case 'priceRange': renderMeasure(ctx, pts, d); break
        case 'dateRange': renderMeasure(ctx, pts, d); break
        case 'position': renderPosition(ctx, pts); break
        case 'advance': {
          // Recompute the % from the live bars (candle mode) so EXISTING labels are
          // corrected — older ones were stored with a wrong formula (open→high,
          // direction-blind), which mis-stated declines. Also refreshes advHigh/
          // advLow so the label anchors correctly. Line-mode (index pane) keeps its
          // stored value (% between the two clicked line points).
          let ad = d
          if (!lineData && d.points?.length >= 2) {
            const ai = timeToIndex.get(d.points[0].time)
            const bi = timeToIndex.get(d.points[d.points.length - 1].time)
            if (ai != null && bi != null && bars[ai] && bars[bi]) {
              const pct = computeAdvancePct(bars[ai], bars[bi])
              if (pct != null) ad = { ...d, advPct: pct, advHigh: bars[bi].h, advLow: bars[bi].l }
            }
          }
          renderAdvance(ctx, pts, ad, toPixelY, lineData ? 9 : 16, plotRight)
          break
        }
      }

      if (d.id === selectedId) renderSelectionHandles(ctx, pts)
      ctx.restore()
    }

    // Draw in-progress preview
    if (activeTool && pendingPoints.length > 0 && mouseCoords) {
      const previewPts = resolvePixels([...pendingPoints, mouseCoords])
      if (previewPts.length) {
        ctx.save()
        ctx.strokeStyle = brightenAnnotationColor(color)
        ctx.lineWidth = lineWidth
        ctx.globalAlpha = 0.7
        ctx.setLineDash([])

        switch (activeTool) {
          case 'trendline': renderTrendline(ctx, previewPts); break
          case 'ray': renderRay(ctx, previewPts, w, h); break
          case 'extended': renderExtended(ctx, previewPts, w, h); break
          case 'horizontal': renderHorizontal(ctx, previewPts, w); break
          case 'vertical': renderVertical(ctx, previewPts, h); break
          case 'rect': renderRect(ctx, previewPts); break
          case 'circle': renderCircle(ctx, previewPts); break
          case 'arrow': renderArrow(ctx, previewPts); break
          case 'fib': renderFib(ctx, previewPts, w, toPixelY); break
          case 'fibext': renderFibExtension(ctx, previewPts, w, toPixelY); break
          case 'pitchfork': renderPitchfork(ctx, previewPts, w, h); break
          case 'channel': renderChannel(ctx, previewPts, w, h); break
          case 'cup': renderCup(ctx, previewPts); break
          case 'measure': {
            const md = {
              barCount: pendingPoints[0] && mouseCoords
                ? Math.abs((timeToIndex.get(mouseCoords.time) || 0) - (timeToIndex.get(pendingPoints[0].time) || 0))
                : 0
            }
            renderMeasure(ctx, previewPts, md, measurePctOnly)
            break
          }
          case 'priceRange': renderMeasure(ctx, previewPts, { type: 'priceRange' }); break
          case 'dateRange': {
            const md = {
              type: 'dateRange',
              barCount: pendingPoints[0] && mouseCoords
                ? Math.abs((timeToIndex.get(mouseCoords.time) || 0) - (timeToIndex.get(pendingPoints[0].time) || 0))
                : 0,
            }
            renderMeasure(ctx, previewPts, md)
            break
          }
          case 'position': renderPosition(ctx, previewPts); break
          case 'avwap': renderAnchoredVwap(ctx, pendingPoints[0] || mouseCoords, bars, timeToIndex, toPixel); break
          case 'advance': {
            renderTrendline(ctx, previewPts)   // faint connector so the span is visible while placing
            if (lineData) {
              const a = previewPts[0]?.rawPrice, b = previewPts[previewPts.length - 1]?.rawPrice
              if (a > 0 && b != null) {
                renderAdvance(ctx, previewPts, { advPct: ((b - a) / a) * 100, advHigh: b }, toPixelY, 9, plotRight)
              }
            } else {
              const ai = timeToIndex.get(pendingPoints[0].time)
              const bi = timeToIndex.get(mouseCoords.time)
              if (ai != null && bi != null && bars[ai] && bars[bi]) {
                const pct = computeAdvancePct(bars[ai], bars[bi])
                if (pct != null) renderAdvance(ctx, previewPts, { advPct: pct, advHigh: bars[bi].h, advLow: bars[bi].l }, toPixelY, 16, plotRight)
              }
            }
            break
          }
        }
        ctx.restore()
      }
    }

    // Crosshair when tool active
    if (activeTool && mouseCoords) {
      const px = toPixel(mouseCoords.time, mouseCoords.price)
      if (px?.x != null && px?.y != null) {
        renderCrosshair(ctx, px.x, px.y, mouseCoords.price, w, h)
      }
    }
    ctx.restore()   // end plot-area clip
  }, [drawings, pendingPoints, mouseCoords, activeTool, color, lineWidth, fontSize, selectedId, toPixel, resolvePixels, timeToIndex, nearestIndex])

  // Keep redrawRef in sync — always points to latest redraw
  redrawRef.current = redraw
  // The parent (StockChart) calls this right after an instant frame snap. We
  // can't just redraw — LWC's priceToCoordinate is still the pre-snap mapping
  // this frame (its scale updates on its own later paint). So BLANK the layer now
  // and let the rAF tick redraw it the moment the mapping actually changes; that
  // way the lines never appear at the wrong height, they just resolve into place.
  if (redrawHandleRef) redrawHandleRef.current = (vertRange) => {
    // vertRange = { lo, hi } edge-to-edge target price range for the snapped frame.
    // Draw Y from it directly (instant + correct) until LWC's own mapping settles
    // to the same range, at which point the tick clears snapActiveRef and we hand
    // back to priceToCoordinate. Without a valid range we can't compute Y, so fall
    // straight through to priceToCoordinate (may pop, but never blanks).
    if (vertRange && Number.isFinite(vertRange.lo) && Number.isFinite(vertRange.hi) && vertRange.hi > vertRange.lo) {
      snapVertRef.current = { lo: vertRange.lo, hi: vertRange.hi }
      snapActiveRef.current = true
      try { snapBaseYRef.current = seriesRef?.current?.priceToCoordinate(1) ?? null } catch { snapBaseYRef.current = null }
      if (snapSafetyRef.current) clearTimeout(snapSafetyRef.current)
      // Safety net: drop the override after a beat even if the settle isn't detected.
      snapSafetyRef.current = setTimeout(() => { snapActiveRef.current = false; redrawRef.current?.() }, 400)
    }
    redrawRef.current?.()   // paint now, at the correct height
  }

  // Trigger redraw when any drawing state changes
  useEffect(() => { redrawRef.current?.() }, [redraw])

  // ── Mouse helpers ──
  const getCanvasPos = (e) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return null
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  // ── Hit test all drawings ──
  // Advance/decline % labels render above the candle's HIGH or below its LOW —
  // and frequently sit ON the candles. A point-only hit box misses them, so make
  // the WHOLE candle column (high→low, + a margin past each for the label)
  // right-clickable. Uses the same anchors the renderer does, backfilling the
  // low for older decline labels so they're deletable too.
  const hitTestAdvance = useCallback((d, pts, mx, my) => {
    const p = pts[pts.length - 1]
    if (!p || p.x == null) return false
    const hiY = d.advHigh != null ? toPixel(null, d.advHigh)?.y : null
    let loPrice = d.advLow
    if (loPrice == null && d.points?.length) {
      const bi = timeToIndex.get(d.points[d.points.length - 1].time)
      if (bi != null && bars[bi]) loPrice = bars[bi].l
    }
    const loY = loPrice != null ? toPixel(null, loPrice)?.y : null
    const ys = [hiY, loY, p.y].filter(v => v != null)
    if (!ys.length) return false
    const PAD = 30, HALF_W = 30   // label margin past the wick + generous click width
    return mx >= p.x - HALF_W && mx <= p.x + HALF_W
      && my >= Math.min(...ys) - PAD && my <= Math.max(...ys) + PAD
  }, [toPixel, bars, timeToIndex])

  const hitTestAll = useCallback((mx, my) => {
    const { w, h } = sizeRef.current
    for (let i = drawings.length - 1; i >= 0; i--) {
      const d = drawings[i]
      const pts = resolvePixels(d.points || [])
      const hit = d.type === 'advance'
        ? hitTestAdvance(d, pts, mx, my)
        : hitTestDrawing(d, pts, mx, my, w, h)
      if (hit) return d.id
    }
    return null
  }, [drawings, resolvePixels, hitTestAdvance])

  // ── Hit test handles (control points) — returns { drawingId, handleIdx } or null ──
  const hitTestHandle = useCallback((mx, my) => {
    if (!selectedId) return null
    const d = drawings.find(d => d.id === selectedId)
    if (!d) return null
    const pts = resolvePixels(d.points || [])
    for (let i = 0; i < pts.length; i++) {
      if (Math.hypot(mx - pts[i].x, my - pts[i].y) < HIT_THRESHOLD + 2) {
        return { drawingId: d.id, handleIdx: i }
      }
    }
    return null
  }, [selectedId, drawings, resolvePixels])

  // ── Latest-value refs for the long-lived native listeners below ──
  // (window/canvas listeners are attached once with []; read live state via refs
  // so they never see a stale hit-test / tool / drag snapshot.)
  const hitTestAllRef = useRef(hitTestAll); hitTestAllRef.current = hitTestAll
  const hitTestHandleRef = useRef(hitTestHandle); hitTestHandleRef.current = hitTestHandle
  const hoverGuardRef = useRef(null)
  hoverGuardRef.current = { activeTool, isDragging, selectedId }
  // Live ctx-menu flag for the touch listener (so an open bottom-sheet isn't
  // fought by the drag path when a drawing sits behind it).
  const ctxMenuOpenRef = useRef(false)
  ctxMenuOpenRef.current = !!ctxMenu

  // ── Direct-manipulation hover (mouse only) ──
  // With NO tool armed the overlay canvas is pointer-transparent so the chart owns
  // pan/zoom. Here we watch the mouse (events bubble up through the transparent
  // canvas to its wrapper) and, when it's over a drawing, set hoverActive → the
  // overlay becomes interactive for that spot only. Touch has no hover, so those
  // devices stay on the existing tool-armed path (deferred follow-up).
  useEffect(() => {
    const canvas = canvasRef.current
    const wrapper = canvas?.parentElement
    if (!wrapper) return
    const hasHover = window.matchMedia?.('(hover: hover)')?.matches
    if (!hasHover) return
    const onMove = (e) => {
      const g = hoverGuardRef.current
      // A tool is armed → overlay already interactive; mid-drag → don't re-hit-test
      // (would fight the drag and could flip pointerEvents out from under it).
      if (g.activeTool || g.isDragging) return
      const rect = canvas.getBoundingClientRect()
      const x = e.clientX - rect.left, y = e.clientY - rect.top
      let id = null, onHandle = false
      if (g.selectedId) {
        const hh = hitTestHandleRef.current(x, y)
        if (hh) { onHandle = true; id = hh.drawingId }
      }
      if (!id) id = hitTestAllRef.current(x, y)
      setHoverActive(!!id)
      setHoverDrawingId(id ? (onHandle ? '__handle__' : id) : null)
    }
    const onLeave = () => { setHoverActive(false); setHoverDrawingId(null) }
    wrapper.addEventListener('mousemove', onMove)
    wrapper.addEventListener('mouseleave', onLeave)
    return () => {
      wrapper.removeEventListener('mousemove', onMove)
      wrapper.removeEventListener('mouseleave', onLeave)
    }
  }, [])

  // ── Native right-click on a drawing ──
  // Attached directly to the canvas so it fires DURING bubble BEFORE the chart
  // container's own native `contextmenu` listener (which opens the big chart
  // settings menu). stopPropagation there keeps that menu from also opening — but
  // ONLY when the cursor is over a drawing; empty space falls through to the chart.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onCtx = (e) => {
      const rect = canvas.getBoundingClientRect()
      const hitId = hitTestAllRef.current(e.clientX - rect.left, e.clientY - rect.top)
      if (!hitId) return   // not on a drawing → let the chart's menu handle it
      e.preventDefault()
      e.stopPropagation()
      setSelectedId(hitId)
      setCtxMenu({ x: e.clientX, y: e.clientY, drawingId: hitId })
    }
    canvas.addEventListener('contextmenu', onCtx)
    return () => canvas.removeEventListener('contextmenu', onCtx)
  }, [setSelectedId])

  // ── Mouse handlers ──
  const handlePointerDown = useCallback((e) => {
    // Right mouse button is the context-menu path, not draw/drag.
    if (e.pointerType === 'mouse' && e.button !== 0) return

    // Multi-touch: a 2nd finger means the user is pinch-zooming the chart —
    // abort any in-progress placement/drag so we don't fight the gesture.
    activePointersRef.current.add(e.pointerId)
    if (activePointersRef.current.size > 1) {
      if (isDragging) { dragRef.current = null; setIsDragging(false) }
      if (longPressRef.current) { clearTimeout(longPressRef.current); longPressRef.current = null }
      return
    }

    const pos = getCanvasPos(e)
    if (!pos) return

    // Capture so a drag keeps tracking even if the finger leaves the canvas.
    try { e.currentTarget.setPointerCapture?.(e.pointerId) } catch { /* noop */ }

    // Touch long-press over a drawing → open its context menu (no right-click on touch).
    if (e.pointerType !== 'mouse') {
      const lpHitId = hitTestAll(pos.x, pos.y)
      if (lpHitId) {
        const cx = e.clientX, cy = e.clientY
        longPressRef.current = setTimeout(() => {
          longPressRef.current = null
          try { navigator.vibrate?.(10) } catch { /* noop */ }
          setSelectedId(lpHitId)
          setCtxMenu({ x: cx, y: cy, drawingId: lpHitId })
        }, 450)
      }
    }

    const coords = snap(toChart(pos.x, pos.y))

    // ── ERASER: click a drawing to delete it (stays armed for more) ──
    if (activeTool === 'eraser') {
      e.preventDefault()
      const hitId = hitTestAll(pos.x, pos.y)
      if (hitId) {
        const d = drawings.find(dr => dr.id === hitId)
        if (d && !d.locked) { removeDrawing(hitId); if (selectedId === hitId) setSelectedId(null) }
      }
      return
    }

    // ── CURSOR MODE: select + drag ──
    // Also the implicit no-tool case: the overlay only receives this pointerdown
    // (pointerEvents flipped to 'auto') because the mouse is hovering a drawing,
    // so treat it exactly like cursor mode — grab/reshape without arming a tool.
    if (activeTool === 'cursor' || (!activeTool && (hoverActive || touchHitRef.current))) {
      // Check handle drag first (move individual control point)
      const handle = hitTestHandle(pos.x, pos.y)
      if (handle) {
        const d = drawings.find(d => d.id === handle.drawingId)
        if (d) {
          if (d.locked) { setSelectedId(d.id); e.preventDefault(); return }   // locked → select, no reshape
          dragRef.current = {
            drawingId: handle.drawingId,
            handleIdx: handle.handleIdx,
            startPixel: pos,
            startCoords: coords,
            originalPoints: d.points.map(p => ({ ...p })),
          }
          setIsDragging(true)
          e.preventDefault()
          return
        }
      }

      // Check body drag (move entire drawing)
      const hitId = hitTestAll(pos.x, pos.y)
      if (hitId) {
        setSelectedId(hitId)
        const d = drawings.find(d => d.id === hitId)
        if (d) {
          if (d.locked) { e.preventDefault(); return }   // locked → selected but not movable
          // Alt-drag = clone: spawn a copy at the same spot and drag THAT, leaving
          // the original where it was (TradingView's duplicate-drag gesture).
          let dragId = hitId
          if (e.altKey) {
            const { id: _cid, ...rest } = d
            dragId = addDrawing({ ...rest, points: d.points.map(p => ({ ...p })), locked: false })
            setSelectedId(dragId)
          }
          dragRef.current = {
            drawingId: dragId,
            handleIdx: null, // null = whole body
            startPixel: pos,
            startCoords: coords,
            originalPoints: d.points.map(p => ({ ...p })),
          }
          setIsDragging(true)
          e.preventDefault()
          return
        }
      }

      // Clicked empty space — deselect
      setSelectedId(null)
      return
    }

    // ── DRAWING MODES ──
    if (!coords) return

    // Text tool: place text input (use fixed position via clientX/clientY to avoid overflow clip)
    if (activeTool === 'text') {
      setTextInput({ x: e.clientX, y: e.clientY, canvasX: pos.x, canvasY: pos.y, time: coords.time, price: coords.price, paneRelY: coords.paneRelY ?? null })
      return
    }

    // Add point for drawing tools
    if (activeTool && activeTool !== 'cursor') {
      const newPending = [...pendingPoints, coords]
      const needed = POINT_COUNT[activeTool] || 2

      if (newPending.length >= needed) {
        const drawingData = {
          type: activeTool,
          points: newPending,
          color,
          lineWidth,
          lineStyle,   // 'solid' | 'dashed' — honored for line-type drawings
        }
        if ((activeTool === 'measure' || activeTool === 'dateRange') && newPending.length >= 2) {
          const idx0 = timeToIndex.get(newPending[0].time) || 0
          const idx1 = timeToIndex.get(newPending[newPending.length - 1].time) || 0
          drawingData.barCount = Math.abs(idx1 - idx0)
        }
        // Advance label: % from the OPEN of the FIRST clicked candle to the HIGH
        // of the SECOND — same basis as the auto setup-advance labels. Stored at
        // creation so it survives reload without needing a bar lookup. In line
        // mode (index pane) there are no candles, so use the LINE values at the
        // two clicked points (1st → 2nd) — gives the % advance/decline of the move.
        if (activeTool === 'advance' && newPending.length >= 2) {
          if (lineData) {
            const a = newPending[0].price, b = newPending[1].price
            if (a > 0 && b != null) {
              drawingData.advPct = ((b - a) / a) * 100
              drawingData.advHigh = b
            }
          } else {
            const ai = timeToIndex.get(newPending[0].time)
            const bi = timeToIndex.get(newPending[1].time)
            if (ai != null && bi != null && bars[ai] && bars[bi]) {
              const pct = computeAdvancePct(bars[ai], bars[bi])
              if (pct != null) drawingData.advPct = pct
              drawingData.advHigh = bars[bi].h
              drawingData.advLow = bars[bi].l   // decline labels anchor below this
            }
          }
        }
        addDrawing(drawingData)
        setPendingPoints([])
        if (!repeatMode) setActiveTool(null)
      } else {
        setPendingPoints(newPending)
      }
    }
  }, [activeTool, hoverActive, pendingPoints, color, lineWidth, lineStyle, toChart, snap, addDrawing, setSelectedId, timeToIndex, bars, lineData, drawings, hitTestAll, hitTestHandle, repeatMode, isDragging, removeDrawing, selectedId])

  const handlePointerMove = useCallback((e) => {
    const pos = getCanvasPos(e)
    if (!pos) return
    const coords = toChart(pos.x, pos.y)

    // Movement cancels a pending long-press (it was a pan, not a press).
    if (longPressRef.current) { clearTimeout(longPressRef.current); longPressRef.current = null }

    // ── DRAGGING ──
    if (isDragging && dragRef.current && coords) {
      const drag = dragRef.current
      const d = drawings.find(d => d.id === drag.drawingId)
      if (!d || !drag.startCoords) return

      // Compute delta in chart coordinates. In the empty right-pad, toChart clamps
      // `time` to the last candle and stashes the real offset in `futureBars`, so
      // the delta MUST add futureBars — otherwise it saturates at the last bar and
      // an endpoint can't be dragged past the current candle into the future.
      const effLogical = (c) => {
        // nearestIndex (NOT exact timeToIndex.get) — on a live intraday chart a
        // stored point time can drift off an exact bar key (bars get re-bucketed /
        // sanitized), and an exact miss `?? 0` would resolve to index 0 → the point
        // snaps horizontally to the far-left first bar. nearestIndex snaps to the
        // containing bar instead, matching how the line is RENDERED.
        const base = c?.time != null ? (nearestIndex(c.time) ?? 0) : 0
        return base + (Number.isFinite(c?.futureBars) ? c.futureBars : 0)
      }
      const timeDelta = coords.time && drag.startCoords.time
        ? effLogical(coords) - effLogical(drag.startCoords)
        : 0
      const priceDelta = (coords.price || 0) - (drag.startCoords.price || 0)
      // Vertical anchor handling. Price-pane points keep the existing (log-safe)
      // priceDelta move; volume-pane points move by a pixel-fraction so they stay
      // in the volume pane. A point dragged ACROSS the pane boundary re-anchors to
      // the side it lands on — so an old price-anchored volume label fixes itself
      // permanently once nudged. The boundary is the price pane's bottom edge.
      const ser = seriesRef?.current
      const H = sizeRef.current.h || 0
      const pb = pricePaneBottomPx()
      const pixelDY = (drag.startPixel) ? (pos.y - drag.startPixel.y) : 0
      const clamp01 = v => Math.max(0, Math.min(1, v))
      const moveY = (p) => {
        if (p.paneRelY != null) {
          const ny = p.paneRelY + (H ? pixelDY / H : 0)
          if (pb != null && H && ny * H <= pb + 1) {       // dragged up into the price pane
            let np = null; try { np = ser?.coordinateToPrice(ny * H) } catch { /* disposed */ }
            if (np != null) return { price: np }
          }
          return { paneRelY: clamp01(ny), price: p.price }
        }
        let oy = null; try { oy = ser?.priceToCoordinate(p.price) } catch { /* disposed */ }
        if (pb != null && H && oy != null && oy + pixelDY > pb + 1) {   // dragged down into the volume pane
          return { paneRelY: clamp01((oy + pixelDY) / H) }
        }
        return { price: (p.price ?? 0) + priceDelta }
      }

      // Move a point by `timeDelta` bars along X, honoring FUTURE points (past the
      // last candle): a future point's origin index is lastIdx + its futureBars, and
      // dragging it further right keeps it in the right-pad; dragging it back into
      // the data drops futureBars (returns to a real bar time). In-data points behave
      // exactly as before.
      const _lastIdx = bars.length - 1
      const moveX = (p) => {
        const origIdx = (Number.isFinite(p.futureBars) && p.futureBars > 0)
          ? _lastIdx + p.futureBars
          : (nearestIndex(p.time) ?? 0)   // nearest, not exact — see effLogical note
        const rawIdx = origIdx + timeDelta
        if (rawIdx > _lastIdx) {
          return { time: bars[_lastIdx].t, futureBars: Math.min(FUTURE_BARS_CAP, rawIdx - _lastIdx), ...moveY(p) }
        }
        return { time: bars[Math.max(0, rawIdx)]?.t || p.time, ...moveY(p) }
      }
      let newPoints
      if (drag.handleIdx != null) {
        // Move single control point
        newPoints = drag.originalPoints.map((p, i) => (i !== drag.handleIdx ? p : moveX(p)))
      } else {
        // Move entire drawing
        newPoints = drag.originalPoints.map(moveX)
      }

      // First move of a drag → snapshot the pre-drag state ONCE so the whole drag
      // collapses into a single undo step; per-move writes then skip history.
      if (!drag.snapped) { snapshotHistory?.(); drag.snapped = true }
      updateDrawing(drag.drawingId, { points: newPoints }, { record: false })
      requestRedraw()
      return
    }

    // ── CURSOR MODE: hover detection for cursor change ──
    if (activeTool === 'cursor') {
      const handle = hitTestHandle(pos.x, pos.y)
      if (handle) {
        setHoverDrawingId('__handle__')
      } else {
        const hitId = hitTestAll(pos.x, pos.y)
        setHoverDrawingId(hitId)
      }
    }

    // Standard preview for drawing tools — snap so the preview shows the magnet target
    setMouseCoords(snap(coords))
    requestRedraw()
  }, [activeTool, isDragging, toChart, snap, requestRedraw, drawings, timeToIndex, nearestIndex, bars, updateDrawing, snapshotHistory, hitTestAll, hitTestHandle])

  const handlePointerUp = useCallback((e) => {
    if (e?.pointerId != null) activePointersRef.current.delete(e.pointerId)
    if (longPressRef.current) { clearTimeout(longPressRef.current); longPressRef.current = null }
    if (isDragging) {
      dragRef.current = null
      setIsDragging(false)
    }
  }, [isDragging])

  // ── Touch / tablet direct manipulation ──
  // Touch has no hover, so the mouse pre-flip trick (hoverActive) can't work: the
  // first signal IS the touchstart, and the browser has already committed the touch
  // to whatever element was hit-tested before any JS runs — we can't retarget it.
  // So instead of flipping the overlay's pointerEvents (which would either swallow
  // ALL touches or none), the overlay stays pointer-transparent and a CAPTURE-phase
  // pointerdown listener on the wrapper (an ancestor of both the chart + overlay
  // canvases) decides per-touch: if it lands ON a drawing, we stopPropagation so the
  // chart never starts a pan, capture the pointer to the wrapper, and drive the SAME
  // drag / long-press path as the mouse (handlePointerDown/Move/Up). If it lands on
  // empty space — or a 2nd finger arrives — we do nothing, so the chart keeps its
  // native one-finger pan and two-finger pinch-zoom completely intact.
  const pointerDownRef = useRef(handlePointerDown); pointerDownRef.current = handlePointerDown
  const pointerMoveRef = useRef(handlePointerMove); pointerMoveRef.current = handlePointerMove
  const pointerUpRef = useRef(handlePointerUp); pointerUpRef.current = handlePointerUp
  useEffect(() => {
    const canvas = canvasRef.current
    const wrapper = canvas?.parentElement
    if (!wrapper || !_COARSE_POINTER) return   // touch / coarse-pointer devices only
    let dragging = false
    const onDown = (e) => {
      if (e.pointerType === 'mouse') return
      if (ctxMenuOpenRef.current) return       // menu/sheet open → let taps reach it
      const g = hoverGuardRef.current
      if (g.activeTool) return                 // a tool is armed → the canvas React handlers own it
      // A 2nd finger means the user wants to pinch/pan — bail out of any drag we
      // started and let the gesture through (don't stopPropagation).
      if (activePointersRef.current.size >= 1) {
        if (dragging) { dragging = false; pointerUpRef.current(e) }
        return
      }
      const rect = canvas.getBoundingClientRect()
      const x = e.clientX - rect.left, y = e.clientY - rect.top
      let hit = null
      if (g.selectedId) { const hh = hitTestHandleRef.current(x, y); if (hh) hit = hh.drawingId }
      if (!hit) hit = hitTestAllRef.current(x, y)
      if (!hit) return                         // empty space → let the chart pan / pinch
      // We own this touch. Stop it reaching the chart, then run the shared path.
      e.stopPropagation()
      dragging = true
      touchHitRef.current = true
      try { pointerDownRef.current(e) } finally { touchHitRef.current = false }
    }
    const onMove = (e) => {
      if (e.pointerType === 'mouse' || !dragging) return
      e.stopPropagation()
      pointerMoveRef.current(e)
    }
    const onUp = (e) => {
      if (e.pointerType === 'mouse' || !dragging) return
      dragging = false
      pointerUpRef.current(e)
    }
    // While WE are dragging a drawing, block the browser's default touch scrolling
    // (non-passive so preventDefault sticks). Chart pans (dragging=false) are untouched.
    const onTouchMove = (e) => { if (dragging) e.preventDefault() }
    const capT = { capture: true }
    wrapper.addEventListener('pointerdown', onDown, capT)
    wrapper.addEventListener('pointermove', onMove, capT)
    wrapper.addEventListener('pointerup', onUp, capT)
    wrapper.addEventListener('pointercancel', onUp, capT)
    wrapper.addEventListener('touchmove', onTouchMove, { capture: true, passive: false })
    return () => {
      wrapper.removeEventListener('pointerdown', onDown, capT)
      wrapper.removeEventListener('pointermove', onMove, capT)
      wrapper.removeEventListener('pointerup', onUp, capT)
      wrapper.removeEventListener('pointercancel', onUp, capT)
      wrapper.removeEventListener('touchmove', onTouchMove, { capture: true })
    }
  }, [])

  // Deselect when clicking away. In no-tool mode the overlay canvas is
  // pointer-transparent over empty space, so an empty-space click lands on the
  // chart canvas (a sibling) and the overlay's own pointerdown never fires —
  // leaving the selection handles stuck. This document-level capture listener
  // clears the selection on any pointerdown that ISN'T on the overlay canvas
  // (a drawing/handle click keeps the selection; the overlay handles it).
  useEffect(() => {
    if (!selectedId) return
    const onDocDown = (e) => {
      if (e.target === canvasRef.current) return
      setSelectedId(null)
    }
    document.addEventListener('pointerdown', onDocDown, true)
    return () => document.removeEventListener('pointerdown', onDocDown, true)
  }, [selectedId, setSelectedId])

  // ── Hit test all drawings ── (already defined above)

  // ── Keyboard nudge of the selected drawing ──
  // Held in a ref (reassigned every render) so the window keydown effect below can
  // keep MINIMAL deps — bars/timeToIndex/seriesRef change on every live tick, and we
  // must not re-subscribe the global listener that often. Mirrors the drag transform:
  // time shifts by whole bar-indices; price shifts by pixels→price (log-safe); volume-
  // pane (paneRelY) points shift by a pixel-fraction. One updateDrawing = one undo step.
  const nudgeRef = useRef(null)
  nudgeRef.current = (dBars, dPx) => {
    if (!selectedId) return
    const sel = drawingsRef.current.find(d => d.id === selectedId)
    if (!sel || sel.locked) return
    const ser = seriesRef?.current
    const H = sizeRef.current.h || 0
    const clamp01 = v => Math.max(0, Math.min(1, v))
    const newPoints = sel.points.map(p => {
      const np = { ...p }
      if (dBars && p.time != null) {
        // Mirror the drag's moveX: honor FUTURE points (past the last candle) so a
        // nudge can push an endpoint into the right-pad instead of clamping at it.
        const _lastIdx = bars.length - 1
        const origIdx = (Number.isFinite(p.futureBars) && p.futureBars > 0)
          ? _lastIdx + p.futureBars
          : nearestIndex(p.time)   // nearest, not exact — mirrors the drag's moveX
        if (origIdx != null) {
          const rawIdx = origIdx + dBars
          if (rawIdx > _lastIdx) {
            np.time = bars[_lastIdx].t
            np.futureBars = Math.min(FUTURE_BARS_CAP, rawIdx - _lastIdx)
          } else {
            np.time = bars[Math.max(0, rawIdx)]?.t ?? p.time
            delete np.futureBars
          }
        }
      }
      if (dPx) {
        if (p.paneRelY != null) {
          np.paneRelY = clamp01(p.paneRelY + (H ? dPx / H : 0))
        } else if (p.price != null) {
          let y = null; try { y = ser?.priceToCoordinate(p.price) } catch { /* disposed */ }
          if (y != null) {
            let npr = null; try { npr = ser?.coordinateToPrice(y + dPx) } catch { /* disposed */ }
            if (npr != null && npr > 0) np.price = npr
          }
        }
      }
      return np
    })
    updateDrawing(selectedId, { points: newPoints })
    requestRedraw()
  }

  // ── Keyboard shortcuts ──
  useEffect(() => {
    if (readOnly) return undefined
    const handler = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return

      if (e.key === 'Escape') {
        if (isDragging) {
          dragRef.current = null
          setIsDragging(false)
        } else if (pendingPoints.length > 0) {
          setPendingPoints([])
        } else if (activeTool) {
          setActiveTool(null)
        } else if (selectedId) {
          setSelectedId(null)
        }
        setTextInput(null)
        e.preventDefault()
      }
      // Undo / redo (Ctrl+Z · Ctrl+Shift+Z / Ctrl+Y). Window-level so it works
      // whether or not a tool is armed. No-op on overlays without history wired.
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        const k = e.key.toLowerCase()
        if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo?.(); return }
        if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo?.(); return }
        // Copy the selected drawing to the module clipboard — but only if the user
        // isn't copying actual page text (let native Ctrl+C win then).
        if (k === 'c' && selectedId && !window.getSelection?.()?.toString()) {
          const sel = drawingsRef.current.find(d => d.id === selectedId)
          if (sel) {
            const { id: _cid, ...rest } = sel
            _drawingClipboard = JSON.parse(JSON.stringify(rest))
            e.preventDefault()
          }
          return
        }
        // Paste an offset clone onto THIS chart (works across symbols/charts).
        if (k === 'v' && _drawingClipboard && (activeTool === 'cursor' || !activeTool)) {
          e.preventDefault()
          const nid = addDrawing({ ..._drawingClipboard, points: offsetPoints(_drawingClipboard.points), locked: false })
          setSelectedId(nid)
          return
        }
      }
      // Delete / Backspace → remove the selected drawing (locked ones are spared).
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedId && (activeTool === 'cursor' || !activeTool)) {
          e.preventDefault()
          const sel = drawingsRef.current.find(d => d.id === selectedId)
          if (!sel?.locked) { removeDrawing(selectedId); setSelectedId(null) }
        }
      }
      // Arrow keys nudge the selected drawing (←/→ = ±1 bar · ↑/↓ = ±1px · Shift = ×10).
      // Gated to THIS chart's focus — body, or focus inside the overlay's DOM subtree —
      // so a drawing selected here never hijacks Watchlists/other-widget arrow navigation.
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        if (selectedId && (activeTool === 'cursor' || !activeTool)) {
          const wrap = canvasRef.current?.parentElement
          const ownFocus = e.target === document.body || (wrap && wrap.contains(e.target))
          const sel = drawingsRef.current.find(d => d.id === selectedId)
          if (ownFocus && !sel?.locked) {
            e.preventDefault()
            const step = e.shiftKey ? 10 : 1
            const dBars = e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0
            const dPx = e.key === 'ArrowDown' ? step : e.key === 'ArrowUp' ? -step : 0
            nudgeRef.current?.(dBars, dPx)
          }
        }
        return
      }
      // Alt+<letter> arms a drawing tool. Alt avoids the bare-letter conflict with
      // type-to-search ticker entry on the charts workspace (bare 't' etc. are
      // swallowed into the symbol box), so tools stay keyboard-reachable there.
      // Keyed on e.code so it's layout-independent and survives Mac's Alt chars.
      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && ALT_TOOL[e.code]) {
        e.preventDefault()
        setActiveTool(ALT_TOOL[e.code])
        return
      }
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.shiftKey && ALT_SHIFT_TOOL[e.code]) {
        e.preventDefault()
        setActiveTool(ALT_SHIFT_TOOL[e.code])
        return
      }
      // Tool shortcuts
      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        switch (e.key.toLowerCase()) {
          case 'v': setActiveTool('cursor'); break
          case 't': setActiveTool('trendline'); break
          case 'h': setActiveTool('horizontal'); break
          case 'r': setActiveTool('rect'); break
          case 'f': if (!e.shiftKey) { setActiveTool('fib'); e.preventDefault() } else { setActiveTool('fibext'); e.preventDefault() } break
          case 'p': if (e.shiftKey) { setActiveTool('pitchfork'); e.preventDefault() } break
          case 'x': setActiveTool('text'); break
          case 'm': setActiveTool('measure'); break
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [activeTool, pendingPoints, selectedId, isDragging, setActiveTool, setSelectedId, removeDrawing, addDrawing, undo, redo, readOnly])

  // Reset pending on tool change
  useEffect(() => {
    setPendingPoints([])
    setMouseCoords(null)
    setTextInput(null)
    dragRef.current = null
    setIsDragging(false)
    setHoverDrawingId(null)
    setHoverActive(false)
  }, [activeTool])

  // ── Text input submit ──
  const handleTextSubmit = (text) => {
    if (!textInput) return
    // Editing an existing note (double-click): update its text; empty leaves it.
    if (textInput.editId) {
      if (text.trim()) updateDrawing(textInput.editId, { text: text.trim() })
      setTextInput(null)
      return
    }
    if (!text.trim()) { setTextInput(null); return }
    addDrawing({
      type: 'text',
      points: [{ time: textInput.time, price: textInput.price, ...(textInput.paneRelY != null ? { paneRelY: textInput.paneRelY } : {}) }],
      color,
      lineWidth,
      text: text.trim(),
      fontSize: fontSize || 13,
    })
    setTextInput(null)
    if (!repeatMode) setActiveTool(null)
  }

  // ── Double-click a text annotation to edit it in place ──
  const handleDoubleClick = (e) => {
    if (activeTool && activeTool !== 'cursor') return   // not while placing new drawings
    const pos = getCanvasPos(e)
    if (!pos) return
    const d = drawings.find(dd => dd.id === hitTestAll(pos.x, pos.y))
    if (d?.type === 'text') {
      setSelectedId(d.id)
      setTextInput({ x: e.clientX, y: e.clientY, editId: d.id, initialValue: d.text || '' })
    }
  }

  // ── Determine cursor ──
  const isDrawingTool = activeTool && activeTool !== 'cursor'
  // Interactive when a tool is armed OR the mouse is hovering a drawing (no-tool
  // direct manipulation). Transparent otherwise so the chart keeps pan/zoom.
  const canvasPointerEvents = (activeTool || hoverActive) ? 'auto' : 'none'
  // When a tool is armed the overlay owns touch input (so taps/drags aren't
  // hijacked by browser scroll/zoom). When no tool is armed the overlay is
  // transparent (pointerEvents:none) and the chart keeps its native pinch/pan.
  const canvasTouchAction = activeTool ? 'none' : 'auto'
  let canvasCursor = 'default'
  if (isDrawingTool) canvasCursor = 'crosshair'
  else if (isDragging) canvasCursor = 'grabbing'
  else if (hoverDrawingId === '__handle__') canvasCursor = 'grab'
  else if (hoverDrawingId) canvasCursor = drawings.find(d => d.id === hoverDrawingId)?.locked ? 'not-allowed' : 'move'
  else if (activeTool === 'cursor') canvasCursor = 'default'

  // Close context menu on any click/tap (pointerdown covers touch + mouse)
  useEffect(() => {
    if (!ctxMenu) return
    const close = () => setCtxMenu(null)
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [ctxMenu])

  return (
    <>
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: canvasPointerEvents,
          touchAction: canvasTouchAction,
          cursor: canvasCursor,
          zIndex: 4,
        }}
        onPointerDown={(e) => { setCtxMenu(null); handlePointerDown(e) }}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onDoubleClick={handleDoubleClick}
        onPointerLeave={() => {
          if (!isDragging) { setMouseCoords(null); setHoverDrawingId(null) }
          requestRedraw()
        }}
      />
      {textInput && (
        <TextInputOverlay
          x={textInput.x}
          y={textInput.y}
          color={color}
          initialValue={textInput.initialValue || ''}
          onSubmit={handleTextSubmit}
          onCancel={() => setTextInput(null)}
        />
      )}
      {ctxMenu && (() => {
        const d = drawings.find(dd => dd.id === ctxMenu.drawingId)
        if (!d) return null
        // On-screen x of a point (later bar index = further right); futureBars
        // pushes a point into the empty right-pad, so it counts toward x.
        const effIdx = (p) => {
          let idx = timeToIndex.get(p.time)
          if (idx == null) idx = nearestIndex(p.time)
          if (idx == null) idx = 0
          return idx + (Number.isFinite(p.futureBars) ? p.futureBars : 0)
        }
        // Index of the left-most (starting) point — the anchor both "Make
        // horizontal" and the "Set level" prefill reference.
        const leftIndexOf = (pts) => {
          let li = 0, lx = Infinity
          pts.forEach((p, i) => { const x = effIdx(p); if (x < lx) { lx = x; li = i } })
          return li
        }
        const pts = d.points || []
        const leftLevel = pts.length ? pts[leftIndexOf(pts)]?.price ?? null : null
        return (
          <DrawingContextMenu
            x={ctxMenu.x}
            y={ctxMenu.y}
            sheet={_COARSE_POINTER}
            drawing={d}
            levelSupported={LEVEL_LINE_TYPES.has(d.type)}
            horizontalSupported={SLOPED_LINE_TYPES.has(d.type) && pts.length >= 2}
            currentLevel={leftLevel}
            onSetLevel={(price) => {
              // Flatten the whole line onto the typed price — a clean horizontal
              // level at exactly the value you want. Clear paneRelY so points
              // re-anchor to the price scale (not a below-pane fraction).
              if (!pts.length) return
              updateDrawing(ctxMenu.drawingId, { points: pts.map(p => ({ ...p, price, paneRelY: null })) })
              setCtxMenu(null)
            }}
            onMakeHorizontal={() => {
              // Snap every point to the left/starting point's current price.
              if (pts.length < 2 || leftLevel == null) return
              updateDrawing(ctxMenu.drawingId, { points: pts.map(p => ({ ...p, price: leftLevel, paneRelY: null })) })
              setCtxMenu(null)
            }}
            onSetColor={(c) => updateDrawing(ctxMenu.drawingId, { color: c })}
            onSetWidth={(w) => updateDrawing(ctxMenu.drawingId, { lineWidth: w })}
            onSetStyle={(s) => updateDrawing(ctxMenu.drawingId, { lineStyle: s })}
            onSetFontSize={(n) => updateDrawing(ctxMenu.drawingId, { fontSize: n })}
            onToggleLock={() => { updateDrawing(ctxMenu.drawingId, { locked: !d.locked }); setCtxMenu(null) }}
            canReorder={!!reorderDrawing && drawings.length > 1}
            onBringFront={() => { reorderDrawing?.(ctxMenu.drawingId, 'front'); setCtxMenu(null) }}
            onSendBack={() => { reorderDrawing?.(ctxMenu.drawingId, 'back'); setCtxMenu(null) }}
            onDuplicate={() => {
              const { id: _id, ...rest } = d
              const nid = addDrawing({ ...rest, points: offsetPoints(d.points), locked: false })
              setSelectedId(nid)
              setCtxMenu(null)
            }}
            onDelete={() => { removeDrawing(ctxMenu.drawingId); setSelectedId(null); setCtxMenu(null) }}
            onSaveDefaults={onSaveDefaults ? (style) => onSaveDefaults(style) : null}
            savedColors={savedColors}
            onSaveColor={onSaveColor}
            onDeleteColor={onDeleteColor}
            onClose={() => setCtxMenu(null)}
          />
        )
      })()}
    </>
  )
}

// ─── Inline text input ──────────────────────────────────────────────────────

function TextInputOverlay({ x, y, color, initialValue = '', onSubmit, onCancel }) {
  const [value, setValue] = useState(initialValue)
  const ref = useRef(null)
  const readyRef = useRef(false)

  useEffect(() => {
    // Focus after a tick to avoid immediate blur from the mousedown that spawned us
    const t = setTimeout(() => {
      ref.current?.focus()
      readyRef.current = true
    }, 50)
    return () => clearTimeout(t)
  }, [])

  const submit = () => {
    if (!readyRef.current) return // ignore blur before we're ready
    onSubmit(value)
  }

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() }
        if (e.key === 'Escape') onCancel()
        e.stopPropagation()
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={submit}
      placeholder="Type note..."
      style={{
        position: 'fixed',
        left: x,
        top: y,
        zIndex: 20,
        minWidth: 160,
        minHeight: 32,
        maxWidth: 320,
        padding: '6px 8px',
        background: 'rgba(26, 28, 23, 0.97)',
        border: `1px solid ${color}`,
        borderRadius: 4,
        boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
        color: '#e2dfd6',
        fontFamily: "'Instrument Sans', sans-serif",
        fontSize: 12,
        lineHeight: 1.4,
        resize: 'both',
        outline: 'none',
      }}
    />
  )
}

// ─── Right-click context menu ───────────────────────────────────────────────

// Drawings store lineStyle as a string ('solid' | 'dashed'); ColorPanel's `line`
// prop uses the numeric code (0 solid / 2 dashed / 1 dotted). Map between them.
const DRAW_STYLE_TO_NUM = { solid: 0, dashed: 2 }
const numToDrawStyle = (n) => (n === 0 ? 'solid' : 'dashed')

// A full-width action row (icon + label), used for Duplicate / Lock / Delete.
function MenuAction({ icon, label, onClick, danger = false, big = false }) {
  // Match the chart right-click menu (ChartsWorkspace .chartCtx*): GOLD icons,
  // white label text, gold-tinted hover that also golds the label. Destructive
  // rows stay red (icon + text) as the one deliberate exception.
  const GOLD = 'var(--menu-accent, var(--ut-gold, #c9a84c))'
  const textBase = danger ? 'var(--color-danger, #ef5350)' : 'var(--menu-text, #ededed)'
  const iconColor = danger ? 'var(--color-danger, #ef5350)' : GOLD
  const hoverBg = danger ? 'rgba(239,83,80,0.14)' : 'var(--menu-accent-bg, rgba(201,168,76,0.12))'
  const sz = big ? 18 : 14
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: big ? 12 : 10, width: '100%',
        padding: big ? '12px 18px' : '9px 11px', minHeight: big ? 44 : undefined, borderRadius: big ? 0 : 6,
        background: 'none', border: 'none', color: textBase,
        cursor: 'pointer', fontFamily: 'inherit', fontSize: big ? 15 : 13, textAlign: 'left',
        transition: 'background 0.1s ease, color 0.1s ease',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = hoverBg; if (!danger) e.currentTarget.style.color = GOLD }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = textBase }}
    >
      <svg viewBox="0 0 16 16" width={sz} height={sz} fill="none" stroke={iconColor} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" style={{ color: iconColor, flexShrink: 0 }}>{icon}</svg>
      {label}
    </button>
  )
}

function DrawingContextMenu({ x, y, sheet = false, drawing, onSetColor, onSetWidth, onSetStyle, onSetFontSize, onDuplicate, onToggleLock, canReorder, onBringFront, onSendBack, onDelete, onSaveDefaults, savedColors = [], onSaveColor, onDeleteColor, onClose, levelSupported = false, horizontalSupported = false, currentLevel = null, onSetLevel, onMakeHorizontal }) {
  const menuRef = useRef(null)
  const [colorOpen, setColorOpen] = useState(false)
  const [levelOpen, setLevelOpen] = useState(false)
  const [levelVal, setLevelVal] = useState('')
  const [savedFlash, setSavedFlash] = useState(false)  // brief "Saved ✓" confirmation
  const openLevel = () => { setLevelVal(fmtLevel(currentLevel)); setLevelOpen(o => !o) }
  const submitLevel = () => { const n = parseFloat(levelVal); if (Number.isFinite(n)) onSetLevel?.(n) }
  // Clamp to the viewport so the menu always lands right next to the cursor —
  // flips to the cursor's left/up edge when it would overflow (drawings near the
  // right edge of a full-width chart otherwise pushed it off-screen). Measured
  // post-render and kept hidden for the first paint so it never flashes far off.
  // (Anchored/desktop only — on touch we dock it to the bottom as a sheet.)
  const [pos, setPos] = useState({ left: x, top: y, ready: sheet })
  useLayoutEffect(() => {
    if (sheet) return
    const el = menuRef.current
    const w = el?.offsetWidth || 180
    const h = el?.offsetHeight || 180
    const M = 8
    let left = x + w > window.innerWidth - M ? x - w : x
    let top = y + h > window.innerHeight - M ? y - h : y
    left = Math.max(M, Math.min(left, window.innerWidth - w - M))
    top = Math.max(M, Math.min(top, window.innerHeight - h - M))
    setPos({ left, top, ready: true })
  }, [x, y, sheet])

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const locked = !!drawing?.locked
  const curColor = drawing?.color || '#c9a84c'
  const curWidth = drawing?.lineWidth || 1
  const dashed = drawing?.lineStyle === 'dashed'
  const isText = drawing?.type === 'text'
  const curFontSize = Math.round(drawing?.fontSize || 13)
  const bumpFont = (delta) => onSetFontSize?.(Math.max(8, Math.min(64, curFontSize + delta)))
  // Place the ColorPanel popout beside the menu (to its right; flip left if it would
  // overflow). ~250px wide panel.
  const panelW = 258
  const menuW = sheet ? window.innerWidth : 210
  const panelLeft = sheet
    ? Math.max(8, (window.innerWidth - panelW) / 2)
    : (pos.left + menuW + panelW + 8 > window.innerWidth ? Math.max(8, pos.left - panelW - 6) : pos.left + menuW)
  const panelTop = sheet ? Math.max(8, window.innerHeight - 470) : Math.min(pos.top, Math.max(8, window.innerHeight - 440))

  // Touch bottom-sheet gets roomier rows + bigger tap targets than the anchored menu.
  const rowStyle = sheet
    ? { display: 'flex', alignItems: 'center', gap: 12, padding: '12px 18px', minHeight: 44 }
    : { display: 'flex', alignItems: 'center', gap: 10, padding: '9px 11px' }
  // "Color" reads like the other item labels (white, 13px) instead of a tiny dim
  // section caption, matching the chart right-click menu.
  const labelStyle = { fontSize: sheet ? 15 : 13, color: 'var(--menu-text, #ededed)', fontWeight: 500 }
  const sw = sheet ? 26 : 15         // color swatch size
  const wBtn = sheet ? 34 : 24       // width-button size

  // Neutral-dark palette shared with the Chart Settings menu (--menu-* tokens).
  const shell = sheet
    ? {
        position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 21,
        background: 'var(--menu-surface, var(--menu-bg, #0e0e10))', borderTop: '1px solid var(--menu-border, #242426)',
        borderTopLeftRadius: 14, borderTopRightRadius: 14,
        boxShadow: '0 -8px 28px rgba(0,0,0,0.55)',
        padding: '6px 0 max(14px, env(safe-area-inset-bottom))',
        color: 'var(--menu-text, #ededed)',
        fontFamily: "'Instrument Sans', sans-serif", fontSize: 13, userSelect: 'none',
      }
    : {
        position: 'fixed', left: pos.left, top: pos.top,
        visibility: pos.ready ? 'visible' : 'hidden', zIndex: 21,
        minWidth: 210, background: 'var(--menu-surface, var(--menu-bg, #0e0e10))', border: '1px solid var(--menu-border, #242426)',
        borderRadius: 10, boxShadow: '0 12px 40px var(--menu-shadow, rgba(0,0,0,0.6))', padding: '5px',
        color: 'var(--menu-text, #ededed)',
        fontFamily: "'Instrument Sans', sans-serif", fontSize: 13, userSelect: 'none',
      }

  const inner = (
    <div
      ref={menuRef}
      onPointerDown={(e) => e.stopPropagation()}
      style={shell}
    >
      {sheet && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '4px 0 8px' }}>
          <div style={{ width: 40, height: 4, borderRadius: 2, background: 'var(--menu-border, #2c2c30)' }} />
        </div>
      )}
      {/* Color & style — one row that opens the shared grid picker (color grid +
          opacity + custom hex + line width + line style), matching Chart Settings. */}
      <button
        onClick={() => setColorOpen(o => !o)}
        style={{
          ...rowStyle, width: '100%', border: 'none', cursor: 'pointer', borderRadius: 6,
          fontFamily: 'inherit', color: 'var(--menu-text, #ededed)', textAlign: 'left',
          background: colorOpen ? 'var(--menu-accent-bg, rgba(201,168,76,0.12))' : 'none',
        }}
        onMouseEnter={(e) => { if (!colorOpen) e.currentTarget.style.background = 'var(--menu-accent-bg, rgba(201,168,76,0.12))' }}
        onMouseLeave={(e) => { if (!colorOpen) e.currentTarget.style.background = 'none' }}
      >
        <span style={labelStyle}>Color</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
          <span style={{ width: sw, height: sw, borderRadius: '50%', background: curColor, border: '1px solid var(--menu-border, #2c2c30)', boxShadow: '0 0 0 1px var(--menu-bg, #0e0e10)' }} />
          <span style={{ display: 'block', width: 22, height: 0, borderTopWidth: Math.max(1, curWidth), borderTopStyle: dashed ? 'dashed' : 'solid', borderTopColor: curColor }} />
          <span style={{ color: 'var(--menu-text-dim, #8a8a8f)', fontSize: sheet ? 13 : 11 }} aria-hidden="true">{colorOpen ? '▾' : '▸'}</span>
        </span>
      </button>

      <div style={{ height: 1, background: 'var(--menu-divider, #202022)', margin: '5px 0' }} />

      {/* Text size — text annotations only. Steps the selected label's font size;
          "Save as default" (below) then persists it as the size for NEW text. */}
      {isText && onSetFontSize && (
        <>
          <div style={{ ...rowStyle }}>
            <span style={labelStyle}>Text size</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }} onPointerDown={(e) => e.stopPropagation()}>
              <button
                onClick={() => bumpFont(-1)}
                title="Smaller"
                aria-label="Smaller text"
                style={{
                  width: sheet ? 34 : 24, height: sheet ? 34 : 24, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  border: '1px solid var(--menu-border, #2c2c30)', borderRadius: 6, background: 'var(--menu-bg, #0e0e10)',
                  color: 'var(--menu-text, #ededed)', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700, lineHeight: 1, fontSize: sheet ? 12 : 10,
                }}
              >A−</button>
              <span style={{ minWidth: 26, textAlign: 'center', color: 'var(--menu-text-dim, #8a8a8f)', fontSize: sheet ? 14 : 12, fontVariantNumeric: 'tabular-nums' }}>{curFontSize}</span>
              <button
                onClick={() => bumpFont(1)}
                title="Bigger"
                aria-label="Bigger text"
                style={{
                  width: sheet ? 34 : 24, height: sheet ? 34 : 24, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  border: '1px solid var(--menu-border, #2c2c30)', borderRadius: 6, background: 'var(--menu-bg, #0e0e10)',
                  color: 'var(--menu-text, #ededed)', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700, lineHeight: 1, fontSize: sheet ? 16 : 13,
                }}
              >A+</button>
            </span>
          </div>
          <div style={{ height: 1, background: 'var(--menu-divider, #202022)', margin: '5px 0' }} />
        </>
      )}

      {levelSupported && (
        <>
          <MenuAction
            label="Set level…"
            onClick={openLevel}
            big={sheet}
            icon={<><line x1="2" y1="8" x2="14" y2="8" strokeDasharray="2 2" /><circle cx="8" cy="8" r="1.7" fill="currentColor" stroke="none" /></>}
          />
          {levelOpen && (
            <div style={{ display: 'flex', gap: 6, padding: sheet ? '2px 18px 12px' : '2px 12px 8px' }} onPointerDown={(e) => e.stopPropagation()}>
              <input
                type="number"
                inputMode="decimal"
                step="any"
                autoFocus
                value={levelVal}
                onChange={(e) => setLevelVal(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); submitLevel() }
                  else if (e.key === 'Escape') { e.preventDefault(); setLevelOpen(false) }
                  e.stopPropagation()
                }}
                placeholder="Price…"
                style={{
                  flex: 1, minWidth: 0, padding: sheet ? '9px 10px' : '5px 8px',
                  background: 'var(--menu-bg, #0e0e10)', border: '1px solid var(--menu-border, #2c2c30)',
                  borderRadius: 6, color: 'var(--menu-text, #ededed)', fontFamily: 'inherit',
                  fontSize: sheet ? 14 : 12, outline: 'none',
                }}
              />
              <button
                onClick={submitLevel}
                style={{
                  padding: sheet ? '0 16px' : '0 11px', minHeight: sheet ? 40 : undefined,
                  background: 'var(--menu-accent-bg, rgba(240,178,58,0.14))', border: '1px solid var(--menu-border, #2c2c30)',
                  borderRadius: 6, color: 'var(--menu-text, #ededed)', cursor: 'pointer',
                  fontFamily: 'inherit', fontSize: sheet ? 14 : 12, fontWeight: 600,
                }}
              >Set</button>
            </div>
          )}
        </>
      )}
      {horizontalSupported && (
        <MenuAction
          label="Make horizontal"
          onClick={onMakeHorizontal}
          big={sheet}
          icon={<><line x1="2" y1="11" x2="14" y2="11" /><line x1="2.5" y1="5" x2="9.5" y2="5" opacity="0.45" strokeDasharray="2 2" transform="rotate(-14 2.5 5)" /></>}
        />
      )}
      {(levelSupported || horizontalSupported) && (
        <div style={{ height: 1, background: 'var(--menu-divider, #202022)', margin: '5px 0' }} />
      )}

      <MenuAction
        label="Duplicate"
        onClick={onDuplicate}
        big={sheet}
        icon={<><rect x="3" y="3" width="8" height="8" rx="1" /><rect x="5.5" y="5.5" width="8" height="8" rx="1" /></>}
      />
      <MenuAction
        label={locked ? 'Unlock' : 'Lock'}
        onClick={onToggleLock}
        big={sheet}
        icon={locked
          ? <><rect x="3" y="7.5" width="10" height="6.5" rx="1" /><path d="M5 7.5V5a3 3 0 0 1 5.7-1.2" /></>
          : <><rect x="3" y="7.5" width="10" height="6.5" rx="1" /><path d="M5 7.5V5a3 3 0 0 1 6 0v2.5" /></>}
      />
      {onSaveDefaults && (
        <MenuAction
          label={savedFlash ? 'Saved as default ✓' : 'Save as default'}
          onClick={() => {
            onSaveDefaults({ color: curColor, width: curWidth, style: drawing?.lineStyle || 'solid', ...(isText ? { fontSize: curFontSize } : {}) })
            setSavedFlash(true); setTimeout(() => setSavedFlash(false), 1400)
          }}
          big={sheet}
          icon={<path d="M8 2.3l1.72 3.49 3.85.56-2.79 2.72.66 3.84L8 11.37 4.56 13.19l.66-3.84L2.43 6.35l3.85-.56z" />}
        />
      )}
      <MenuAction
        label="Delete Drawing"
        onClick={onDelete}
        danger
        big={sheet}
        icon={<><polyline points="3,5 4,14 12,14 13,5" /><line x1="2" y1="5" x2="14" y2="5" /><line x1="6" y1="3" x2="10" y2="3" /><line x1="7" y1="7" x2="7" y2="12" /><line x1="9" y1="7" x2="9" y2="12" /></>}
      />

      {colorOpen && createPortal(
        <div
          data-color-panel
          onPointerDown={(e) => e.stopPropagation()}
          style={{ position: 'fixed', left: panelLeft, top: panelTop, zIndex: 22 }}
        >
          <ColorPanel
            title="Drawing"
            value={curColor}
            onChange={(hex) => onSetColor(hex)}
            onClose={() => setColorOpen(false)}
            savedColors={savedColors}
            onSaveColor={onSaveColor}
            onDeleteColor={onDeleteColor}
            line={{
              width: curWidth,
              style: DRAW_STYLE_TO_NUM[drawing?.lineStyle] ?? 0,
              onWidth: (w) => onSetWidth(w),
              onStyle: (n) => onSetStyle(numToDrawStyle(n)),
            }}
          />
        </div>,
        document.body,
      )}
    </div>
  )

  // Anchored menu on desktop; on touch, dock as a bottom-sheet behind a dimming
  // backdrop (tap the backdrop to dismiss). The window-level pointerdown closer
  // still fires, but the backdrop makes the touch dismiss target obvious + big.
  if (!sheet) return inner
  return (
    <div
      onPointerDown={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 20, background: 'rgba(0,0,0,0.35)' }}
    >
      {inner}
    </div>
  )
}
