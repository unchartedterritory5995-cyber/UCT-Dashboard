// Lightweight Charts v5 SERIES primitive: TC2000-style previous-day High / Low /
// Close lines on INTRADAY charts. Each is a horizontal segment at the prior
// session's H/L/C price, anchored at the candle that MADE that level (the high
// candle, the low candle, the session's last candle for the close) and extended
// rightward to the current candle — so it grows as new bars form.
//
// SERIES primitive (not pane): it needs BOTH priceToCoordinate (from the series)
// AND timeToCoordinate (from the chart) — the attached() param supplies both.
// CANVAS (not DOM) so branded screenshot export captures it (see levelZonesPrimitive).

const DASH = { solid: [], dashed: [5, 4], dotted: [1, 3] }

// Compute the previous session's H/L/C + the times of the candles that made them,
// plus the current (last) bar time, from the chart's INTRADAY bars. Intraday bar
// times are ET-offset unix seconds, so the ET calendar day is Math.floor(t/86400)
// (same basis sessionShadingPrimitive uses). Returns null for daily/weekly (string
// times) or when no prior session is loaded. Pure + exported for tests.
export function computePrevDayLevels(bars) {
  if (!Array.isArray(bars) || bars.length < 2) return null
  const timeOf = (b) => (b?.t ?? b?.time)              // raw or lightweight-charts format
  if (typeof timeOf(bars[0]) !== 'number') return null // intraday only (numeric epoch)
  const dayOf = (t) => Math.floor(t / 86400)
  const lastT = timeOf(bars[bars.length - 1])
  const curDay = dayOf(lastT)
  let prevDay = null
  for (let i = bars.length - 1; i >= 0; i--) {
    const d = dayOf(timeOf(bars[i]))
    if (d < curDay) { prevDay = d; break }
  }
  if (prevDay == null) return null
  let hi = -Infinity, lo = Infinity, hiT = null, loT = null, closeT = null, closeV = null
  for (const b of bars) {
    const t = timeOf(b)
    if (dayOf(t) !== prevDay) continue
    const h = b.h ?? b.high, l = b.l ?? b.low, c = b.c ?? b.close
    if (h != null && h > hi) { hi = h; hiT = t }
    if (l != null && l < lo) { lo = l; loT = t }
    if (c != null) { closeT = t; closeV = c }          // last candle of the day = close
  }
  if (!Number.isFinite(hi) || !Number.isFinite(lo) || closeV == null) return null
  return {
    endTime: lastT,
    high: { price: hi, startTime: hiT },
    low: { price: lo, startTime: loT },
    close: { price: closeV, startTime: closeT },
  }
}

// Build the draw-list of enabled line segments from the computed levels + the
// per-line settings blob ({ high/low/close: {enabled,color,style,width} }). Pure.
export function buildPrevDayLines(levels, cfg) {
  if (!levels || !cfg) return []
  const out = []
  for (const key of ['high', 'low', 'close']) {
    const c = cfg[key]
    const lv = levels[key]
    if (!c?.enabled || !lv || lv.price == null) continue
    out.push({
      key,
      price: lv.price,
      startTime: lv.startTime,
      color: c.color,
      style: c.style || 'dashed',
      width: c.width || 1,
    })
  }
  return out
}

export function createPrevDayLevelsPrimitive() {
  let lines = []          // [{ key, price, startTime, color, style, width }]
  let endTime = null
  let chart = null
  let series = null
  let requestUpdate = null

  const paneView = {
    zOrder: () => 'top',
    renderer: () => ({
      draw: (target) => {
        if (!chart || !series || lines.length === 0) return
        const ts = chart.timeScale()
        // Right end tracks the LIVE developing bar so the lines grow to the current
        // candle exactly like the MA overlays (which _extendOverlaysLive drags forward
        // on every tick). draw() runs on every chart repaint — including the
        // series.update() the live writers fire — and series.data() reflects that
        // update, so reading its last bar time here keeps the right end pinned to the
        // newest candle even between SWR refreshes (when the static `endTime` lags).
        let liveEnd = endTime
        try {
          const d = series.data()
          if (d && d.length) {
            const lt = d[d.length - 1]?.time
            if (lt != null) liveEnd = lt
          }
        } catch { /* series.data unavailable → fall back to endTime */ }
        try {
          target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
            ctx.save()
            for (const lv of lines) {
              let y
              try { y = series.priceToCoordinate(lv.price) } catch { continue }
              if (!Number.isFinite(y)) continue
              // Left end = the anchor candle (clamped to the left edge when it has
              // scrolled off). Right end = the current candle (full width if it's
              // past the right edge).
              let x0 = null
              try { x0 = ts.timeToCoordinate(lv.startTime) } catch { /* off-scale */ }
              if (x0 == null) x0 = 0
              let x1 = null
              try { x1 = liveEnd != null ? ts.timeToCoordinate(liveEnd) : null } catch { /* off-scale */ }
              if (x1 == null) x1 = mediaSize.width
              if (x1 <= x0) continue
              const yy = Math.round(y) + 0.5
              ctx.beginPath()
              ctx.strokeStyle = lv.color
              ctx.lineWidth = lv.width || 1
              ctx.setLineDash(DASH[lv.style] || [])
              ctx.moveTo(x0, yy)
              ctx.lineTo(x1, yy)
              ctx.stroke()
            }
            ctx.setLineDash([])
            ctx.restore()
          })
        } catch { /* never throw from draw() */ }
      },
    }),
  }

  const primitive = {
    paneViews: () => [paneView],
    updateAllViews: () => {},
    attached: (p) => { chart = p.chart; series = p.series; requestUpdate = p.requestUpdate },
    detached: () => { chart = null; series = null; requestUpdate = null },
  }

  return {
    primitive,
    setLines(next, end) {
      lines = Array.isArray(next) ? next : []
      endTime = end ?? null
      if (requestUpdate) requestUpdate()
    },
  }
}
