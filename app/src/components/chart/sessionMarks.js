// ── SESSION MARKS — Chart Settings "Session breaks" + "Pre-market high & low" (owner 11-15) ──
//
// Two intraday-only marks, computed from the bars the chart has LOADED (never fetched for):
//   · Session breaks: a thin dashed vertical line at the first bar of each new trading day
//     (TradingView's convention: the line sits at the session start, i.e. the 04:00 bar when
//     extended hours are shown, the 09:30 bar when they are not). The first loaded day gets
//     none: a break is BETWEEN two sessions.
//   · Pre-market high / low: the highest high and lowest low of the LATEST session's
//     pre-market (04:00 ≤ ET < 09:30). No pre-market bars loaded (extended hours off, or none
//     yet) → null, and nothing is drawn.
//
// ⭐ THE TIMES ARE CHART TIMES: intraday bars reach lightweight-charts as ET wall clock written
// as UTC seconds (barTime.toChartTime, DST resolved per instant from Intl), so the ET day is
// floor(t / 86400) and the ET minute is (t mod 86400) / 60 with NO offset arithmetic here —
// the same basis sessionShadingPrimitive and prevDayLevelsPrimitive use. Holidays have no bars,
// so they need no special case; a half-day's pre-market is the usual 04:00–09:30 (only its
// close moves, which neither mark reads). Daily/weekly bars carry string times → nothing.

import { RTH_OPEN_MIN } from './barTime'

export const PRE_MARKET_START_MIN = 4 * 60   // 04:00 ET (market_calendar.json sessions.pre_start)

const timeOf = (b) => (b?.time ?? b?.t)
const dayOf = (t) => Math.floor(t / 86400)
const minuteOf = (t) => Math.floor(((((Math.floor(t)) % 86400) + 86400) % 86400) / 60)

/** Chart times of the first bar of each new ET trading day (after the first loaded day). Pure. */
export function sessionBreakTimes(bars) {
  if (!Array.isArray(bars) || bars.length < 2) return []
  if (typeof timeOf(bars[0]) !== 'number') return []   // daily / weekly: string times
  const out = []
  let prevDay = dayOf(timeOf(bars[0]))
  for (let i = 1; i < bars.length; i++) {
    const t = timeOf(bars[i])
    if (typeof t !== 'number' || !Number.isFinite(t)) continue
    const d = dayOf(t)
    if (d > prevDay) out.push(t)
    if (d !== prevDay) prevDay = d
  }
  return out
}

/**
 * The latest session's pre-market range from the loaded bars: { high, low, highTime, lowTime }
 * (prices from each bar's high / low), or null when that session has no pre-market bars. Pure.
 */
export function preMarketRange(bars) {
  if (!Array.isArray(bars) || !bars.length) return null
  const lastT = timeOf(bars[bars.length - 1])
  if (typeof lastT !== 'number' || !Number.isFinite(lastT)) return null
  const day = dayOf(lastT)
  let hi = -Infinity, lo = Infinity, hiT = null, loT = null
  for (let i = bars.length - 1; i >= 0; i--) {
    const b = bars[i]
    const t = timeOf(b)
    if (typeof t !== 'number') continue
    if (dayOf(t) !== day) break
    const m = minuteOf(t)
    if (m < PRE_MARKET_START_MIN || m >= RTH_OPEN_MIN) continue
    const h = b.high ?? b.h, l = b.low ?? b.l
    if (Number.isFinite(h) && h > hi) { hi = h; hiT = t }
    if (Number.isFinite(l) && l < lo) { lo = l; loT = t }
  }
  if (!Number.isFinite(hi) || !Number.isFinite(lo)) return null
  return { high: hi, low: lo, highTime: hiT, lowTime: loT }
}

/** The two price lines (lightweight-charts createPriceLine options) for a range, or []. Pure. */
export function preMarketPriceLines(range, color) {
  if (!range) return []
  const base = { color, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, lineVisible: true }
  return [
    { ...base, price: range.high, title: 'PM high' },
    { ...base, price: range.low, title: 'PM low' },
  ]
}

// The break line's colour: the chart's muted TEXT colour at a fixed ~1/3 strength, so it reads as a quiet
// hairline on every theme. (Owner test 11-16: the first cut used the grid colour, which on the dark
// themes is an OPAQUE near-background grey — the line was invisible.) An unreadable or transparent
// colour falls back to the next one, then to mid grey. Pure.
const MIN_ALPHA = 0.35
function _rgba(c) {
  if (typeof c !== 'string') return null
  let m = /^#([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})?$/i.exec(c.trim())
  if (m) return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16), m[4] ? parseInt(m[4], 16) / 255 : 1]
  m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(c.trim())
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] == null ? 1 : Number(m[4])]
  return null
}
export function sessionBreakColor(gridColor, borderColor) {
  for (const c of [gridColor, borderColor]) {
    const p = _rgba(c)
    if (!p || p[3] <= 0) continue
    return `rgba(${p[0]},${p[1]},${p[2]},${MIN_ALPHA})`
  }
  return `rgba(128,128,128,${MIN_ALPHA})`
}

