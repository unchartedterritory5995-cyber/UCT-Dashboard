// app/src/components/chart/drawingTools.js — what a drawing TOOL needs, for code that places drawings
// without a mouse (UCT Agent's anchored tools, tests). Pure: no React, no store, no chart.
//
// ⭐ PRODUCT-HANDOFFS §11 / PHASE2-SHARED-CONTRACT C-3 (Charts operator P1, 2026-10-27). Three exports:
//   POINT_COUNT          how many points each toolbar tool is placed with — the SAME table ChartDrawingOverlay
//                        places with (drawingTools.test.js reads the overlay's own literal and fails on any
//                        difference; the overlay's table stays where its own source-reading tests pin it).
//   drawingTimeFor(t,tf) a real date/time → the DISPLAY time a stored point carries on that timeframe
//                        ('YYYY-MM-DD' on D/W/M, ET-shifted epoch seconds intraday) — patternTime's own
//                        conversion (the one PatternOverlay draws with), never a second one.
//   validateDrawing(type, points, {tf})  whether a points array is one the overlay can draw for that tool.
//
// It changes nothing about how drawings are stored or drawn (drawingSchema.js rules: points are never
// rewritten). A drawing a member draws by hand is unaffected.

import { toChartTime, isDateTf } from './patternTime'

/** Points per tool, exactly as the overlay places them (a tool not listed takes 2). */
export const POINT_COUNT = Object.freeze({
  trendline: 2, ray: 2, extended: 2, horizontal: 1, hray: 1, vertical: 1,
  rect: 2, circle: 2, arrow: 2, text: 1, fib: 2, fibext: 2, channel: 3, measure: 2, avwap: 1,
  pitchfork: 3, advance: 2, cup: 3,
  priceRange: 2, dateRange: 2, position: 3,
})

// The tools whose one point is a PRICE ONLY (a level has no time anchor — the price-axis menu's own
// "Draw horizontal line at $X" stores `[{price}]`).
const PRICE_ONLY = new Set(['horizontal'])
const FUTURE_BARS_CAP = 500
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

/**
 * A real anchor time → the display time a stored point carries on `tf` (null when unrecognisable —
 * never a guess). Accepts 'YYYY-MM-DD', a YYYYMMDD integer, or UTC epoch seconds.
 */
export function drawingTimeFor(t, tf) {
  return toChartTime(t, tf)
}

/**
 * Can the overlay draw `points` as a `type` drawing on timeframe `tf`?
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function validateDrawing(type, points, { tf = 'D' } = {}) {
  if (!Object.prototype.hasOwnProperty.call(POINT_COUNT, type)) return { ok: false, reason: `unknown tool “${type}”` }
  const need = POINT_COUNT[type]
  if (!Array.isArray(points) || points.length !== need) return { ok: false, reason: `${type} takes ${need} point${need === 1 ? '' : 's'}` }
  const dateTf = isDateTf(tf)
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i]
    if (!p || typeof p !== 'object' || Array.isArray(p)) return { ok: false, reason: `point ${i + 1} is not a point` }
    if (!Number.isFinite(p.price)) return { ok: false, reason: `point ${i + 1} has no price` }
    if (PRICE_ONLY.has(type)) continue
    const okTime = dateTf ? (typeof p.time === 'string' && ISO_DAY.test(p.time)) : (typeof p.time === 'number' && Number.isFinite(p.time) && p.time > 0)
    if (!okTime) return { ok: false, reason: `point ${i + 1} needs a ${dateTf ? 'YYYY-MM-DD date' : 'display time (ET-shifted seconds)'} on this timeframe` }
    if (p.futureBars != null && !(Number.isInteger(p.futureBars) && p.futureBars >= 0 && p.futureBars <= FUTURE_BARS_CAP)) {
      return { ok: false, reason: `point ${i + 1} is too far past the last bar` }
    }
  }
  return { ok: true }
}
