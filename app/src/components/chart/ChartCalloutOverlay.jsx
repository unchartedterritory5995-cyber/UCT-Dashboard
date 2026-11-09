import { useRef, useEffect, useCallback } from 'react'

// Renders text callouts (Model Book catalysts) AmiBroker-style: each label sits
// in open space above its candle with a thin diagonal leader line back to the
// candle's high, so labels never cover candles. Read-only, pointer-transparent.

const toMs = (v) => {
  const s = String(v)
  // a daily bar keyed YYYYMMDD (the Study bank's own bars) reads as that day
  if (/^\d{8}$/.test(s)) return Date.parse(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T00:00:00Z`)
  return Date.parse(s.length <= 10 ? `${s}T00:00:00Z` : s)
}

// A rounded rectangle path, whether or not the context has roundRect.
function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2))
  ctx.beginPath()
  ctx.moveTo(x + rr, y); ctx.lineTo(x + w - rr, y); ctx.quadraticCurveTo(x + w, y, x + w, y + rr)
  ctx.lineTo(x + w, y + h - rr); ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h)
  ctx.lineTo(x + rr, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - rr)
  ctx.lineTo(x, y + rr); ctx.quadraticCurveTo(x, y, x + rr, y); ctx.closePath()
}

// `look` (Study, round 21; the owner on the pointer: "an arrow that is logically spaced to the left and pointing at
// the candle", "ensure that it doesnt interfere with candles"): the same blank-space search, drawn as a pill with
// a border, a leader with an arrowhead that stops short of the candle, and a ring around the candle itself:
//   { font, textH, padX, padY, pill, fill, radius, borderWidth, textColor, uppercase, letterSpacing, distances, bottomFrac,
//     ring, ringPad, ringWidth, arrow, arrowSize, gap, lineWidth, glow }
// A callout may carry `index` (a bar index) instead of `time`, and its own `color`, `textColor`, `ring: false`, `arrow: false`.
// Without a look, nothing about the Model Book's catalysts changes.

export default function ChartCalloutOverlay({ chartRef, seriesRef, bars, callouts, color = '#ffffff', bottomFrac = 0.82, look = null }) {
  const canvasRef = useRef(null)
  const rafRef = useRef(null)
  // Study (2026-11-08, the owner: the choosable candles should show it, "slightly animated"; and "no throbbing gold"): with
  // `look.fadeIn`, a new set of callouts arrives with one soft fade and lift, once, never a pulse; off under reduced motion
  const fadeKey = look?.fadeIn ? JSON.stringify((callouts || []).map((c) => [c.index ?? c.time, c.text])) : null
  useEffect(() => {
    const el = canvasRef.current
    if (!fadeKey || !el || typeof el.animate !== 'function') return
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    el.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 700, easing: 'cubic-bezier(.2, .9, .2, 1)' })
  }, [fadeKey])
  const sizeRef = useRef({ w: 0, h: 0 })
  const redrawRef = useRef(null)
  const trackedRef = useRef(null)
  const fullSigRef = useRef('')        // signature that gates the full re-search
  const pendingReplaceRef = useRef(false)  // re-place once the view settles after a real change
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
    const font = look?.font || '400 11px "Instrument Sans", system-ui, sans-serif'
    ctx.font = font
    if ('letterSpacing' in ctx) ctx.letterSpacing = look?.letterSpacing || '0px'   // measured into the box below
    const textH = look?.textH ?? 13, padX = look?.padX ?? 5, padY = look?.padY ?? 3

    // ── Map the price action so labels can dodge it ──
    // Build pixel high/low segments for the VISIBLE candles. A label that
    // overlaps any of these is covering a candle, so we reject that spot.
    let lo = 0, hi = bars.length - 1
    let visFrom = -Infinity, visTo = Infinity   // visible logical range (for hiding off-screen catalysts)
    try {
      const r = ts.getVisibleLogicalRange()
      if (r) {
        lo = Math.max(0, Math.floor(r.from) - 1); hi = Math.min(bars.length - 1, Math.ceil(r.to) + 1)
        visFrom = r.from; visTo = r.to
      }
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
    // a `look` may keep its labels higher still (a phone's volume pane takes more of the canvas)
    const priceBottom = h * Math.min(bottomFrac, look?.bottomFrac ?? 1)
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

    // Split a title into two BALANCED lines (min width difference). A narrower,
    // taller box tucks into a close gap instead of being forced far out.
    const splitTwo = (text) => {
      const words = String(text).split(' ')
      if (words.length < 2) return [text]  // single long word — can't split
      let bestI = 1, bestDiff = Infinity
      for (let i = 1; i < words.length; i++) {
        const w1 = ctx.measureText(words.slice(0, i).join(' ')).width
        const w2 = ctx.measureText(words.slice(i).join(' ')).width
        const d = Math.abs(w1 - w2)
        if (d < bestDiff) { bestDiff = d; bestI = i }
      }
      return [words.slice(0, bestI).join(' '), words.slice(bestI).join(' ')]
    }
    // Keep labels ONE line by default — only wrap a title that's genuinely too
    // wide to fit on screen. (The two-pass below additionally wraps a label when
    // that's the only way to place it CLOSE; everywhere else stays single-line.)
    const maxLineW = Math.max(220, Math.min(340, (plotRight - plotLeft) * 0.62))
    const wrapLabel = (text) => (look || ctx.measureText(text).width <= maxLineW) ? [text] : splitTwo(text)
    const boxDims = (lines) => {
      const tw = Math.max(...lines.map(l => ctx.measureText(l).width))
      return { boxW: tw + padX * 2, boxH: lines.length * textH + padY * 2 }
    }
    const leaderLenOf = (ax, rect) => {
      const nx = Math.max(rect.x, Math.min(rect.x + rect.w, ax))
      const ny = Math.max(rect.y, Math.min(rect.y + rect.h, rect.anchorY))
      return Math.hypot(nx - ax, ny - rect.anchorY)
    }

    // Resolve on-screen anchors (candle high + low) + wrap long labels.
    const items = []
    for (const c of callouts) {
      if (!c?.text || (c?.time == null && c?.index == null)) continue
      const idx = c.index != null ? Math.round(Number(c.index)) : barIndexForDate(c.time)
      if (idx < 0 || idx >= bars.length) continue
      // Hide a catalyst whose bar is OUTSIDE the visible range — e.g. when zoomed
      // to one catalyst, a later catalyst's bar is off the right edge, so its
      // label/leader must not extend into view.
      if (idx > visTo + 0.5 || idx < visFrom - 0.5) continue
      const b = bars[idx]
      let ax, hy, ly
      try { ax = ts.logicalToCoordinate(idx) } catch { ax = null }
      try { hy = series.priceToCoordinate(b.h ?? b.high ?? b.c) } catch { hy = null }
      try { ly = series.priceToCoordinate(b.l ?? b.low ?? b.c) } catch { ly = null }
      if (ax == null || hy == null || ax < -40 || ax > w + 40) continue
      if (ly == null) ly = hy
      const text = look?.uppercase ? String(c.text).toUpperCase() : c.text
      const lines = wrapLabel(text)
      items.push({ key: `${c.time ?? c.index}|${c.text}|${c.color || ''}`, idx, text, lines, ax, hy, ly, color: c.color || null, textColor: c.textColor || null, ring: c.ring, arrow: c.arrow, ...boxDims(lines) })
    }
    items.sort((a, b) => a.ax - b.ax)

    // ── Find the nearest blank space in ANY direction for each label ──
    // Try positions outward from the candle (closest first), in 8 directions;
    // take the first that clears both candles and already-placed labels.
    // DIAGONAL directions only — never straight up/down or left/right, so every
    // leader line is a diagonal (offset in both x and y). The box is always fully
    // offset from the candle on both axes, so the nearest-point leader can't fall
    // vertical or horizontal.
    const BASE_DIRS = [
      { dx: -1, dy: -1 },  // up-left (preferred via dirBias)
      { dx: -1, dy: 1 },   // down-left
      { dx: 1, dy: -1 },   // up-right
      { dx: 1, dy: 1 },    // down-right (least preferred)
    ]
    // With a `look` (Study) the search also tries steeper and shallower diagonals: on a dense phone chart the open space
    // is often straight above the candles, which a 45-degree step never reaches without crossing them.
    const DIRS = look ? [...BASE_DIRS,
      { dx: -0.45, dy: -1 }, { dx: -1, dy: -0.45 }, { dx: 0.45, dy: -1 },
      { dx: -0.45, dy: 1 }, { dx: -1, dy: 0.45 }, { dx: 0.45, dy: 1 },
    ] : BASE_DIRS
    // Min ~20px breathing room. Distance dominates the cost so the NEAREST spot
    // wins, but the range reaches ~210px so that — in a dense cluster — a clean,
    // READABLE gap is always reachable instead of being forced onto candles
    // (clean always outranks a graze). The cost keeps labels close when it can.
    const DISTS = look?.distances || [20, 28, 38, 50, 64, 82, 104, 132, 168, 210]
    const placed = []
    const placedLeaders = []   // leader segments already drawn — new ones must not cross them
    // Do two leader segments cross (proper interior intersection)?
    const segCross = (ax, ay, bx, by, L) => {
      const dn = (bx - ax) * (L.y1 - L.y0) - (by - ay) * (L.x1 - L.x0)
      if (Math.abs(dn) < 1e-6) return false
      const t = ((L.x0 - ax) * (L.y1 - L.y0) - (L.y0 - ay) * (L.x1 - L.x0)) / dn
      const u = ((L.x0 - ax) * (by - ay) - (L.y0 - ay) * (bx - ax)) / dn
      return t > 0.04 && t < 0.96 && u > 0.04 && u < 0.96
    }
    // Does a leader segment pass through a label's box? (A leader must not run
    // across another catalyst's text.)
    const lineHitsRect = (x0, y0, x1, y1, r) => {
      if ((x0 < r.x && x1 < r.x) || (x0 > r.x + r.w && x1 > r.x + r.w) ||
          (y0 < r.y && y1 < r.y) || (y0 > r.y + r.h && y1 > r.y + r.h)) return false
      const within = (px, py) => px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h
      if (within(x0, y0) || within(x1, y1)) return true
      const ss = (cx, cy, dx, dy) => {
        const dd = (x1 - x0) * (dy - cy) - (y1 - y0) * (dx - cx)
        if (Math.abs(dd) < 1e-9) return false
        const t = ((cx - x0) * (dy - cy) - (cy - y0) * (dx - cx)) / dd
        const u = ((cx - x0) * (y1 - y0) - (cy - y0) * (x1 - x0)) / dd
        return t >= 0 && t <= 1 && u >= 0 && u <= 1
      }
      return ss(r.x, r.y, r.x + r.w, r.y) || ss(r.x + r.w, r.y, r.x + r.w, r.y + r.h) ||
             ss(r.x, r.y + r.h, r.x + r.w, r.y + r.h) || ss(r.x, r.y, r.x, r.y + r.h)
    }
    // Score every candidate spot and take the cheapest. Cost is dominated by the
    // LEADER-LINE LENGTH (short, tidy lines win), with a hard penalty for any spot
    // whose label or line covers a candle / overlaps another label, plus a small
    // directional bias so ties break toward the TOP-LEFT (the natural blank space
    // on an up-trend). Net effect: a close bottom-right beats a far top-left, but
    // when distances are similar the top-left is chosen. (User-tuned behavior.)
    const BLOCKED = 1e6
    // A vertical/horizontal leader is NEVER acceptable — penalize it harder than
    // a candle graze so the scorer always falls to a diagonal, even a slightly
    // overlapping one, rather than a clean vertical (the edge-clamped case).
    const NONDIAG = 5e6
    // Two labels overlapping is unreadable — forbid it as hard as a vertical line,
    // harder than a candle graze, so a crowded label moves to a clean (or, failing
    // that, candle-grazing) spot rather than landing on its neighbour.
    const LABELOVR = 5e6
    // Closeness is paramount: cost is the leader-line LENGTH, so the nearest
    // clear gap always wins. A small TOP-LEFT tiebreak (≈10px) only decides
    // between spots that are otherwise about equally close — so a candle with an
    // open upper-left gets its label up-left, but one whose up-left is blocked
    // drops to the next-nearest gap (e.g. just below) rather than a far up-left.
    // Gentle top-left lean (≈20px) — only breaks ties between near-equal spots.
    // Distance DOMINATES so every label lands at its nearest clear gap, keeping
    // leader lengths short and roughly UNIFORM across catalysts. (No strong
    // directional bonus — that previously dragged some labels far up-left.)
    // (the steeper Study diagonals cost a little more, so a clean 45-degree spot up-left still wins)
    const bias = (d) => (d.dy < 0 ? -10 : 0) + (d.dx < 0 ? -10 : 0) + (Math.abs(d.dx) !== Math.abs(d.dy) ? 14 : 0)
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
          // horizontal (e.g. an edge-clamped label landing right above its candle).
          if (Math.abs(nx - it.ax) < 7 || Math.abs(ny - anchorY) < 7) cost += NONDIAG
          if (placed.some(p => rectsOverlap(rect, p))) cost += LABELOVR
          // A leader crossing another leader (the ugly X) — or running through
          // another label's text box — is as bad as overlapping it.
          if (placedLeaders.some(L => segCross(it.ax, anchorY, nx, ny, L))) cost += LABELOVR
          if (placed.some(p => lineHitsRect(it.ax, anchorY, nx, ny, p))) cost += LABELOVR
          if (placedLeaders.some(L => lineHitsRect(L.x0, L.y0, L.x1, L.y1, rect))) cost += LABELOVR
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
    for (let it of items) {
      const cached = useCache ? placeRef.current.get(it.key) : null
      let rect
      if (cached) {
        // Honour the resolved line wrapping the search chose (it may have been
        // re-wrapped to 2 lines), so the tracked box matches what was placed.
        if (cached.lines) it = { ...it, lines: cached.lines, ...boxDims(cached.lines) }
        const anchorY = cached.anchorIsLow ? it.ly : it.hy
        const x = Math.max(plotLeft, Math.min(plotRight - it.boxW, it.ax + cached.offX))
        const y = Math.max(4, Math.min(priceBottom - it.boxH - 4, anchorY + cached.offY))
        rect = { x, y, w: it.boxW, h: it.boxH, anchorY }
      } else {
        rect = placeOne(it)
        // Two-pass: ONLY when a single-line label landed genuinely far (>130px)
        // do we try wrapping to two narrower lines — and keep it only if that
        // brings it MUCH closer (>30px). Otherwise the label stays one line, even
        // if it sits a little out, so we don't wrap when there's plenty of room.
        // (never with a `look`: Study's labels are short, one line reads better, and the two-line fallback compares only
        // leader length, so it could pick a spot that covers a candle)
        if (!look && it.lines.length === 1 && it.text.includes(' ') && leaderLenOf(it.ax, rect) > 130) {
          const lines2 = splitTwo(it.text)
          if (lines2.length === 2) {
            const it2 = { ...it, lines: lines2, ...boxDims(lines2) }
            const rect2 = placeOne(it2)
            if (leaderLenOf(it2.ax, rect2) < leaderLenOf(it.ax, rect) - 30) { it = it2; rect = rect2 }
          }
        }
        placeRef.current.set(it.key, {
          offX: rect.x - it.ax,
          offY: rect.y - rect.anchorY,
          anchorIsLow: !!rect.anchorIsLow,
          lines: it.lines,
        })
      }
      placed.push({ ...it, ...rect })
      // Record this leader so later labels won't cross it.
      const lnx = Math.max(rect.x, Math.min(rect.x + rect.w, it.ax))
      const lny = Math.max(rect.y, Math.min(rect.y + rect.h, rect.anchorY))
      placedLeaders.push({ x0: it.ax, y0: rect.anchorY, x1: lnx, y1: lny })
    }

    // ── Draw: the ring on the candle, the leader (with an arrowhead when asked), then the labels ──
    let barW = 6
    try { const x0 = ts.logicalToCoordinate(0), x1 = ts.logicalToCoordinate(1); if (x0 != null && x1 != null) barW = Math.abs(x1 - x0) || 6 } catch { /* pre-init */ }
    const glow = look?.glow ?? 0
    for (const p of placed) {
      const col = p.color || color
      const nx = Math.max(p.x, Math.min(p.x + p.w, p.ax))
      const ny = Math.max(p.y, Math.min(p.y + p.h, p.anchorY))
      const ringOn = !!look?.ring && p.ring !== false
      const pad = look?.ringPad ?? 3
      ctx.save()
      ctx.strokeStyle = col; ctx.fillStyle = col
      if (glow) { ctx.shadowColor = col; ctx.shadowBlur = glow }
      if (ringOn) {
        // a stroke only: the candle keeps its own colour inside the ring
        const half = Math.max(5, barW / 2 + pad)
        const top = Math.min(p.hy, p.ly) - pad, bot = Math.max(p.hy, p.ly) + pad
        ctx.globalAlpha = 0.95; ctx.lineWidth = look.ringWidth ?? 1.25
        roundRectPath(ctx, p.ax - half, top, half * 2, Math.max(4, bot - top), Math.min(half, 6)); ctx.stroke()
      }
      const gap = ringOn ? pad + (look?.gap ?? 5) : (look?.gap ?? 0)
      const dx = p.ax - nx, dy = p.anchorY - ny, len = Math.hypot(dx, dy) || 1
      const ex = p.ax - (dx / len) * gap, ey = p.anchorY - (dy / len) * gap
      ctx.globalAlpha = look ? 0.95 : 0.8; ctx.lineWidth = look?.lineWidth ?? 1.25
      ctx.beginPath(); ctx.moveTo(nx, ny); ctx.lineTo(ex, ey); ctx.stroke()
      if (look?.arrow && p.arrow !== false) {
        const size = look.arrowSize ?? 8, ang = Math.atan2(ey - ny, ex - nx)
        ctx.beginPath(); ctx.moveTo(ex, ey)
        ctx.lineTo(ex - size * Math.cos(ang - Math.PI / 7), ey - size * Math.sin(ang - Math.PI / 7))
        ctx.lineTo(ex - size * Math.cos(ang + Math.PI / 7), ey - size * Math.sin(ang + Math.PI / 7))
        ctx.closePath(); ctx.fill()
      }
      ctx.restore()
    }

    ctx.textBaseline = 'middle'
    ctx.font = font
    for (const p of placed) {
      const col = p.color || color
      const lines = p.lines || [p.text]
      if (look?.pill) {
        ctx.save()
        if (glow) { ctx.shadowColor = col; ctx.shadowBlur = glow }
        ctx.fillStyle = look.fill || 'rgba(11,11,11,.92)'
        roundRectPath(ctx, p.x, p.y, p.w, p.h, Math.min(p.h / 2, look.radius ?? 999)); ctx.fill()
        ctx.shadowBlur = 0
        ctx.lineWidth = look.borderWidth ?? 1; ctx.strokeStyle = col; ctx.stroke()
        ctx.restore()
        ctx.fillStyle = p.textColor || look.textColor || col
      } else {
        // plain text (the Model Book): a tight, low-blur shadow keeps it legible over candles
        ctx.fillStyle = col
        ctx.shadowColor = 'rgba(0,0,0,0.8)'
        ctx.shadowBlur = 1.5
      }
      for (let li = 0; li < lines.length; li++) {
        const ty = Math.round(p.y + padY + textH * li + textH / 2) + 0.5
        ctx.fillText(lines[li], Math.round(p.x + padX), ty)
      }
      ctx.shadowBlur = 0
      ctx.shadowColor = 'transparent'
    }
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px'
  }, [chartRef, seriesRef, bars, callouts, color, barIndexForDate, bottomFrac, look])

  // redrawRef → full search-and-place (deps change / resize).
  // trackedRef → cached rigid track (per-frame pan/zoom).
  useEffect(() => {
    redrawRef.current = () => draw(false)
    trackedRef.current = () => draw(true)
  }, [draw])
  // Full re-search ONLY when the catalyst SET (or bars/size/color) actually
  // changes — NOT on every parent re-render (focus/zoom rebuilds the callouts
  // array with the same content). This pins the placement to the designated
  // full-year view; mid-zoom the rAF loop just rides the cached offsets. The
  // pending flag asks for one more re-place once the new chart's framing settles.
  useEffect(() => {
    const sig = (callouts || []).map(c => `${c?.time ?? c?.index}|${c?.text}|${c?.color ?? ''}|${c?.textColor ?? ''}`).join('~') +
      // with a `look` (Study) a label is placed once per callout set and then rides with its candle while bars run on
      `|${look ? '' : (bars?.length ?? 0)}|${color}|${bottomFrac}|${look ? JSON.stringify(look) : ''}`
    if (sig === fullSigRef.current) return
    fullSigRef.current = sig
    pendingReplaceRef.current = true
    draw(false)
  }, [draw, callouts, bars, color, bottomFrac, look])


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
    // Resolve chart/series from the refs EVERY frame — a one-time capture left
    // this tracker dead when the overlay mounted before the chart existed
    // (child effects run before the parent effect that creates the chart) or
    // when the series was later recreated. See the matching fix in
    // ChartDrawingOverlay (the "trendline doesn't stay put" bug).
    const onRange = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(() => trackedRef.current?.())
    }
    let subscribedChart = null

    let loopRaf = null
    let lastSig = ''
    let stable = 0
    const tick = () => {
      const chart = chartRef?.current
      const series = seriesRef?.current
      if (chart !== subscribedChart) {
        try { subscribedChart?.timeScale().unsubscribeVisibleLogicalRangeChange(onRange) } catch { /* gone */ }
        subscribedChart = null
        if (chart) {
          try { chart.timeScale().subscribeVisibleLogicalRangeChange(onRange); subscribedChart = chart } catch { /* older API */ }
        }
      }
      if (chart) {
        try {
          const r = chart.timeScale().getVisibleLogicalRange()
          let y0 = null, y1 = null
          try { y0 = series?.priceToCoordinate(1); y1 = series?.priceToCoordinate(100) } catch { /* disposed series */ }
          const sig = `${r ? `${r.from.toFixed(2)}_${r.to.toFixed(2)}` : ''}|${y0 ?? ''}|${y1 ?? ''}`
          if (sig !== lastSig) {
            // Pan/zoom/focus animation: ride the cached offsets so labels glide
            // smoothly WITH their candles — NO re-search here, so a label keeps the
            // same pixel offset from its candle at every zoom level.
            lastSig = sig; stable = 0; trackedRef.current?.()
          } else if (pendingReplaceRef.current && ++stable > 10) {
            // Re-search ONCE the view settles AFTER a stock/catalyst change, so the
            // designated placement is computed at the real (settled) full-year frame
            // — NOT after every zoom (that would re-lock labels far at the new zoom).
            pendingReplaceRef.current = false; redrawRef.current?.()
          }
        } catch { /* chart torn down mid-frame */ }
      }
      loopRaf = requestAnimationFrame(tick)
    }
    loopRaf = requestAnimationFrame(tick)

    return () => {
      if (loopRaf) cancelAnimationFrame(loopRaf)
      try { subscribedChart?.timeScale().unsubscribeVisibleLogicalRangeChange(onRange) } catch { /* already removed */ }
    }
  }, [chartRef, seriesRef])

  return <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />
}
