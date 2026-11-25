// app/src/components/chart/labelRoom.js
//
// ⭐ ROOM FOR LABELS AT THE NEWEST BAR (owner ruling 2026-11-24). Fred RS writes "RS Rating" and its number at the
// newest bar. TradingView leaves 10 empty bars right of it (measured on the capture rig: 14.4 days on 1D, 9.9 weeks on
// 1W) and the label reads in full there; our right margin (`rightMargin.js`, ~5% of the plot) put it under the price
// scale ("RS Rat"). The owner chose to keep our margin and make room ONLY when a label needs it: the object layer reports
// how many px a label anchored on the plot runs past its right edge (`objectCanvas.paintObjects` →
// `labelOverflowRight`), and this scrolls the newest bar left by that many bars, bar spacing unchanged.
//
// ⛔ ONLY WHILE THE NEWEST BAR IS ON THE PLOT (`scrollPosition() >= 0`). A member who scrolled into history has no
// label anchored on the plot (the layer counts none), so their view is never moved.
// ⛔ CAPPED at MAX_LABEL_ROOM_FRAC of the visible width: a runaway label can never push the candles off the chart.
// ⛔ GROWS ONLY. Nothing here shrinks a gap: once the label fits, the layer reports 0 and this does nothing.

export const MAX_LABEL_ROOM_FRAC = 0.35
export const LABEL_ROOM_PAD_BARS = 1

const finite = (x) => typeof x === 'number' && Number.isFinite(x)

/** The right offset (bars) that gives `overflowPx` of room, or null when nothing should move. Pure: the rails read it. */
export function labelRoomOffset({ overflowPx, scrollPosition, barSpacing, visibleBars }) {
  if (!(finite(overflowPx) && overflowPx > 0)) return null
  if (!(finite(scrollPosition) && scrollPosition >= 0)) return null
  if (!(finite(barSpacing) && barSpacing > 0)) return null
  const want = scrollPosition + Math.ceil(overflowPx / barSpacing) + LABEL_ROOM_PAD_BARS
  const cap = finite(visibleBars) && visibleBars > 0 ? visibleBars * MAX_LABEL_ROOM_FRAC : Infinity
  const next = Math.min(want, cap)
  return next > scrollPosition + 0.5 ? next : null
}

/** Apply it to a chart's time scale (lightweight-charts' `ITimeScaleApi`). Returns the offset set, or null. */
export function makeRoomForLabels(timeScale, overflowPx) {
  if (!timeScale || typeof timeScale.scrollPosition !== 'function' || typeof timeScale.scrollToPosition !== 'function') return null
  let barSpacing = null
  let visibleBars = null
  try { barSpacing = timeScale.options().barSpacing } catch { barSpacing = null }
  try {
    const r = timeScale.getVisibleLogicalRange()
    visibleBars = r ? r.to - r.from : null
  } catch { visibleBars = null }
  const next = labelRoomOffset({ overflowPx, scrollPosition: timeScale.scrollPosition(), barSpacing, visibleBars })
  if (next === null) return null
  timeScale.scrollToPosition(next, false)
  return next
}
