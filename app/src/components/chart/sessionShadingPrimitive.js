// Lightweight Charts v5 pane primitive: shades pre-market (04:00–09:30 ET) and
// post-market (16:00–20:00 ET) regions BEHIND the series (bottom z-order), so
// regular-hours price action stands out. Intraday timeframes only.
//
// Intraday bar timestamps are stored as ET-offset unix seconds (see _ET_OFFSET
// in StockChart), so reading them via UTC getters yields the Eastern clock.

const PRE_START = 4 * 60          // 04:00
const RTH_START = 9 * 60 + 30     // 09:30
const RTH_END = 16 * 60          // 16:00
const POST_END = 20 * 60          // 20:00

// Classify a bar's session from its ET-offset unix-seconds timestamp.
// Returns 'pre' | 'post' | null (null = regular hours or closed = unshaded).
export function classifySession(tSec) {
  if (!Number.isFinite(tSec)) return null
  const d = new Date(tSec * 1000)
  const m = d.getUTCHours() * 60 + d.getUTCMinutes()
  if (m >= PRE_START && m < RTH_START) return 'pre'
  if (m >= RTH_END && m < POST_END) return 'post'
  return null
}

// Group consecutive shaded bars into bands. Each band: { from, to, type } where
// from/to are CHART time values. `shift` maps a raw bar timestamp to the chart's
// time value (adjustTime = raw + ET_OFFSET). It MUST be applied so that (a) the
// session is classified on Eastern clock time and (b) from/to match the series'
// time scale — otherwise timeToCoordinate() misplaces the band and nothing draws.
export function computeSessionBands(bars, shift) {
  const bands = []
  if (!Array.isArray(bars) || bars.length === 0) return bands
  const toChartTime = (typeof shift === 'function') ? shift : (t => t)
  let cur = null
  for (const b of bars) {
    const raw = b?.t
    const t = (typeof raw === 'number') ? toChartTime(raw) : raw   // ET-shifted chart time
    const type = classifySession(typeof t === 'number' ? t : NaN)
    if (type && cur && cur.type === type) {
      cur.to = t
    } else {
      if (cur) bands.push(cur)
      cur = type ? { from: t, to: t, type } : null
    }
  }
  if (cur) bands.push(cur)
  return bands
}

function withAlpha(hex, alpha) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '')
  if (!m) return `rgba(120,140,170,${alpha})`
  return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${alpha})`
}

// Factory → { primitive, setOptions }.
// opts: { enabled, bands:[{from,to,type}], preColor, postColor, opacity }
export function createSessionShadingPrimitive(initial) {
  // Time-of-day session tints (TradingView-style): pre-market (04:00-09:30 ET)
  // gets a faint warm SUNRISE amber; post-market (16:00-20:00 ET) a faint EVENING
  // blue. Deliberately low opacity so extended hours read as a subtle colored wash
  // over the near-black canvas without drowning the candles ("very faint").
  let opts = { enabled: false, bands: [], preColor: '#e0a94f', postColor: '#4a72c8', opacity: 0.08, ...initial }
  let chart = null
  let requestUpdate = null

  const paneView = {
    zOrder: () => 'bottom',
    renderer: () => ({
      draw: (target) => {
        if (!opts.enabled || !opts.bands.length || !chart) return
        const ts = chart.timeScale()
        target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
          ctx.save()
          for (const band of opts.bands) {
            let x0, x1
            try { x0 = ts.timeToCoordinate(band.from); x1 = ts.timeToCoordinate(band.to) } catch { continue }
            if (x0 == null || x1 == null) continue
            // Pad half-ish a slot on each side so adjacent bars are fully covered.
            const left = Math.min(x0, x1) - 1
            const right = Math.max(x0, x1) + 1
            ctx.fillStyle = withAlpha(band.type === 'pre' ? opts.preColor : opts.postColor, opts.opacity)
            ctx.fillRect(left, 0, Math.max(1, right - left), mediaSize.height)
          }
          ctx.restore()
        })
      },
    }),
  }

  const primitive = {
    paneViews: () => [paneView],
    updateAllViews: () => {},
    attached: (param) => { chart = param.chart; requestUpdate = param.requestUpdate },
    detached: () => { chart = null; requestUpdate = null },
  }

  return {
    primitive,
    setOptions(patch) { opts = { ...opts, ...patch }; if (requestUpdate) requestUpdate() },
  }
}
