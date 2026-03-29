// app/src/components/chart/ChartDrawingOverlay.jsx — Canvas overlay for chart annotations
import { useEffect, useRef, useState, useCallback, useMemo } from 'react'

// ─── Tool definitions ────────────────────────────────────────────────────────
const POINT_COUNT = {
  trendline: 2, ray: 2, extended: 2, horizontal: 1, hray: 1, vertical: 1,
  rect: 2, circle: 2, arrow: 2, text: 1, fib: 2, channel: 3, measure: 2, avwap: 1,
}

const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1]
const FIB_COLORS = ['#ef4444', '#fb923c', '#c9a84c', '#a8a290', '#4ade80', '#60a5fa', '#a78bfa']
const HIT_THRESHOLD = 8 // pixels

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

function renderHorizontal(ctx, pts, w) {
  if (!pts.length) return
  ctx.beginPath()
  ctx.moveTo(0, pts[0].y)
  ctx.lineTo(w, pts[0].y)
  ctx.stroke()
  // Price label
  if (pts[0].price != null) {
    const label = pts[0].price.toFixed(2)
    ctx.font = '10px "IBM Plex Mono", monospace'
    ctx.fillStyle = ctx.strokeStyle
    ctx.fillText(label, w - ctx.measureText(label).width - 4, pts[0].y - 4)
  }
}

