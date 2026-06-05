import { useRef, useEffect, useMemo, useCallback } from 'react'

// Renders a small "+X%" label above each setup candle showing the price advance
// from the PREVIOUS setup to this one (close-to-close). Auto-generated from the
// ordered list of setup dates — read-only, pointer-transparent. Model Book only.

const toMs = (v) => {
  if (v == null) return NaN
  if (typeof v === 'number') return v < 1e12 ? v * 1000 : v
  const s = String(v)
  return Date.parse(s.length <= 10 ? `${s}T00:00:00Z` : s)
}

export default function SetupMoveOverlay({
  chartRef, seriesRef, bars, setups,
  color = '#ffffff',
}) {
  const canvasRef = useRef(null)
  const sizeRef = useRef({ w: 0, h: 0 })
  const redrawRef = useRef(null)

  // Nearest bar index for a date (robust to date vs epoch formats).
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

  // For each consecutive pair of setups, the % move from the OPEN of the prior
  // setup's trigger candle up to the HIGH of the candle where THIS setup's lines
  // start (its `anchor`); the label is placed there too — so it reads "the stock
  // ran +X% off the last setup before this base began".
  const moves = useMemo(() => {
    const out = []
    const ss = setups || []
    for (let k = 1; k < ss.length; k++) {
      const ai = barIndexForDate(ss[k - 1].date)            // prior setup's trigger ("from" = its open)
      const bi = barIndexForDate(ss[k].anchor ?? ss[k].date) // this setup's line-start ("to" = its high, + placement)
      if (ai < 0 || bi < 0) continue
      const a = bars[ai], b = bars[bi]
      if (!a || !b || !(a.o > 0)) continue
      out.push({ time: ss[k].anchor ?? ss[k].date, idx: bi, high: b.h, pct: ((b.h - a.o) / a.o) * 100 })
    }
    return out
  }, [setups, bars, barIndexForDate])

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
    if (!moves.length) return
    const ts = chart.timeScale()
    let from = -Infinity, to = Infinity
    try { const r = ts.getVisibleLogicalRange(); if (r) { from = r.from; to = r.to } } catch { /* unbounded */ }

    ctx.font = '600 12px "Instrument Sans", system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'bottom'
    ctx.lineJoin = 'round'
    for (const mv of moves) {
      if (mv.idx > to + 0.5 || mv.idx < from - 0.5) continue   // candle off-screen
      let x = null
      try { x = ts.timeToCoordinate(mv.time) } catch { /* fall back */ }
      if (x == null) { try { x = ts.logicalToCoordinate(mv.idx) } catch { /* skip */ } }
      let y = null
      try { y = series.priceToCoordinate(mv.high) } catch { /* skip */ }
      if (x == null || y == null) continue
      const text = `${mv.pct >= 0 ? '+' : ''}${Math.round(mv.pct)}%`
      const px = Math.round(x), py = Math.round(y - 10)   // pixel-snap for crisp edges
      ctx.lineWidth = 3                                    // crisp dark outline (no blur) for contrast
      ctx.strokeStyle = 'rgba(0,0,0,0.85)'
      ctx.strokeText(text, px, py)
      ctx.fillStyle = color
      ctx.fillText(text, px, py)   // just above the candle's high where the lines start
    }
  }, [chartRef, seriesRef, moves, color])

  redrawRef.current = redraw

  // Redraw on data/size change.
  useEffect(() => { redrawRef.current?.() }, [redraw])

  // Size the canvas to its wrapper.
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

  // Track pan / zoom / vertical scale and redraw in lockstep.
  useEffect(() => {
    const chart = chartRef?.current
    const series = seriesRef?.current
    if (!chart) return
    const ts = chart.timeScale()
    const onRange = () => redrawRef.current?.()
    try { ts.subscribeVisibleLogicalRangeChange(onRange) } catch { /* older API */ }
    let raf = null
    let lastKey = ''
    const tick = () => {
      try {
        const r = ts.getVisibleLogicalRange()
        const y0 = series?.priceToCoordinate(1)
        const y1 = series?.priceToCoordinate(100)
        const key = `${r ? `${r.from.toFixed(2)}_${r.to.toFixed(2)}` : ''}|${y0 ?? ''}|${y1 ?? ''}`
        if (key !== lastKey) { lastKey = key; redrawRef.current?.() }
      } catch { /* torn down */ }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      if (raf) cancelAnimationFrame(raf)
      try { ts.unsubscribeVisibleLogicalRangeChange(onRange) } catch { /* already removed */ }
    }
  }, [chartRef, seriesRef])

  return <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />
}
