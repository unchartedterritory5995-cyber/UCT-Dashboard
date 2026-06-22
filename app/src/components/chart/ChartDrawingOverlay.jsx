// app/src/components/chart/ChartDrawingOverlay.jsx — Canvas overlay for chart annotations
import { useEffect, useRef, useState, useCallback, useMemo } from 'react'

// ─── Tool definitions ────────────────────────────────────────────────────────
const POINT_COUNT = {
  trendline: 2, ray: 2, extended: 2, horizontal: 1, hray: 1, vertical: 1,
  rect: 2, circle: 2, arrow: 2, text: 1, fib: 2, fibext: 2, channel: 3, measure: 2, avwap: 1,
  pitchfork: 3, advance: 2,
}

const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1]
const FIB_COLORS = ['#ef4444', '#fb923c', '#c9a84c', '#a8a290', '#4ade80', '#60a5fa', '#a78bfa']

const FIB_EXT_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.272, 1.618, 2, 2.618]
const FIB_EXT_COLORS = ['#ef4444', '#fb923c', '#c9a84c', '#a8a290', '#4ade80', '#60a5fa', '#a78bfa', '#e879f9', '#f472b6', '#22d3ee', '#818cf8']
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
    ctx.font = 'bold 11px "Instrument Sans", sans-serif'
    ctx.fillStyle = ctx.strokeStyle
    ctx.textAlign = 'center'
    if (pctOnly) {
      // Just the % move — for marking the size of an index correction.
      ctx.fillText(`${diff >= 0 ? '+' : ''}${pct}%`, cx, cy + 4)
    } else {
      const line1 = `${diff >= 0 ? '+' : ''}${diff.toFixed(2)} (${diff >= 0 ? '+' : ''}${pct}%)`
      const line2 = bars ? `${bars} bars` : ''
      ctx.fillText(line1, cx, cy - 4)
      if (line2) ctx.fillText(line2, cx, cy + 12)
    }
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
  // Price label
  if (price != null) {
    ctx.font = '10px "Instrument Sans", sans-serif'
    ctx.fillStyle = '#c9a84c'
    ctx.fillText(`$${price.toFixed(2)}`, x + 8, y - 6)
  }
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
    case 'measure': {
      if (pts.length < 2) return false
      const bx1 = Math.min(pts[0].x, pts[1].x), by1 = Math.min(pts[0].y, pts[1].y)
      const bx2 = Math.max(pts[0].x, pts[1].x), by2 = Math.max(pts[0].y, pts[1].y)
      return mx >= bx1 && mx <= bx2 && my >= by1 && my <= by2
    }
    case 'avwap':
      return pts.length >= 1 && Math.hypot(mx - pts[0].x, my - pts[0].y) < HIT_THRESHOLD * 2
    default: return false
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function ChartDrawingOverlay({
  chartRef, seriesRef, bars,
  activeTool, setActiveTool,
  color, lineWidth,
  lineStyle = 'solid',
  magnet = false,
  drawings, addDrawing, updateDrawing, removeDrawing,
  onMigrate = null,          // (drawings[]) => void — re-anchor legacy volume-pane points to paneRelY (called once when the view settles)
  selectedId, setSelectedId,
  repeatMode = true,
  hidePriceLabels = false,   // Model Book setup hrays: line only, no price label
  measurePctOnly = false,    // Model Book index pane: measure label shows ONLY the % move (drop the $ amount + bar count)
  lineData = null,           // Model Book index pane: [{time, value}] of the underlying LINE series. When set the overlay is in "line mode" — magnet snaps to the line, and the advance % is computed from the line values (not candle O/H) since the pane has no candles.
  fontSize = 13,             // default size for new text annotations
  textFadeRef = null,        // 0..1 opacity for text annotations (Model Book focus-zoom fade); null = always visible
  fadeWholeLayer = false,    // Model Book "show all" OFF: fade the WHOLE layer (lines + text) with the zoom, not just text
}) {
  const canvasRef = useRef(null)
  const [pendingPoints, setPendingPoints] = useState([])
  const [mouseCoords, setMouseCoords] = useState(null)
  const [textInput, setTextInput] = useState(null)
  const [ctxMenu, setCtxMenu] = useState(null) // { x, y, drawingId }
  const rafRef = useRef(null)
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
  const [isDragging, setIsDragging] = useState(false)
  const [hoverDrawingId, setHoverDrawingId] = useState(null)

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

  // ── Coordinate conversion: chart → pixel ──
  // Uses refs at call-time so always gets latest chart/series
  const toPixel = useCallback((time, price) => {
    const chart = chartRef?.current
    const series = seriesRef?.current
    if (!chart || !series) return null
    let x = null
    if (time != null) {
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
      try { y = series.priceToCoordinate(price) } catch {}
    }
    return { x, y }
  }, [chartRef, seriesRef, bars, nearestIndex])

  // Helper: convert to pixel, returning { x, y, rawPrice } with nulls handled.
  // A point with `paneRelY` (placed below the price pane — see toChart) is
  // anchored to a fraction of the canvas height, NOT the candle price scale, so
  // it stays in the volume pane across a Setup⇄Result rescale.
  const resolvePixels = useCallback((points) => {
    const H = sizeRef.current.h || 0
    return points.map(p => {
      const px = toPixel(p.time, p.price)
      const y = (p.paneRelY != null && H) ? p.paneRelY * H : px?.y
      return { x: px?.x, y, rawPrice: p.price, price: p.price, time: p.time }
    }).filter(p => p.x != null || p.y != null)
  }, [toPixel])

  // Bottom edge (CSS px) of the price pane = pane-0 height. Annotations below it
  // live in the volume (or index) pane, which the candle price scale doesn't map.
  const pricePaneBottomPx = useCallback(() => {
    try { const h = seriesRef?.current?.getPane?.()?.getHeight?.(); if (h > 0) return h } catch { /* older API */ }
    try { const h = chartRef?.current?.panes?.()?.[0]?.getHeight?.(); if (h > 0) return h } catch { /* older API */ }
    return null
  }, [chartRef, seriesRef])

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
    // Method 1: try coordinateToLogical (LWC v5)
    try {
      const logical = chart.timeScale().coordinateToLogical(pixelX)
      if (logical != null) {
        const idx = Math.max(0, Math.min(bars.length - 1, Math.round(logical)))
        time = bars[idx].t
      }
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
            const logical = Math.ceil(range.from) + (pixelX - startX) / pxPerBar
            const idx = Math.max(0, Math.min(bars.length - 1, Math.round(logical)))
            time = bars[idx].t
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
    return paneRelY != null ? { time, price, paneRelY } : { time, price }
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

    // Draw completed drawings
    for (const d of drawings) {
      // AVWAP uses time-based lookup, doesn't need resolved pixels to render
      if (d.type === 'avwap' && d.points?.[0]?.time != null) {
        ctx.save()
        ctx.strokeStyle = d.color || '#c9a84c'
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
      ctx.strokeStyle = d.color || '#c9a84c'
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
          renderHRay(ctx, pts, hrayRight, !hidePriceLabels)
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
        case 'measure': renderMeasure(ctx, pts, d, measurePctOnly); break
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
        ctx.strokeStyle = color
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
          case 'measure': {
            const md = {
              barCount: pendingPoints[0] && mouseCoords
                ? Math.abs((timeToIndex.get(mouseCoords.time) || 0) - (timeToIndex.get(pendingPoints[0].time) || 0))
                : 0
            }
            renderMeasure(ctx, previewPts, md, measurePctOnly)
            break
          }
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
  }, [drawings, pendingPoints, mouseCoords, activeTool, color, lineWidth, selectedId, toPixel, resolvePixels, timeToIndex, nearestIndex])

  // Keep redrawRef in sync — always points to latest redraw
  redrawRef.current = redraw

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

    // ── CURSOR MODE: select + drag ──
    if (activeTool === 'cursor') {
      // Check handle drag first (move individual control point)
      const handle = hitTestHandle(pos.x, pos.y)
      if (handle) {
        const d = drawings.find(d => d.id === handle.drawingId)
        if (d) {
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
          dragRef.current = {
            drawingId: hitId,
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
        if (activeTool === 'measure' && newPending.length >= 2) {
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
  }, [activeTool, pendingPoints, color, lineWidth, lineStyle, toChart, snap, addDrawing, setSelectedId, timeToIndex, bars, lineData, drawings, hitTestAll, hitTestHandle, repeatMode, isDragging])

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

      // Compute delta in chart coordinates
      const timeDelta = coords.time && drag.startCoords.time
        ? (timeToIndex.get(coords.time) || 0) - (timeToIndex.get(drag.startCoords.time) || 0)
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

      let newPoints
      if (drag.handleIdx != null) {
        // Move single control point
        newPoints = drag.originalPoints.map((p, i) => {
          if (i !== drag.handleIdx) return p
          const origIdx = timeToIndex.get(p.time) ?? 0
          const newIdx = Math.max(0, Math.min(bars.length - 1, origIdx + timeDelta))
          return { time: bars[newIdx]?.t || p.time, ...moveY(p) }
        })
      } else {
        // Move entire drawing
        newPoints = drag.originalPoints.map(p => {
          const origIdx = timeToIndex.get(p.time) ?? 0
          const newIdx = Math.max(0, Math.min(bars.length - 1, origIdx + timeDelta))
          return { time: bars[newIdx]?.t || p.time, ...moveY(p) }
        })
      }

      // Live update — write to state for immediate visual feedback
      updateDrawing(drag.drawingId, { points: newPoints })
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
  }, [activeTool, isDragging, toChart, snap, requestRedraw, drawings, timeToIndex, bars, updateDrawing, hitTestAll, hitTestHandle])

  const handlePointerUp = useCallback((e) => {
    if (e?.pointerId != null) activePointersRef.current.delete(e.pointerId)
    if (longPressRef.current) { clearTimeout(longPressRef.current); longPressRef.current = null }
    if (isDragging) {
      dragRef.current = null
      setIsDragging(false)
    }
  }, [isDragging])

  // ── Hit test all drawings ── (already defined above)

  // ── Keyboard shortcuts ──
  useEffect(() => {
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
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedId && (activeTool === 'cursor' || !activeTool)) {
          e.preventDefault()
        }
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
  }, [activeTool, pendingPoints, selectedId, isDragging, setActiveTool, setSelectedId])

  // Reset pending on tool change
  useEffect(() => {
    setPendingPoints([])
    setMouseCoords(null)
    setTextInput(null)
    dragRef.current = null
    setIsDragging(false)
    setHoverDrawingId(null)
  }, [activeTool])

  // ── Text input submit ──
  const handleTextSubmit = (text) => {
    if (!textInput || !text.trim()) { setTextInput(null); return }
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

  // ── Determine cursor ──
  const isDrawingTool = activeTool && activeTool !== 'cursor'
  const canvasPointerEvents = activeTool ? 'auto' : 'none'
  // When a tool is armed the overlay owns touch input (so taps/drags aren't
  // hijacked by browser scroll/zoom). When no tool is armed the overlay is
  // transparent (pointerEvents:none) and the chart keeps its native pinch/pan.
  const canvasTouchAction = activeTool ? 'none' : 'auto'
  let canvasCursor = 'default'
  if (isDrawingTool) canvasCursor = 'crosshair'
  else if (isDragging) canvasCursor = 'grabbing'
  else if (hoverDrawingId === '__handle__') canvasCursor = 'grab'
  else if (hoverDrawingId) canvasCursor = 'move'
  else if (activeTool === 'cursor') canvasCursor = 'default'

  // ── Right-click context menu ──
  const handleContextMenu = useCallback((e) => {
    const pos = getCanvasPos(e)
    if (!pos) return
    const hitId = hitTestAll(pos.x, pos.y)
    if (hitId) {
      e.preventDefault()
      e.stopPropagation()
      setSelectedId(hitId)
      setCtxMenu({ x: e.clientX, y: e.clientY, drawingId: hitId })
    }
  }, [hitTestAll, setSelectedId])

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
        onContextMenu={handleContextMenu}
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
          onSubmit={handleTextSubmit}
          onCancel={() => setTextInput(null)}
        />
      )}
      {ctxMenu && (
        <DrawingContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          onDelete={() => { removeDrawing(ctxMenu.drawingId); setSelectedId(null); setCtxMenu(null) }}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </>
  )
}

// ─── Inline text input ──────────────────────────────────────────────────────

function TextInputOverlay({ x, y, color, onSubmit, onCancel }) {
  const [value, setValue] = useState('')
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

function DrawingContextMenu({ x, y, onDelete, onClose }) {
  const menuRef = useRef(null)

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div
      ref={menuRef}
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        position: 'fixed',
        left: x,
        top: y,
        zIndex: 20,
        minWidth: 140,
        background: '#1a1c17',
        border: '1px solid #2e3127',
        borderRadius: 4,
        boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
        padding: '3px 0',
        fontFamily: "'Instrument Sans', sans-serif",
        fontSize: 11,
      }}
    >
      <button
        onClick={onDelete}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          width: '100%',
          padding: '6px 12px',
          background: 'none',
          border: 'none',
          color: '#ef4444',
          cursor: 'pointer',
          fontFamily: 'inherit',
          fontSize: 'inherit',
          textAlign: 'left',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(239,68,68,0.12)' }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'none' }}
      >
        <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="3,5 4,14 12,14 13,5" /><line x1="2" y1="5" x2="14" y2="5" /><line x1="6" y1="3" x2="10" y2="3" /><line x1="7" y1="7" x2="7" y2="12" /><line x1="9" y1="7" x2="9" y2="12" />
        </svg>
        Delete Drawing
      </button>
    </div>
  )
}
