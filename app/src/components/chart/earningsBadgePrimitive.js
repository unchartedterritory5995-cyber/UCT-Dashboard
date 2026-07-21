// Lightweight Charts v5 SERIES primitive: a slick "E" earnings badge below each
// reporting bar (replaces the plain LWC dot+text marker). A filled rounded pill in
// the beat/miss color with a dark glyph, TradingView-ish. Attached to the candle
// series so `attached({ chart, series })` gives priceToCoordinate; time→x from the
// chart timeScale. Click handling stays in StockChart (time-matched), so this is
// draw-only. Points come with the bar LOW so the badge hugs just under the candle.

const FONT_FAMILY = "'Instrument Sans', sans-serif"
const ROW_BOTTOM = 6   // px from the price-pane bottom (badges sit just above volume)
const PAD_X = 6        // px horizontal padding inside the pill
const PAD_Y = 3        // px vertical padding
// Fallback glyph color. Normally StockChart passes `glyphColor` = the chart canvas
// color, so the "E" reads as punched out of the pill and shows the background through
// it. A true destination-out erase would cut through the chart canvas to the PAGE
// beneath rather than to the chart's own background, so painting the canvas color is
// both simpler and correct — identical on a solid canvas.
const GLYPH = '#0c0c0e' // near-black, matching the default dark canvas

// Factory → { primitive, setPoints, setOptions }.
// opts: { enabled, points:[{time,price,beat}], beatColor, missColor, unknownColor, fontPx }
export function createEarningsBadgePrimitive(initial) {
  let opts = {
    enabled: false,
    points: [],
    beatColor: '#1ae51a',
    missColor: '#c41f2d',
    unknownColor: '#94a3b8',
    glyphColor: null,   // null = GLYPH fallback; StockChart passes the canvas color
    fontPx: 11,
    ...initial,
  }
  let chart = null
  let series = null
  let requestUpdate = null
  // Screen rects of the badges drawn last frame (media coords, same space as
  // subscribeClick's param.point) → lets StockChart hit-test a click against the
  // WHOLE pill instead of the exact reporting-bar time (which, zoomed out, is a
  // sub-pixel target — the "must click dead-center of the E" complaint).
  let lastHitRects = []

  function colorFor(beat) {
    if (beat === true) return opts.beatColor
    if (beat === false) return opts.missColor
    return opts.unknownColor
  }

  function intersects(rect, drawn) {
    for (const d of drawn) {
      if (rect.x < d.x + d.w && rect.x + rect.w > d.x && rect.y < d.y + d.h && rect.y + rect.h > d.y) return true
    }
    return false
  }

  const paneView = {
    zOrder: () => 'top',
    renderer: () => ({
      draw: (target) => {
        if (!opts.enabled || !opts.points.length || !chart || !series) return
        const ts = chart.timeScale()
        target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
          ctx.save()
          ctx.font = `700 ${opts.fontPx}px ${FONT_FAMILY}`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          const gw = ctx.measureText('E').width
          const w = gw + PAD_X * 2
          const h = opts.fontPx + PAD_Y * 2
          const r = Math.min(4, h / 2)
          // Fixed row near the bottom of the price pane (just above the volume pane),
          // so every badge lines up horizontally regardless of price; only x tracks
          // the reporting day. timeToCoordinate is recomputed each frame → the row
          // glides smoothly as the chart pans/zooms.
          const rowTop = mediaSize.height - ROW_BOTTOM - h
          const drawn = []
          const hits = []
          for (const p of opts.points) {
            const x = ts.timeToCoordinate(p.time)
            if (x == null || x < 0 || x > mediaSize.width) continue
            const rect = { x: x - w / 2, y: rowTop, w, h }
            if (rect.x < 0 || rect.x + rect.w > mediaSize.width) continue
            if (intersects(rect, drawn)) continue
            drawn.push(rect)
            hits.push({ x: rect.x, y: rect.y, w: rect.w, h: rect.h, time: p.time })
            // Pill
            ctx.fillStyle = colorFor(p.beat)
            ctx.beginPath()
            if (typeof ctx.roundRect === 'function') ctx.roundRect(rect.x, rect.y, rect.w, rect.h, r)
            else ctx.rect(rect.x, rect.y, rect.w, rect.h)
            ctx.fill()
            // Glyph
            ctx.fillStyle = opts.glyphColor || GLYPH
            ctx.fillText('E', x, rect.y + rect.h / 2 + 0.5)
          }
          lastHitRects = hits
          ctx.restore()
        })
      },
    }),
  }

  const primitive = {
    paneViews: () => [paneView],
    updateAllViews: () => {},
    attached: (param) => { chart = param.chart; series = param.series; requestUpdate = param.requestUpdate },
    detached: () => { chart = null; series = null; requestUpdate = null },
  }

  function redraw() { if (requestUpdate) requestUpdate() }

  // Return the reporting-day time of the badge whose pill (grown by a few px of
  // slop) contains the click point, or null. (px,py) are pane-media coords from
  // chart.subscribeClick's param.point. The whole green box is clickable now.
  function hitTest(px, py, padX = 3, padY = 4) {
    if (!Number.isFinite(px) || !Number.isFinite(py)) return null
    for (const r of lastHitRects) {
      if (px >= r.x - padX && px <= r.x + r.w + padX &&
          py >= r.y - padY && py <= r.y + r.h + padY) return r.time
    }
    return null
  }

  return {
    primitive,
    hitTest,
    setPoints(points) { opts.points = Array.isArray(points) ? points : []; redraw() },
    setOptions(patch) { opts = { ...opts, ...patch }; redraw() },
  }
}
