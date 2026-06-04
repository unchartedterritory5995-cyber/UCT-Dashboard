import { useRef, useEffect, useCallback } from 'react'

// Renders text callouts (Model Book catalysts) AmiBroker-style: each label sits
// in open space above its candle with a thin diagonal leader line back to the
// candle's high, so labels never cover candles. Read-only, pointer-transparent.

const toMs = (v) => {
  const s = String(v)
  return Date.parse(s.length <= 10 ? `${s}T00:00:00Z` : s)
}

export default function ChartCalloutOverlay({ chartRef, seriesRef, bars, callouts, color = '#ffffff', bottomFrac = 0.82 }) {
  const canvasRef = useRef(null)
  const rafRef = useRef(null)
  const sizeRef = useRef({ w: 0, h: 0 })
  const redrawRef = useRef(null)
  const trackedRef = useRef(null)
  // Cached per-label placement, keyed by `${time}|${text}`. Stores the label's
  // offset from its anchor candle (offX from the candle x, offY from the anchor
  // high/low) plus which end of the candle the leader line attaches to. The
  // blank-space SEARCH only runs when this is empty for a label; during pan/zoom
  // we reuse the cached offset so each label rides RIGIDLY with its candle
  // instead of re-searching every frame (which made labels hop around). Like the
  // setup annotations, the label is now locked to its candle through the zoom.
  const placeRef = useRef(new Map())

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

  // useCache=false → run the blank-space search for every label and refresh the
  // offset cache (initial placement, callout-set change, resize). useCache=true →
  // reuse cached offsets so labels track their candles smoothly during pan/zoom;
  // any label without a cached offset (e.g. it just scrolled on-screen) is placed
  // by search on the fly without disturbing the already-locked ones.
  const draw = useCallback((useCache) => {
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
    if (!callouts || !callouts.length) { placeRef.current.clear(); return }
    if (!useCache) placeRef.current.clear()

    const ts = chart.timeScale()
    const font = '400 11px "Instrument Sans", system-ui, sans-serif'
    ctx.font = font
    const textH = 13, padX = 5, padY = 3

    // ── Map the price action so labels can dodge it ──
    // Build pixel high/low segments for the VISIBLE candles. A label that
    // overlaps any of these is covering a candle, so we reject that spot.
    let lo = 0, hi = bars.length - 1
    try {
      const r = ts.getVisibleLogicalRange()
      if (r) { lo = Math.max(0, Math.floor(r.from) - 1); hi = Math.min(bars.length - 1, Math.ceil(r.to) + 1) }
    } catch { /* default to all */ }
    const segs = []
    for (let i = lo; i <= hi; i++) {
      const b = bars[i]; if (!b) continue
      let x, top, bottom
      try { x = ts.logicalToCoordinate(i) } catch { x = null }
      try { top = series.priceToCoordinate(b.h ?? b.high ?? b.c) } catch { top = null }
      try { bottom = series.priceToCoordinate(b.l ?? b.low ?? b.c) } catch { bottom = null }
      if (x == null || top == null || bottom == null) continue
      segs.push({ x, top: Math.min(top, bottom), bottom: Math.max(top, bottom) })
    }
    // How far down labels may go. When this canvas covers ONLY the price pane
    // (Model Book, index pane present → bottomFrac≈0.96) labels can use almost
    // the whole pane, so a low candle's down-right spot is reachable. When the
    // canvas spans the volume pane too (bottomFrac≈0.82) the bottom is reserved.
    const priceBottom = h * bottomFrac
    const hitsCandles = (r) => {
      for (const s of segs) {
        if (s.x < r.x - 2 || s.x > r.x + r.w + 2) continue
        if (s.bottom < r.y || s.top > r.y + r.h) continue
        return true
      }
      return false
    }
    const rectsOverlap = (a, b) =>
      !(a.x + a.w < b.x - 6 || b.x + b.w < a.x - 6 || a.y + a.h < b.y - 4 || b.y + b.h < a.y - 4)

    // Keep labels inside the plot area — never under the right price axis or off
    // either edge. (The canvas spans the price pane incl. the axis.)
    let axisW = 0
    try { axisW = series.priceScale().width() || 0 } catch { /* pre-init */ }
    const plotLeft = 4
    const plotRight = w - axisW - 6

    // A leader line must not pass THROUGH any candle (other than its own anchor
    // candle). Tests the segment against each visible candle's vertical extent.
    const lineHitsCandles = (x0, y0, x1, y1, anchorX) => {
      const minx = Math.min(x0, x1), maxx = Math.max(x0, x1)
      for (const s of segs) {
        if (Math.abs(s.x - anchorX) < 3) continue          // its own candle — ok to touch
        if (s.x < minx - 0.5 || s.x > maxx + 0.5) continue // segment doesn't span this candle's x
        const t = (x1 === x0) ? 0 : (s.x - x0) / (x1 - x0)
        const y = y0 + t * (y1 - y0)
        if (y >= s.top - 1 && y <= s.bottom + 1) return true
      }
      return false
    }

    // Wrap a label to at most two lines once it would exceed maxLineW, so long
    // catalyst titles continue on a second line instead of running off-screen.
    const maxLineW = Math.max(120, Math.min(220, (plotRight - plotLeft) * 0.5))
    const wrapLabel = (text) => {
      if (ctx.measureText(text).width <= maxLineW) return [text]
      const words = String(text).split(' ')
      let line1 = ''
      let i = 0
      for (; i < words.length; i++) {
        const test = line1 ? `${line1} ${words[i]}` : words[i]
        if (!line1 || ctx.measureText(test).width <= maxLineW) line1 = test
        else break
      }
      const line2 = words.slice(i).join(' ')
      return line2 ? [line1, line2] : [line1]
    }

    // Resolve on-screen anchors (candle high + low) + wrap long labels.
    const items = []
    for (const c of callouts) {
      if (!c?.text || !c?.time) continue
      const idx = barIndexForDate(c.time)
      if (idx < 0) continue
      const b = bars[idx]
      let ax, hy, ly
      try { ax = ts.logicalToCoordinate(idx) } catch { ax = null }
      try { hy = series.priceToCoordinate(b.h ?? b.high ?? b.c) } catch { hy = null }
      try { ly = series.priceToCoordinate(b.l ?? b.low ?? b.c) } catch { ly = null }
      if (ax == null || hy == null || ax < -40 || ax > w + 40) continue
      if (ly == null) ly = hy
      const lines = wrapLabel(c.text)
      const tw = Math.max(...lines.map(l => ctx.measureText(l).width))
      items.push({
        key: `${c.time}|${c.text}`, text: c.text, lines, ax, hy, ly,
        boxW: tw + padX * 2, boxH: lines.length * textH + padY * 2,
      })
    }
    items.sort((a, b) => a.ax - b.ax)

    // ── Find the nearest blank space in ANY direction for each label ──
    // Try positions outward from the candle (closest first), in 8 directions;
    // take the first that clears both candles and already-placed labels.
    // DIAGONAL directions only — never straight up/down or left/right, so every
    // leader line is a diagonal (offset in both x and y). The box is always fully
    // offset from the candle on both axes, so the nearest-point leader can't fall
    // vertical or horizontal.
    const DIRS = [
      { dx: -1, dy: -1 },  // up-left (preferred via dirBias)
      { dx: -1, dy: 1 },   // down-left
      { dx: 1, dy: -1 },   // up-right
      { dx: 1, dy: 1 },    // down-right (least preferred)
    ]
    // Min ~20px gives the leader a little breathing room (labels shouldn't kiss
    // the candle); the rest let it reach a clear gap when nearby ones are taken.
    const DISTS = [20, 28, 38, 50, 64, 82, 104, 132, 166, 210]
    const placed = []
    // Score every candidate spot and take the cheapest. Cost is dominated by the
    // LEADER-LINE LENGTH (short, tidy lines win), with a hard penalty for any spot
    // whose label or line covers a candle / overlaps another label, plus a small
    // directional bias so ties break toward the TOP-LEFT (the natural blank space
    // on an up-trend). Net effect: a close bottom-right beats a far top-left, but
    // when distances are similar the top-left is chosen. (User-tuned behavior.)
    const BLOCKED = 1e6
    // Closeness is paramount: cost is the leader-line LENGTH, so the nearest
    // clear gap always wins. A small TOP-LEFT tiebreak (≈10px) only decides
    // between spots that are otherwise about equally close — so a candle with an
    // open upper-left gets its label up-left, but one whose up-left is blocked
    // drops to the next-nearest gap (e.g. just below) rather than a far up-left.
    const bias = (d) => (d.dy < 0 ? -5 : 0) + (d.dx < 0 ? -5 : 0)
    const placeOne = (it) => {
      let best = null, bestCost = Infinity
      for (const dist of DISTS) {
        for (const d of DIRS) {
          const anchorY = d.dy > 0 ? it.ly : it.hy
          const tx = it.ax + d.dx * dist
          const ty = anchorY + d.dy * dist
          let x = d.dx > 0 ? tx : d.dx < 0 ? tx - it.boxW : tx - it.boxW / 2
          let y = d.dy < 0 ? ty - it.boxH : d.dy > 0 ? ty : ty - it.boxH / 2
          x = Math.max(plotLeft, Math.min(plotRight - it.boxW, x))
          y = Math.max(4, Math.min(priceBottom - it.boxH - 4, y))
          const rect = { x, y, w: it.boxW, h: it.boxH, anchorY, anchorIsLow: d.dy > 0 }
          const nx = Math.max(rect.x, Math.min(rect.x + rect.w, it.ax))
          const ny = Math.max(rect.y, Math.min(rect.y + rect.h, anchorY))
          let cost = Math.hypot(nx - it.ax, ny - anchorY) + bias(d)
          // Force a real DIAGONAL: reject if the leader came out vertical or
          // horizontal (e.g. an edge-clamped label landing right above its
          // candle). The scorer then picks a direction that stays diagonal
          // (up-right for a left-edge candle, etc.).
          if (Math.abs(nx - it.ax) < 7 || Math.abs(ny - anchorY) < 7) cost += BLOCKED
          if (placed.some(p => rectsOverlap(rect, p))) cost += BLOCKED
          if (hitsCandles(rect)) cost += BLOCKED
          if (lineHitsCandles(it.ax, anchorY, nx, ny, it.ax)) cost += BLOCKED
          if (cost < bestCost) { bestCost = cost; best = rect }
        }
      }
      return best || {
        x: Math.max(plotLeft, Math.min(plotRight - it.boxW, it.ax - it.boxW / 2)),
        y: Math.max(4, it.hy - 30 - it.boxH), w: it.boxW, h: it.boxH, anchorY: it.hy, anchorIsLow: false,
      }
    }
    // Place each label: reuse the cached offset (rigid track) when available,
    // otherwise search for a blank spot and remember the offset for next frame.
    for (const it of items) {
      const cached = useCache ? placeRef.current.get(it.key) : null
      let rect
      if (cached) {
        const anchorY = cached.anchorIsLow ? it.ly : it.hy
        const x = Math.max(plotLeft, Math.min(plotRight - it.boxW, it.ax + cached.offX))
        const y = Math.max(4, Math.min(priceBottom - it.boxH - 4, anchorY + cached.offY))
        rect = { x, y, w: it.boxW, h: it.boxH, anchorY }
      } else {
        rect = placeOne(it)
        placeRef.current.set(it.key, {
          offX: rect.x - it.ax,
          offY: rect.y - rect.anchorY,
          anchorIsLow: !!rect.anchorIsLow,
        })
      }
      placed.push({ ...it, ...rect })
    }

    // Leader lines (under the labels): candle anchor → nearest point on the box.
    ctx.save()
    ctx.strokeStyle = color
    ctx.globalAlpha = 0.8
    ctx.lineWidth = 1.25
    for (const p of placed) {
      const nx = Math.max(p.x, Math.min(p.x + p.w, p.ax))
      const ny = Math.max(p.y, Math.min(p.y + p.h, p.anchorY))
      ctx.beginPath()
      ctx.moveTo(p.ax, p.anchorY)
      ctx.lineTo(nx, ny)
      ctx.stroke()
    }
    ctx.restore()

    // Labels: plain text (no box). A soft dark shadow keeps the white text
    // readable where it passes over candles, without drawing a background.
    ctx.textBaseline = 'middle'
    ctx.font = font
    ctx.fillStyle = color
    // A tight, low-blur shadow keeps the text legible over candles without the
    // fuzzy halo. Whole-pixel positions keep the glyphs crisp.
    ctx.shadowColor = 'rgba(0,0,0,0.8)'
    ctx.shadowBlur = 1.5
    for (const p of placed) {
      const lines = p.lines || [p.text]
      for (let li = 0; li < lines.length; li++) {
        const ty = Math.round(p.y + padY + textH * li + textH / 2) + 0.5
        ctx.fillText(lines[li], Math.round(p.x + padX), ty)
      }
    }
    ctx.shadowBlur = 0
    ctx.shadowColor = 'transparent'
  }, [chartRef, seriesRef, bars, callouts, color, barIndexForDate, bottomFrac])

  // redrawRef → full search-and-place (deps change / resize).
  // trackedRef → cached rigid track (per-frame pan/zoom).
  useEffect(() => {
    redrawRef.current = () => draw(false)
    trackedRef.current = () => draw(true)
  }, [draw])
  // The callout set / bars / color changed → re-search placements from scratch.
  useEffect(() => { draw(false) }, [draw])

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

  // Redraw in lockstep with chart scroll/zoom AND vertical price-scale drags.
  // The logical-range subscription only fires on horizontal moves; dragging the
  // right price axis changes the price→pixel mapping without it. So a rAF loop
  // samples both the time range and the price→pixel mapping each frame and
  // redraws only when either actually changes — smooth, and idle = no redraws.
  useEffect(() => {
    const chart = chartRef?.current
    const series = seriesRef?.current
    if (!chart) return
    const ts = chart.timeScale()
    const onRange = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(() => trackedRef.current?.())
    }
    try { ts.subscribeVisibleLogicalRangeChange(onRange) } catch { /* older API */ }

    let loopRaf = null
    let lastSig = ''
    const tick = () => {
      try {
        const r = ts.getVisibleLogicalRange()
        const y0 = series?.priceToCoordinate(1)
        const y1 = series?.priceToCoordinate(100)
        const sig = `${r ? `${r.from.toFixed(2)}_${r.to.toFixed(2)}` : ''}|${y0 ?? ''}|${y1 ?? ''}`
        if (sig !== lastSig) { lastSig = sig; trackedRef.current?.() }
      } catch { /* chart torn down mid-frame */ }
      loopRaf = requestAnimationFrame(tick)
    }
    loopRaf = requestAnimationFrame(tick)

    return () => {
      if (loopRaf) cancelAnimationFrame(loopRaf)
      try { ts.unsubscribeVisibleLogicalRangeChange(onRange) } catch { /* already removed */ }
    }
  }, [chartRef, seriesRef])

  return <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />
}
