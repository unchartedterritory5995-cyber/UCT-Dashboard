// BarStore framing contract (P2, BARSTORE-SPEC "Renderer & framing"). NOT WIRED yet.
//
// ⭐ THE CONTRACT, in logical-index space (LWC: bar i sits at logical i; the visible range
// is {from, to} and bar spacing = plotWidth / (to - from + 1)):
//   K1  After a KEY CHANGE (symbol / tf / session) the renderer setData()s the complete
//       new series and, synchronously in the same call (so the same animation frame),
//       sets ONE logical range:  to = n - 1 + rightPadBars,  from = to - W,
//       with W = the outgoing view's visible width (to - from), or `defaultVisibleBars`
//       on a first paint, and rightPadBars = rightMarginBars(W, plotWidthPx) (below).
//       W and the plot width are preserved ⇒ the newest bar's x and the bar spacing are
//       INVARIANT across tf / symbol switches.
//   K2  Deep history is a LEFT PREPEND only: the range shifts by exactly the number of
//       bars added on the left, so every on-screen bar (and the right edge) stays put.
//   K3  Same key, new base (append / seal / correction): the renderer never sets a range;
//       LWC keeps rightOffset measured from the last bar, which is the live-chart rule.
//   K4  A key change whose snapshot has no bars paints NOTHING (holds the outgoing frame;
//       the host shows its skeleton) — there is never a blank frame between two series.
//
// ⭐ RIGHT-MARGIN POLICY — ONE DEFINITION. The newest candle sits at LAST_CANDLE_POS of the
// plot width (with a pixel minimum gap so it clears the price-scale tags on a narrow
// widget, capped so a thin widget doesn't waste a sixth of its width). In bars, for a
// visible width W:  rightMarginBars = W * (1 - lastCandlePos(plotWidthPx)).
// These are StockChart's values (LAST_CANDLE_POS / MIN_RIGHT_GAP_PX / MAX_RIGHT_GAP_FRAC /
// lastCandlePos) and exactly the margin W-R's `pinNewestRange(lastIdx, W, plotPx)`
// (charts/symbol-switch-pinned) builds: to = lastIdx + W*(1 - lastCandlePos(plotPx)).
// This module is meant to become the single owner: at P3-S3 StockChart imports these
// instead of keeping its own copies (it is NOT wired yet, so nothing imports them today).

export const LAST_CANDLE_POS = 0.95
export const MIN_RIGHT_GAP_PX = 34
export const MAX_RIGHT_GAP_FRAC = 0.16

const finite = (x) => typeof x === 'number' && Number.isFinite(x)

/** The newest candle's x as a fraction of the plot width (StockChart.lastCandlePos). */
export function lastCandlePos(plotWidthPx) {
  if (!finite(plotWidthPx) || plotWidthPx <= 0) return LAST_CANDLE_POS
  const gap = Math.min(MAX_RIGHT_GAP_FRAC, Math.max(1 - LAST_CANDLE_POS, MIN_RIGHT_GAP_PX / plotWidthPx))
  return 1 - gap
}

/** Empty logical slots right of the newest bar for a visible width W. */
export function rightMarginBars(W, plotWidthPx) {
  return W * (1 - lastCandlePos(plotWidthPx))
}

/** Visible width W (= to - from) of a logical range, or null. */
export function visibleWidthOf(range) {
  if (!range || !finite(range.from) || !finite(range.to)) return null
  const w = range.to - range.from
  return w > 0 ? w : null
}

/** K1 — the one logical range after a key-change setData of `n` bars. */
export function frameAfterKeyChange({ n, prevRange = null, defaultVisibleBars = null, plotWidthPx = null, rightPadBars = null }) {
  const W = visibleWidthOf(prevRange) ?? (finite(defaultVisibleBars) && defaultVisibleBars > 0 ? defaultVisibleBars : Math.max(1, n))
  const pad = finite(rightPadBars) ? rightPadBars : rightMarginBars(W, plotWidthPx)
  const to = n - 1 + pad
  return { from: to - W, to }
}

/** K2 — the range after `added` bars were prepended on the left. */
export function frameAfterPrepend(prevRange, added) {
  if (!prevRange || !(added > 0)) return prevRange
  return { from: prevRange.from + added, to: prevRange.to + added }
}

/** Pixel x (bar centre) of logical index `i` for a range on a plot `widthPx` wide —
 *  LWC's geometry (newest-relative), used by the invariant tests. */
export function xOfLogical(range, i, widthPx) {
  const spacing = widthPx / (range.to - range.from + 1)
  return widthPx - (range.to - i + 0.5) * spacing
}
