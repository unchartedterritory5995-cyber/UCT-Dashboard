// Lightweight Charts v5 pane primitive: shades pre-market (04:00–09:30 ET) and
// post-market (16:00–20:00 ET) regions BEHIND the series (bottom z-order), so
// regular-hours price action stands out. Intraday timeframes only.
//
// Intraday chart times are ET-offset unix seconds (barTime.toChartTime, offset
// resolved per instant), so reading them via UTC getters yields the Eastern clock.

import { rthCloseMinuteOfChartTime } from './barTime'

const PRE_START = 4 * 60          // 04:00
const RTH_START = 9 * 60 + 30     // 09:30
const POST_END = 20 * 60          // 20:00
// The regular close is the DAY's close (13:00 on an NYSE half-day) — barTime owns it.

// Classify a bar's session from its ET-offset unix-seconds timestamp.
// Returns 'pre' | 'post' | null (null = regular hours or closed = unshaded).
//
// PERF: minutes-past-midnight is derived arithmetically rather than through
// `new Date(tSec * 1000).getUTCHours()`. This runs once per bar per band pass, and
// on a deep extended-hours intraday chart that was thousands of Date allocations
// per pass — measurable GC pressure in the middle of a pan. The timestamps are
// already ET-offset unix seconds, so UTC-midnight modulo IS the Eastern clock;
// `%` handles negative (pre-1970) values via the double-mod, which never occurs in
// practice but keeps the function total.
export function classifySession(tSec) {
  if (!Number.isFinite(tSec)) return null
  const secOfDay = ((Math.floor(tSec) % 86400) + 86400) % 86400
  const m = Math.floor(secOfDay / 60)
  if (m >= PRE_START && m < RTH_START) return 'pre'
  if (m >= RTH_START && m < POST_END && m >= rthCloseMinuteOfChartTime(tSec)) return 'post'
  return null
}

// Group consecutive shaded bars into bands. Each band: { from, to, type } where
// from/to are CHART time values. `shift` maps a raw bar timestamp to the chart's
// time value (adjustTime = barTime.toChartTime). It MUST be applied so that (a) the
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

/**
 * Index of the first band whose `to` reaches `from` (bands are in time order, as
 * computeSessionBands builds them). Non-numeric times (never on an intraday chart)
 * answer 0, so the draw walks every band as before.
 */
export function firstBandReaching(bands, from) {
  if (typeof from !== 'number' || !Number.isFinite(from)) return 0
  let lo = 0, hi = bands.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    const to = bands[mid]?.to
    if (typeof to === 'number' && to < from) lo = mid + 1
    else hi = mid
  }
  return lo
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
  let fills = null   // { pre, post } rgba strings for the current colors / opacity

  // ⭐ ONLY THE BANDS ON SCREEN (2026-11-18). This draws on EVERY frame (pan, zoom, crosshair
  // move, live tick), and it used to walk every band in the history with two timeToCoordinate
  // calls each. A deep extended-hours 1h chart (50,000 bars, ~23 years) holds ~11,600 bands,
  // twice over (price pane + volume pane): ~46,000 coordinate lookups a frame, measured live as
  // 70 ms frames and a skippy crosshair. A frame shows at most a few hundred bars, so the draw
  // binary-searches the first band reaching the visible range and stops past its end.
  const paneView = {
    zOrder: () => 'bottom',
    renderer: () => ({
      draw: (target) => {
        if (!opts.enabled || !opts.bands.length || !chart) return
        const ts = chart.timeScale()
        const bands = opts.bands
        let vr = null
        try { vr = ts.getVisibleRange?.() ?? null } catch { vr = null }
        const vTo = vr && typeof vr.to === 'number' ? vr.to : null
        const start = vr ? firstBandReaching(bands, vr.from) : 0
        if (!fills) fills = { pre: withAlpha(opts.preColor, opts.opacity), post: withAlpha(opts.postColor, opts.opacity) }
        target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
          ctx.save()
          for (let i = start; i < bands.length; i++) {
            const band = bands[i]
            if (vTo != null && typeof band.from === 'number' && band.from > vTo) break
            let x0, x1
            try { x0 = ts.timeToCoordinate(band.from); x1 = ts.timeToCoordinate(band.to) } catch { continue }
            if (x0 == null || x1 == null) continue
            // Pad half-ish a slot on each side so adjacent bars are fully covered.
            const left = Math.min(x0, x1) - 1
            const right = Math.max(x0, x1) + 1
            ctx.fillStyle = band.type === 'pre' ? fills.pre : fills.post
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
    setOptions(patch) { opts = { ...opts, ...patch }; fills = null; if (requestUpdate) requestUpdate() },
  }
}
