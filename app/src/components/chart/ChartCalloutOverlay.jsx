import { useRef, useEffect, useCallback } from 'react'

// Renders text callouts (Model Book catalysts) AmiBroker-style: each label sits
// in open space above its candle with a thin diagonal leader line back to the
// candle's high, so labels never cover candles. Read-only, pointer-transparent.

const toMs = (v) => {
  const s = String(v)
  return Date.parse(s.length <= 10 ? `${s}T00:00:00Z` : s)
}

export default function ChartCalloutOverlay({ chartRef, seriesRef, bars, callouts, color = '#ffffff' }) {
  const canvasRef = useRef(null)
  const rafRef = useRef(null)
  const sizeRef = useRef({ w: 0, h: 0 })
  const redrawRef = useRef(null)

  // Nearest bar index for a date string (exact on daily; closest week on weekly).
  const barIndexForDate = useCallback((dateStr) => {
    if (!bars || !bars.length) return -1
    const target = toMs(dateStr)
    if (Number.isNaN(target)) return -1
    let best = -1, bestDiff = Infinity
    for (let i = 0; i < bars.length; i++) {
      const d = Math.abs(toMs(bars[i].t) - target)
      if (d < bestDiff) { bestDiff = d; best = i }
    }
    return best
  }, [bars])

  const redraw = useCallback(() => {
    const canvas = canvasRef.current
    const chart = chartRef?.current
    const series = seriesRef?.current
    if (!canvas || !chart || !series) return
    const ctx = canvas.getContext('2d')
    const dpr = window.devicePixelRatio || 1
    const { w, h } = sizeRef.current
    if (!w || !h) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    if (!callouts || !callouts.length) return

    const ts = chart.timeScale()
    const font = '600 11px "Instrument Sans", system-ui, sans-serif'
    ctx.font = font
    const textH = 13, padX = 5, padY = 3
    const GAP = 26   // base vertical gap from candle high up to label bottom

    // Resolve on-screen anchors.
    const items = []
    for (const c of callouts) {
      if (!c?.text || !c?.time) continue
      const idx = barIndexForDate(c.time)
      if (idx < 0) continue
      const high = bars[idx].h ?? bars[idx].high ?? bars[idx].c
      let ax, ay
      try { ax = ts.logicalToCoordinate(idx) } catch { ax = null }
      try { ay = series.priceToCoordinate(high) } catch { ay = null }
      if (ax == null || ay == null || ax < -40 || ax > w + 40) continue
      const tw = ctx.measureText(c.text).width
      items.push({ text: c.text, ax, ay, boxW: tw + padX * 2, boxH: textH + padY * 2 })
    }
    items.sort((a, b) => a.ax - b.ax)

    // Place each label up-and-to-a-side, then push it up to clear collisions.
    const placed = []
    const overlaps = (a, b) =>
      !(a.x + a.boxW < b.x - 6 || b.x + b.boxW < a.x - 6 || a.y + a.boxH < b.y - 4 || b.y + b.boxH < a.y - 4)
    for (const it of items) {
      const goRight = it.ax < w * 0.45            // diagonal toward the side with more room
      let bx = goRight ? it.ax + 26 : it.ax - it.boxW - 26
      bx = Math.max(4, Math.min(w - it.boxW - 4, bx))
      let by = it.ay - GAP - it.boxH
      let guard = 0
      while (guard++ < 300 && placed.some(p => overlaps({ x: bx, y: by, boxW: it.boxW, boxH: it.boxH }, p))) {
        by -= (it.boxH + 5)
      }
      by = Math.max(4, by)
      placed.push({ ...it, x: bx, y: by })
    }

    // Leader lines (under the labels).
    ctx.save()
    ctx.strokeStyle = color
    ctx.globalAlpha = 0.5
    ctx.lineWidth = 1
    for (const p of placed) {
      const cornerX = (p.ax <= p.x) ? p.x : p.x + p.boxW   // bottom corner nearest the candle
      ctx.beginPath()
      ctx.moveTo(p.ax, p.ay)
      ctx.lineTo(cornerX, p.y + p.boxH)
      ctx.stroke()
    }
    ctx.restore()

    // Labels (faint backing for legibility + text).
    ctx.textBaseline = 'middle'
    ctx.font = font
    for (const p of placed) {
      ctx.fillStyle = 'rgba(10,12,16,0.62)'
      ctx.fillRect(p.x, p.y, p.boxW, p.boxH)
      ctx.fillStyle = color
      ctx.fillText(p.text, p.x + padX, p.y + p.boxH / 2 + 0.5)
    }
  }, [chartRef, seriesRef, bars, callouts, color, barIndexForDate])

  useEffect(() => { redrawRef.current = redraw }, [redraw])
  useEffect(() => { redrawRef.current?.() }, [redraw])

  // Canvas sizing.
  useEffect(() => {
    const canvas = canvasRef.current
    const wrapper = canvas?.parentElement
    if (!canvas || !wrapper) return
    const setSize = (width, height) => {
      const dpr = window.devicePixelRatio || 1
      canvas.width = width * dpr; canvas.height = height * dpr
      canvas.style.width = width + 'px'; canvas.style.height = height + 'px'
      sizeRef.current = { w: width, h: height }
    }
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

  // Redraw in lockstep with chart scroll/zoom.
  useEffect(() => {
    const chart = chartRef?.current
    if (!chart) return
    const ts = chart.timeScale()
    const onRange = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(() => redrawRef.current?.())
    }
    let lastKey = null
    const interval = setInterval(() => {
      try {
        const r = ts.getVisibleLogicalRange()
        const key = r ? `${r.from.toFixed(2)}-${r.to.toFixed(2)}` : null
        if (key !== lastKey) { lastKey = key; redrawRef.current?.() }
      } catch { /* chart torn down mid-poll */ }
    }, 200)
    try { ts.subscribeVisibleLogicalRangeChange(onRange) } catch { /* older API */ }
    return () => {
      clearInterval(interval)
      try { ts.unsubscribeVisibleLogicalRangeChange(onRange) } catch { /* already removed */ }
    }
  }, [chartRef])

  return <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />
}
