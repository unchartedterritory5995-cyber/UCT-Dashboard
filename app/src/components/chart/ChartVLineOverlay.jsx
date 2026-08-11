import { useRef, useEffect, useCallback } from 'react'

// A single thin vertical marker line at a given calendar date, spanning the full
// chart height (price + volume panes). Used by Custom-Period Sort to mark the sort's
// START date in gold on every linked chart. Read-only, pointer-transparent. Rides the
// time axis so it stays glued to its date through pan/zoom (rAF loop, idle = no work).
//
// ⚠️ NUMBERS FIRST. `bars[i].t` is a unix-seconds NUMBER on every native intraday
// series (daily/weekly/monthly and StockChart's own anchorMarker projection are the
// ONLY callers that hand this a string). `String(1738800000)` is 10 characters, so
// the old string-only version fed `Date.parse('1738800000T00:00:00Z')` — not a valid
// ISO string — which is NaN. Every bar then compared NaN-diff against `target`, no
// comparison ever won, and `barIndexForDate` returned -1 for EVERY bar: the line
// silently never drew on any intraday series fed numeric `t`. Same seconds/ms
// convention as `lastAnchorIdx` in StockChart.jsx (~line 320) — keep them in sync.
// Exported for its unit tests.
export const toMs = (v) => {
  if (typeof v === 'number') return v < 1e12 ? v * 1000 : v
  const s = String(v)
  return Date.parse(s.length <= 10 ? `${s}T00:00:00Z` : s)
}

// Nearest bar index to the target date (the date may fall on a weekend/holiday, or
// off the front/back of an intraday session). Pure — extracted from the component so
// it's testable without a canvas/chart. Exported for its unit tests.
export function nearestBarIndex(bars, dateStr) {
  if (!bars || !bars.length || !dateStr) return -1
  const target = toMs(dateStr)
  if (Number.isNaN(target)) return -1
  let best = -1, bestDiff = Infinity
  for (let i = 0; i < bars.length; i++) {
    const d = Math.abs(toMs(bars[i].t) - target)
    if (d < bestDiff) { bestDiff = d; best = i }
  }
  return best
}

export default function ChartVLineOverlay({ chartRef, seriesRef, bars, date, color = '#c9a84c' }) {
  const canvasRef = useRef(null)
  const rafRef = useRef(null)
  const sizeRef = useRef({ w: 0, h: 0 })
  const drawRef = useRef(null)

  const barIndexForDate = useCallback((dateStr) => nearestBarIndex(bars, dateStr), [bars])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const chart = chartRef?.current
    if (!canvas || !chart) return
    const ctx = canvas.getContext('2d')
    const dpr = window.devicePixelRatio || 1
    const { w, h } = sizeRef.current
    if (!w || !h) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    if (!date) return
    const i = barIndexForDate(date)
    if (i < 0) return
    let x = null
    try { x = chart.timeScale().logicalToCoordinate(i) } catch { return }
    if (x == null || x < 0 || x > w) return
    x = Math.round(x) + 0.5   // crisp 1px line
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, h)
    ctx.lineWidth = 1
    ctx.strokeStyle = color
    ctx.stroke()
  }, [chartRef, date, color, barIndexForDate])
  useEffect(() => { drawRef.current = draw }, [draw])

  // Canvas sizing to the full chart container.
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
      drawRef.current?.()
    })
    ro.observe(wrapper)
    return () => ro.disconnect()
  }, [])

  // Redraw on date/bars change.
  useEffect(() => { draw() }, [draw, bars, date])

  // Track pan/zoom: subscribe to the logical-range change + a light rAF loop that
  // redraws only when the visible range actually moved (idle = zero redraws).
  useEffect(() => {
    const onRange = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(() => drawRef.current?.())
    }
    let subscribed = null
    let loopRaf = null
    let last = ''
    const tick = () => {
      const chart = chartRef?.current
      if (chart !== subscribed) {
        try { subscribed?.timeScale().unsubscribeVisibleLogicalRangeChange(onRange) } catch { /* gone */ }
        subscribed = null
        if (chart) {
          try { chart.timeScale().subscribeVisibleLogicalRangeChange(onRange); subscribed = chart } catch { /* older API */ }
        }
      }
      if (chart) {
        try {
          const r = chart.timeScale().getVisibleLogicalRange()
          const sig = r ? `${r.from.toFixed(2)}_${r.to.toFixed(2)}` : ''
          if (sig !== last) { last = sig; drawRef.current?.() }
        } catch { /* torn down mid-frame */ }
      }
      loopRaf = requestAnimationFrame(tick)
    }
    loopRaf = requestAnimationFrame(tick)
    return () => {
      if (loopRaf) cancelAnimationFrame(loopRaf)
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      try { subscribed?.timeScale().unsubscribeVisibleLogicalRangeChange(onRange) } catch { /* already removed */ }
    }
  }, [chartRef, seriesRef])

  return <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />
}
