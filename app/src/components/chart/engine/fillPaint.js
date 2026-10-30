// app/src/components/chart/engine/fillPaint.js
//
// ─── ⭐⭐ THE ONE ANSWER TO "WHAT RGBA DOES THIS FILL PAINT" ─────────────────
//
// A band's final colour is two facts: its COLOUR (a static `fillColor`, or the
// per-bar colour its `colorMode` rule picks — up/down, a palette entry, a
// gradient blend, a runtime-packed colour) and its OPACITY (`plots[].fillOpacity`,
// the field every door writes: the member pane's Pine translation, the Builder
// sheet, the conversational authoring model). This module joins them, and it is
// the only place that does — the static band (`fillPrimitive`'s one-style frame)
// and the per-bar band (`binder.bandColoursFor`) both paint through `fillPaint`.
//
// ⚰️ THERE WERE TWO, AND THEY DISAGREED. The static path read `plot.fillOpacity`
// (`binder.effectiveFillColour`); the per-bar path handed the fill SPEC to
// `pool.columnColorsForPlot`, whose alpha comes from `plotAlpha(spec)` — i.e. a
// `fill.opacity` that no door has ever written. So every conditional band a
// member imported painted FULLY OPAQUE: Uncharted Clouds' twenty bands drew solid
// #089981/#880E4F where TradingView draws alpha bytes 13, 19, 25, … 134 (5% →
// 52.5%), measured on captures A (SPY 1D) and D (SPY 4H). The rail that "proved"
// the alpha set `fill.opacity` by hand — a document shape no door produces.
//
// ⭐ EXACT BYTES. The alpha is encoded `#RRGGBBAA` with TradingView's own byte,
// `round(opacity × 255)` where `opacity = 1 − t/100` (`designTokens.withAlphaByte`
// says why a decimal `rgba()` string cannot carry that).

import { withAlphaByte } from '../designTokens'

/** The opacity a STATIC band draws at when its document declares none — the
 *  Builder's long-standing default (`createFillPrimitive`'s own). ⛔ Not applied
 *  to a per-bar band: there the colour rule's colours ARE the paint (a Pine
 *  `fill(…, color = c ? color.red : color.green)` is opaque), as it always was. */
export const FILL_DEFAULT_OPACITY = 0.15

/** The band's declared opacity in [0, 1], or null when the document says
 *  nothing. ONE field: `plots[].fillOpacity`. */
export function fillOpacityOf(plot) {
  const o = plot && plot.fillOpacity
  return Number.isFinite(o) ? Math.max(0, Math.min(1, o)) : null
}

/** One colour at one band opacity → the exact paint, or null for no colour.
 *  `opacity` null (or ≥ 1) leaves the colour exactly as given. */
export function fillPaint(colour, opacity) {
  if (typeof colour !== 'string' || !colour) return null
  if (opacity === null || opacity === undefined || !(opacity < 1)) return colour
  return withAlphaByte(colour, opacity) || colour
}

/** A static band's colour and opacity, before `fillPaint` joins them. */
export function staticFillOf(plot) {
  const color = (plot && typeof plot.fillColor === 'string' && plot.fillColor)
    || (plot && typeof plot.color === 'string' && plot.color) || '#2962FF'
  const declared = fillOpacityOf(plot)
  return { color, opacity: declared === null ? FILL_DEFAULT_OPACITY : declared }
}
