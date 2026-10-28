// app/src/components/tickerPopupChartFit.js
//
// The TickerPopup chart's height, DERIVED from the room the modal actually has.
//
// The chart used to be a flat `min(820px, 68vh)` inside a modal capped at `min(1150px, 88vh)`.
// Everything else in the modal (header, mode row, the pane's identity row, timeframe bar and
// meta row, the chart area's padding) is not a function of the viewport, so on a short
// landscape screen the sum ran past the cap and the bottom of the chart -- the A/L/% chips
// and the date axis -- sat under the modal's edge until you scrolled inside it. Measured in
// WebKit: 1194x834 touch 765px of content in 732px, 1200x800 mouse 742 in 702.
//
// So the chart takes what is LEFT: the modal's max content height minus everything that is
// not the chart. That "chrome" does not depend on the chart's height, so one measurement
// settles it and re-measuring gives the same answer (no feedback loop). On a tall screen the
// 820px / 68vh caps still bind first, so a 1366x1024 or 1920x1080 desktop is unchanged.
//
// Phone (<=640) has `max-height: none` -- a full-screen modal that scrolls by design -- and
// is left exactly as it was.

/** The class the popup hands StockChart (its wrapper) so the measurement can find it. */
export const CHART_FIT_TARGET = 'uct-ticker-popup-chart-fit'

/** The chart never shrinks below this; past it, the modal scrolls as before. */
export const CHART_FIT_FLOOR_PX = 280

/** Re-measurements within this many px are ignored (rounding must never oscillate). */
export const CHART_FIT_HYSTERESIS_PX = 2

const px = (v) => {
  const n = parseFloat(v)
  return Number.isFinite(n) ? n : 0
}

/**
 * The chart height (px) that makes the modal's content fit its max height, or null when the
 * modal has no max height (phone) or the inputs are unusable.
 *
 * chrome = everything in the modal's scroll content that is not the chart wrapper:
 *   (modal scrollHeight - chart area box) + chart area's vertical padding + (pane - wrapper)
 * Computed from the PANE, not the area box, so a binding `min-height` on the area is never
 * counted as chrome.
 */
export function fitChartHeightPx({
  maxHeight, borderTop = 0, borderBottom = 0,
  modalScrollHeight, areaHeight, areaPaddingTop = 0, areaPaddingBottom = 0,
  paneHeight, wrapperHeight,
}) {
  const maxH = parseFloat(maxHeight)
  if (!Number.isFinite(maxH)) return null
  if (![modalScrollHeight, areaHeight, paneHeight, wrapperHeight].every(Number.isFinite)) return null
  const maxClient = maxH - px(borderTop) - px(borderBottom)   // box-sizing: border-box (tokens.css)
  const chrome = (modalScrollHeight - areaHeight) + px(areaPaddingTop) + px(areaPaddingBottom)
    + (paneHeight - wrapperHeight)
  return Math.max(CHART_FIT_FLOOR_PX, Math.floor(maxClient - chrome))
}

/** The CSS height StockChart gets: the old caps, plus the fitted ceiling once it is known. */
export function chartHeightCss(fitPx) {
  return fitPx == null ? 'min(820px, 68vh)' : `min(820px, 68vh, ${fitPx}px)`
}

/** Should a fresh measurement replace the current one? */
export function shouldUpdateFit(prev, next) {
  if (prev == null || next == null) return prev !== next
  return Math.abs(next - prev) > CHART_FIT_HYSTERESIS_PX
}
