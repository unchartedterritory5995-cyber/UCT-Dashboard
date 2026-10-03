// app/src/components/chart/engine/paintPrimitive.js
//
// ─── ⭐⭐ B1: PINE'S `bgcolor(…)` — THE BAR'S BACKGROUND, DRAWN ─────────────────
//
// A Pine `bgcolor(c)` fills the whole height of the script's pane behind each bar
// whose colour is not `na`. This is that drawing, as ONE lightweight-charts
// primitive per `bgcolor` call — never one object per bar — attached to a series
// already in the right pane (the script's own first series, or the candles for an
// overlay script that binds none), so it inherits that pane by construction.
//
// ⛔ THE SAME SPLIT `fillPrimitive.js` STATES: a pure core and a thin shell.
// `backgroundRuns` answers the whole question — which horizontal spans get which
// colour — and is tested without a canvas; `draw` only paints its answer.
//
// ⛔ A RUN IS A MAXIMAL STRETCH OF ADJACENT BARS IN ONE COLOUR, so a shaded week
// is one rectangle, not five abutting ones whose anti-aliased seams would show as
// faint lines. A bar with no colour (`na`, or the transparent `na` palette entry)
// ends a run and draws nothing.

import { withAlpha } from '../designTokens'

/** True for a colour that draws nothing: any fully transparent colour. Pine's
 *  `na` arrives as `rgba(0, 0, 0, 0)` (the palette's transparent entry). */
export function isClearColour(c) {
  if (typeof c !== 'string') return true
  const s = c.trim().toLowerCase()
  let m = /^rgba\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([\d.]+)\s*\)$/.exec(s)
  if (m) return Number(m[1]) === 0
  m = /^#[0-9a-f]{6}([0-9a-f]{2})$/.exec(s)
  if (m) return m[1] === '00'
  return s === 'transparent'
}

/** Pine's `na` colour as a BAR override: transparent BLACK. A `barcolor(na)` keeps
 *  the candle's own colour; a `barcolor(color.new(color.red, 100))` makes it
 *  invisible, as TradingView does. Only the first is "no override". */
export function isNaColour(c) {
  if (typeof c !== 'string') return true
  const s = c.replace(/\s+/g, '').toLowerCase()
  return s === 'rgba(0,0,0,0)' || s === '#00000000' || s === 'transparent'
}

/**
 * The horizontal runs a background paints this frame.
 *
 * @param {Array} times      the bars' times, as the chart's series hold them
 * @param {Array} colors     one css colour (or null) per bar
 * @param {(t)=>number|null} timeToX
 * @param {number} spacing   the chart's bar spacing in px
 * @returns {Array<{x0:number, x1:number, color:string}>}
 */
export function backgroundRuns(times, colors, timeToX, spacing) {
  const len = (a) => (a && typeof a.length === 'number' ? a.length : 0)
  const n = Math.min(len(times), len(colors))
  const half = Number.isFinite(spacing) && spacing > 0 ? spacing / 2 : 0.5
  const out = []
  let cur = null
  let prevX = null
  for (let i = 0; i < n; i += 1) {
    const c = colors[i]
    const x = c == null || isClearColour(c) ? null : timeToX(times[i])
    if (x == null || !Number.isFinite(x)) {
      if (cur) { out.push(cur); cur = null }
      prevX = null
      continue
    }
    // ⛔ ADJACENT ON SCREEN, not merely adjacent in the array: a run never spans a
    // gap wider than one bar (a hole in the data, or a bar the chart did not place).
    const adjacent = prevX !== null && Math.abs(x - prevX) <= half * 2 * 1.5
    if (cur && adjacent && cur.color === c) {
      cur.x1 = x + half
    } else {
      if (cur) out.push(cur)
      cur = { x0: x - half, x1: x + half, color: c }
    }
    prevX = x
  }
  if (cur) out.push(cur)
  return out
}

/**
 * A lightweight-charts series primitive that shades whole-height columns of its
 * host series' pane. Same contract as `createFillPrimitive`.
 * opts: `{ times, colors }`
 */
export function createBackgroundPrimitive(initial) {
  let opts = { times: null, colors: null, ...initial }
  let chart = null
  let requestUpdate = null

  const paneView = {
    // ⛔ BEHIND THE SERIES: TradingView draws a script's background under every
    // plot and candle in the pane.
    zOrder: () => 'bottom',
    renderer: () => ({
      draw: (target) => {
        if (!chart) return
        const { times, colors } = opts
        if (!times || !colors) return
        const ts = chart.timeScale()
        const timeToX = (t) => { try { return ts.timeToCoordinate(t) } catch { return null } }
        let spacing = 6
        try { spacing = ts.options().barSpacing } catch { /* the default stands */ }
        const runs = backgroundRuns(times, colors, timeToX, spacing)
        if (!runs.length) return
        target.useBitmapCoordinateSpace(({ context: ctx, bitmapSize, horizontalPixelRatio: hpr }) => {
          ctx.save()
          for (const r of runs) {
            const x0 = Math.round(r.x0 * hpr)
            const x1 = Math.round(r.x1 * hpr)
            if (x1 <= x0) continue
            ctx.fillStyle = r.color
            ctx.fillRect(x0, 0, x1 - x0, bitmapSize.height)
          }
          ctx.restore()
        })
      },
    }),
  }

  const primitive = {
    // read-only, for a host or a test that needs what this background is drawing
    options: () => opts,
    paneViews: () => [paneView],
    updateAllViews: () => {},
    attached: (param) => {
      chart = param.chart || null
      requestUpdate = param.requestUpdate || null
    },
    detached: () => { chart = null; requestUpdate = null },
  }

  return {
    primitive,
    options: () => opts,
    setOptions(patch) { opts = { ...opts, ...patch }; if (requestUpdate) requestUpdate() },
  }
}

/** A static paint's colour with its opacity folded in (`withAlpha` multiplies). */
export function staticPaintColour(paint) {
  const raw = paint && typeof paint.color === 'string' ? paint.color : null
  if (!raw) return null
  const a = paint.opacity
  if (!Number.isFinite(a) || a >= 1) return raw
  return withAlpha(raw, a) || raw
}