function renderHRay(ctx, pts, w) {
  if (!pts.length) return
  const x = pts[0].x ?? 0
  ctx.beginPath()
  ctx.moveTo(x, pts[0].y)
  ctx.lineTo(w, pts[0].y)
  ctx.stroke()
  // Price label
  if (pts[0].price != null) {
    const label = pts[0].price.toFixed(2)
    ctx.font = '10px "IBM Plex Mono", monospace'
    ctx.fillStyle = ctx.strokeStyle
    ctx.fillText(label, w - ctx.measureText(label).width - 4, pts[0].y - 4)
  }
  // Small anchor dot at origin
  ctx.beginPath()
  ctx.arc(x, pts[0].y, 3, 0, Math.PI * 2)
  ctx.fillStyle = ctx.strokeStyle
  ctx.fill()
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

function renderText(ctx, pts, drawing) {
  if (!pts.length || !drawing.text) return
  ctx.font = `${drawing.fontSize || 13}px "IBM Plex Mono", monospace`
  ctx.fillStyle = ctx.strokeStyle
  const lines = drawing.text.split('\n')
  lines.forEach((line, i) => {
    ctx.fillText(line, pts[0].x, pts[0].y + (i + 1) * (drawing.fontSize || 13) * 1.3)
  })
}

function renderFib(ctx, pts, w, toPixel) {
  if (pts.length < 2) return
  const highPrice = Math.max(pts[0].rawPrice, pts[1].rawPrice)
  const lowPrice = Math.min(pts[0].rawPrice, pts[1].rawPrice)
  const range = highPrice - lowPrice
  if (range <= 0) return

  ctx.font = '10px "IBM Plex Mono", monospace'
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

function renderMeasure(ctx, pts, drawing) {
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
    ctx.font = 'bold 11px "IBM Plex Mono", monospace'
    ctx.fillStyle = ctx.strokeStyle
    ctx.textAlign = 'center'
    const line1 = `${diff >= 0 ? '+' : ''}${diff.toFixed(2)} (${diff >= 0 ? '+' : ''}${pct}%)`
    const line2 = bars ? `${bars} bars` : ''
    ctx.fillText(line1, cx, cy - 4)
    if (line2) ctx.fillText(line2, cx, cy + 12)
    ctx.textAlign = 'start'
  }
}

function renderAnchoredVwap(ctx, anchorPt, bars, timeToIndex, toPixelFn) {
  if (!anchorPt || anchorPt.x == null) return
  const anchorIdx = timeToIndex.get(anchorPt.time)
  if (anchorIdx == null || !bars?.length) return

  let cumPV = 0, cumV = 0
  const points = []

  for (let i = anchorIdx; i < bars.length; i++) {
    const b = bars[i]
    const tp = (b.h + b.l + b.c) / 3
    const vol = b.v || 0
    cumPV += tp * vol
    cumV += vol
    if (cumV === 0) continue
    const vwap = cumPV / cumV
    const px = toPixelFn(b.t, vwap)
    if (px?.x != null && px?.y != null) {
      points.push({ x: px.x, y: px.y })
    }
  }

  if (points.length < 2) return

  // Draw VWAP line
  ctx.beginPath()
  ctx.moveTo(points[0].x, points[0].y)
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y)
  }
  ctx.stroke()

  // Price label at end
  const last = points[points.length - 1]
  const lastVwap = cumV > 0 ? cumPV / cumV : 0
  ctx.font = '10px "IBM Plex Mono", monospace'
  ctx.fillStyle = ctx.strokeStyle
  ctx.fillText(`VWAP ${lastVwap.toFixed(2)}`, last.x + 6, last.y - 4)

  // Anchor dot
  ctx.beginPath()
  ctx.arc(anchorPt.x, anchorPt.y, 4, 0, Math.PI * 2)
  ctx.fillStyle = ctx.strokeStyle
  ctx.fill()

  // "A" label at anchor
  ctx.font = 'bold 9px "IBM Plex Mono", monospace'
  ctx.fillText('A', anchorPt.x - 3, anchorPt.y - 8)
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
    ctx.font = '10px "IBM Plex Mono", monospace'
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
    case 'fib':
      if (pts.length < 2) return false
      return mx >= 0 && mx <= w && Math.abs(my - pts[0].y) < HIT_THRESHOLD * 2 || Math.abs(my - pts[1].y) < HIT_THRESHOLD * 2
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
  drawings, addDrawing, updateDrawing, removeDrawing,
  selectedId, setSelectedId,
}) {
  const canvasRef = useRef(null)
  const [pendingPoints, setPendingPoints] = useState([])
  const [mouseCoords, setMouseCoords] = useState(null)
  const [textInput, setTextInput] = useState(null)
  const [ctxMenu, setCtxMenu] = useState(null) // { x, y, drawingId }
  const rafRef = useRef(null)
  const sizeRef = useRef({ w: 0, h: 0 })
  const redrawRef = useRef(null)

  // ── Drag state ──
  // { drawingId, handleIdx (null=whole, 0/1/2=specific point), startPixel, originalPoints }
  const dragRef = useRef(null)
  const [isDragging, setIsDragging] = useState(false)
  const [hoverDrawingId, setHoverDrawingId] = useState(null)

  // ── Time → bar index lookup ──
  const timeToIndex = useMemo(() => {
    const map = new Map()
    bars?.forEach((b, i) => map.set(b.t, i))
    return map
  }, [bars])

  // ── Coordinate conversion: chart → pixel ──
  // Uses refs at call-time so always gets latest chart/series
  const toPixel = useCallback((time, price) => {
    const chart = chartRef?.current
    const series = seriesRef?.current
    if (!chart || !series) return null
    let x = null
    if (time != null) {
      try { x = chart.timeScale().timeToCoordinate(time) } catch {}
      // Fallback: extrapolate from logical index
      if (x == null && bars?.length) {
        const idx = timeToIndex.get(time)
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
  }, [chartRef, seriesRef, bars, timeToIndex])

  // Helper: convert to pixel, returning { x, y, rawPrice } with nulls handled
  const resolvePixels = useCallback((points) => {
    return points.map(p => {
      const px = toPixel(p.time, p.price)
      return { x: px?.x, y: px?.y, rawPrice: p.price, price: p.price, time: p.time }
    }).filter(p => p.x != null || p.y != null)
  }, [toPixel])

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

    // Allow partial coords: horizontal only needs price, vertical only needs time
    if (!time && !price) return null
    return { time, price }
  }, [chartRef, seriesRef, bars])

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

  // ── Poll for chart scroll/zoom changes (robust, avoids subscription timing) ──
  useEffect(() => {
    let lastRangeKey = null
    const interval = setInterval(() => {
      const chart = chartRef?.current
      if (!chart) return
      try {
        const range = chart.timeScale().getVisibleLogicalRange()
        const key = range ? `${range.from.toFixed(2)}-${range.to.toFixed(2)}` : null
        if (key !== lastRangeKey) {
          lastRangeKey = key
          redrawRef.current?.()
        }
      } catch {}
    }, 60) // ~16fps polling for scroll
    return () => clearInterval(interval)
  }, [chartRef])

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

    const toPixelY = (_, price) => {
      const p = toPixel(null, price)
      return p?.y
    }

    // Draw completed drawings
    for (const d of drawings) {
      const pts = resolvePixels(d.points || [])
      if (!pts.length) continue
      ctx.save()
      ctx.strokeStyle = d.color || '#c9a84c'
      ctx.lineWidth = d.lineWidth || 1
      ctx.setLineDash([])

      switch (d.type) {
        case 'trendline': renderTrendline(ctx, pts); break
        case 'ray': renderRay(ctx, pts, w, h); break
        case 'extended': renderExtended(ctx, pts, w, h); break
        case 'horizontal': renderHorizontal(ctx, pts, w); break
        case 'hray': renderHRay(ctx, pts, w); break
        case 'vertical': renderVertical(ctx, pts, h); break
        case 'rect': renderRect(ctx, pts); break
        case 'circle': renderCircle(ctx, pts); break
        case 'arrow': renderArrow(ctx, pts); break
        case 'text': renderText(ctx, pts, d); break
        case 'fib': renderFib(ctx, pts, w, toPixelY); break
        case 'channel': renderChannel(ctx, pts, w, h); break
        case 'measure': renderMeasure(ctx, pts, d); break
        case 'avwap': renderAnchoredVwap(ctx, pts[0], bars, timeToIndex, toPixel); break
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
          case 'channel': renderChannel(ctx, previewPts, w, h); break
          case 'measure': {
            const md = {
              barCount: pendingPoints[0] && mouseCoords
                ? Math.abs((timeToIndex.get(mouseCoords.time) || 0) - (timeToIndex.get(pendingPoints[0].time) || 0))
                : 0
            }
            renderMeasure(ctx, previewPts, md)
            break
          }
          case 'avwap': renderAnchoredVwap(ctx, previewPts[0], bars, timeToIndex, toPixel); break
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
  }, [drawings, pendingPoints, mouseCoords, activeTool, color, lineWidth, selectedId, toPixel, resolvePixels, timeToIndex])

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
  const hitTestAll = useCallback((mx, my) => {
    const { w, h } = sizeRef.current
    for (let i = drawings.length - 1; i >= 0; i--) {
      const d = drawings[i]
      const pts = resolvePixels(d.points || [])
      if (hitTestDrawing(d, pts, mx, my, w, h)) return d.id
    }
    return null
  }, [drawings, resolvePixels])

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
  const handleMouseDown = useCallback((e) => {
    if (e.button !== 0) return

    const pos = getCanvasPos(e)
    if (!pos) return
    const coords = toChart(pos.x, pos.y)

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
      setTextInput({ x: e.clientX, y: e.clientY, canvasX: pos.x, canvasY: pos.y, time: coords.time, price: coords.price })
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
        }
        if (activeTool === 'measure' && newPending.length >= 2) {
          const idx0 = timeToIndex.get(newPending[0].time) || 0
          const idx1 = timeToIndex.get(newPending[newPending.length - 1].time) || 0
          drawingData.barCount = Math.abs(idx1 - idx0)
        }
        addDrawing(drawingData)
        setPendingPoints([])
      } else {
        setPendingPoints(newPending)
      }
    }
  }, [activeTool, pendingPoints, color, lineWidth, toChart, addDrawing, setSelectedId, timeToIndex, drawings, hitTestAll, hitTestHandle])

  const handleMouseMove = useCallback((e) => {
    const pos = getCanvasPos(e)
    if (!pos) return
    const coords = toChart(pos.x, pos.y)

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

      let newPoints
      if (drag.handleIdx != null) {
        // Move single control point
        newPoints = drag.originalPoints.map((p, i) => {
          if (i !== drag.handleIdx) return p
          const origIdx = timeToIndex.get(p.time) ?? 0
          const newIdx = Math.max(0, Math.min(bars.length - 1, origIdx + timeDelta))
          return {
            time: bars[newIdx]?.t || p.time,
            price: p.price + priceDelta,
          }
        })
      } else {
        // Move entire drawing
        newPoints = drag.originalPoints.map(p => {
          const origIdx = timeToIndex.get(p.time) ?? 0
          const newIdx = Math.max(0, Math.min(bars.length - 1, origIdx + timeDelta))
          return {
            time: bars[newIdx]?.t || p.time,
            price: p.price + priceDelta,
          }
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

    // Standard preview for drawing tools
    setMouseCoords(coords)
    requestRedraw()
  }, [activeTool, isDragging, toChart, requestRedraw, drawings, timeToIndex, bars, updateDrawing, hitTestAll, hitTestHandle])

  const handleMouseUp = useCallback(() => {
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
          case 'f': if (!e.shiftKey) { setActiveTool('fib'); e.preventDefault() } break
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
      points: [{ time: textInput.time, price: textInput.price }],
      color,
      lineWidth,
      text: text.trim(),
      fontSize: 13,
    })
    setTextInput(null)
  }

  // ── Determine cursor ──
  const isDrawingTool = activeTool && activeTool !== 'cursor'
  const canvasPointerEvents = activeTool ? 'auto' : 'none'
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

  // Close context menu on any click
  useEffect(() => {
    if (!ctxMenu) return
    const close = () => setCtxMenu(null)
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [ctxMenu])

  return (
    <>
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: canvasPointerEvents,
          cursor: canvasCursor,
          zIndex: 4,
        }}
        onMouseDown={(e) => { setCtxMenu(null); handleMouseDown(e) }}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onContextMenu={handleContextMenu}
        onMouseLeave={() => {
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
      onMouseDown={(e) => e.stopPropagation()}
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
        fontFamily: "'IBM Plex Mono', monospace",
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
      onMouseDown={(e) => e.stopPropagation()}
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
        fontFamily: "'IBM Plex Mono', monospace",
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
