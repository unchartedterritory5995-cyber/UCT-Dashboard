// app/src/components/chart/zoomOutLimit.js — how far a chart zooms out.
//
// ⭐ (2026-11-28, cold-arch report section 3.3 item 7) THE CHART'S OWN FLOOR, NOT THE LIBRARY'S. lightweight-charts'
// default `minBarSpacing` is 0.5 px, so a time axis holds at most plot width / 0.5 bars: 787 on the 394 px plot of the
// production rig's chart cell, about three years of a daily chart. The owner's bar is a daily chart zoomed out to hold
// 2014-2026 (~3,250 sessions). At 0.1 px the same plot holds 3,940 bars; a wider chart holds more.
// The floor stays above 0: the library divides by it, and a wheel or pinch must still stop somewhere.
// Below ~1 px per bar the library draws each candle as a one-pixel line (its own narrow-bar path), so the cost of a
// frame is the number of bars on screen, which the render window (windowedChart.js) already sizes to the view.

export const MIN_BAR_SPACING = 0.1

/** The most bars a time axis `widthPx` wide can show at `minBarSpacing` (the library's own clamp, rounded up). */
export function maxVisibleBars(widthPx, minBarSpacing = MIN_BAR_SPACING) {
  if (!(widthPx > 0) || !(minBarSpacing > 0)) return 0
  return Math.ceil(widthPx / minBarSpacing)
}
