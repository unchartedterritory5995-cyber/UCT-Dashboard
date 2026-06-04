// Lightweight Charts v5 SERIES primitive: prints the price at each notable swing
// high (above the bar) and swing low (below the bar), MarketSurge-style. Attached
// to the candle series so `attached({ chart, series })` provides priceToCoordinate;
// time→x comes from chart.timeScale(). Pivot points come from swingPivots.js.

const FONT_FAMILY = "'Instrument Sans', sans-serif"
const GAP = 5          // px gap between the wick tip and the label
const HALO_WIDTH = 3   // px outline that keeps text readable over candles/grids

// Factory → { primitive, setPoints, setOptions }.
// opts: { enabled, points:[{time,price,type}], color, tintByType, upColor, downColor, bg, fontPx }
export function createSwingLabelsPrimitive(initial) {
  let opts = {
    enabled: false,
    points: [],
    color: '#d4d0c4',
    tintByType: false,
    upColor: '#4ade80',
    downColor: '#f87171',
    bg: '#1a1c17',
    fontPx: 11,
    ...initial,
  }
  let chart = null
  let series = null
  let requestUpdate = null

  function colorFor(type) {
    if (!opts.tintByType) return opts.color
    return type === 'high' ? opts.upColor : opts.downColor
  }

  // Skip a label whose box intersects an already-drawn box (light de-clutter).
  function intersects(rect, drawn) {
    for (const d of drawn) {
      if (rect.x < d.x + d.w && rect.x + rect.w > d.x && rect.y < d.y + d.h && rect.y + rect.h > d.y) {
        return true
      }
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
          ctx.font = `600 ${opts.fontPx}px ${FONT_FAMILY}`
          ctx.textAlign = 'center'
          ctx.lineJoin = 'round'
          ctx.lineWidth = HALO_WIDTH
          ctx.strokeStyle = opts.bg
          const fh = opts.fontPx
          const drawn = []
          for (const p of opts.points) {
            const x = ts.timeToCoordinate(p.time)
            if (x == null || x < 0 || x > mediaSize.width) continue
            const y = series.priceToCoordinate(p.price)
            if (y == null || y < 0 || y > mediaSize.height) continue
            const label = Number(p.price).toFixed(2)
            const w = ctx.measureText(label).width
            const isHigh = p.type === 'high'
            const ty = isHigh ? y - GAP : y + GAP
            const boxY = isHigh ? ty - fh : ty
            const rect = { x: x - w / 2 - 2, y: boxY - 1, w: w + 4, h: fh + 2 }
            if (rect.x < 0 || rect.x + rect.w > mediaSize.width) continue
            if (intersects(rect, drawn)) continue
            drawn.push(rect)
            ctx.textBaseline = isHigh ? 'bottom' : 'top'
            ctx.strokeText(label, x, ty)
            ctx.fillStyle = colorFor(p.type)
            ctx.fillText(label, x, ty)
          }
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

  return {
    primitive,
    setPoints(points) { opts.points = Array.isArray(points) ? points : []; redraw() },
    setOptions(patch) { opts = { ...opts, ...patch }; redraw() },
  }
}