// Lightweight Charts v5 PANE primitive: a dashed full-height vertical line at each time. Same shape
// as sessionShadingPrimitive (pane-level, bottom z-order so candles draw over it, canvas so a
// screenshot export captures it).
export function createSessionBreaksPrimitive() {
  let times = []
  let color = `rgba(128,128,128,${MIN_ALPHA})`
  let chart = null
  let requestUpdate = null
  const paneView = {
    // 'normal', not 'bottom': the session-shading bands are a bottom-layer fill that starts exactly at the day
    // boundary, so a bottom-layer break line was painted over (owner test 11-16).
    zOrder: () => 'normal',
    renderer: () => ({
      draw: (target) => {
        if (!chart || !times.length) return
        const ts = chart.timeScale()
        // ⭐ ONLY THE BREAKS ON SCREEN (2026-11-18): this draws every frame, and a deep 1h chart
        // holds ~5,800 day breaks with four coordinate conversions each (the same cost the session
        // shade had, measured live as 70 ms frames). `times` is in time order (sessionBreakTimes).
        let vr = null
        try { vr = ts.getVisibleRange?.() ?? null } catch { vr = null }
        const vFrom = vr && typeof vr.from === 'number' ? vr.from : null
        const vTo = vr && typeof vr.to === 'number' ? vr.to : null
        let start = 0
        if (vFrom != null) {
          let lo = 0, hi = times.length
          while (lo < hi) { const mid = (lo + hi) >> 1; if (times[mid] < vFrom) lo = mid + 1; else hi = mid }
          start = lo
        }
        try {
          target.useBitmapCoordinateSpace(({ context: ctx, bitmapSize, horizontalPixelRatio: hpr, verticalPixelRatio: vpr }) => {
            ctx.save()
            ctx.strokeStyle = color
            ctx.lineWidth = Math.max(1, Math.floor(hpr))
            ctx.setLineDash([Math.round(4 * vpr), Math.round(4 * vpr)])
            ctx.beginPath()
            for (let i = start; i < times.length; i++) {
              const t = times[i]
              if (vTo != null && t > vTo) break
              let x
              try { x = ts.timeToCoordinate(t) } catch { continue }
              if (x == null || !Number.isFinite(x)) continue
              // Half a slot to the LEFT of the bar: the line sits between the two sessions — the midpoint of this
              // bar and the one before it on the time scale's own logical grid (zoom-correct); bar spacing is the
              // fallback. ⛔ Only WHOLE logical indices: LWC answers a fractional one (lg - 0.5) with 0, which drew
              // every break at the left edge (owner test 11-16).
              let left = null
              try {
                const lg = ts.coordinateToLogical?.(x)
                if (lg != null) {
                  const a = ts.logicalToCoordinate?.(Math.round(lg))
                  const b = ts.logicalToCoordinate?.(Math.round(lg) - 1)
                  if (Number.isFinite(a) && Number.isFinite(b) && a > b) left = (a + b) / 2
                }
              } catch { /* fall back below */ }
              if (left == null || !Number.isFinite(left)) left = x - (ts.options?.().barSpacing ?? 6) / 2
              const xx = Math.round(left * hpr) + 0.5
              if (xx < 0 || xx > bitmapSize.width) continue
              ctx.moveTo(xx, 0)
              ctx.lineTo(xx, bitmapSize.height)
            }
            ctx.stroke()
            ctx.restore()
          })
        } catch { /* never throw from draw() */ }
      },
    }),
  }
  return {
    primitive: {
      paneViews: () => [paneView],
      updateAllViews: () => {},
      attached: (p) => { chart = p.chart; requestUpdate = p.requestUpdate },
      detached: () => { chart = null; requestUpdate = null },
    },
    /** Replace the lines; a no-op (no repaint) when nothing changed. */
    set(nextTimes, nextColor) {
      const nt = Array.isArray(nextTimes) ? nextTimes : []
      const same = nt.length === times.length && nextColor === color && nt.every((t, i) => t === times[i])
      if (same) return
      times = nt
      if (nextColor) color = nextColor
      if (requestUpdate) requestUpdate()
    },
  }
}
