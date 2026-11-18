// BarStore framing contract (P2, BARSTORE-SPEC "Renderer & framing"). NOT WIRED yet.
//
// ⭐ THE CONTRACT, in logical-index space. LWC indexes the UNION of every series' times
// (candle, volume, compare / overlay series, whitespace), so the newest candle's logical
// index is NOT "candle count - 1" whenever another series holds a time the candles do
// not. Every rule below therefore takes the newest bar's index FROM THE TIME SCALE
// (`timeScale.timeToIndex(newestTime)`), never from a count.
//   K1  After a KEY CHANGE (symbol / tf / session) the renderer setData()s the complete
//       new series and, synchronously in the same call (so the same animation frame),
//       sets ONE logical range: pinNewestRange(newestIndex, W, plotWidthPx, reserve),
//       W = the outgoing view's visible width (to - from), or `defaultVisibleBars` on a
//       first paint. W and the plot width are preserved ⇒ the newest bar's x and the bar
//       spacing are INVARIANT across tf / symbol switches.
//   K2  Deep history is a LEFT PREPEND only: the range shifts by exactly how far the
//       newest bar's logical index moved, so every on-screen bar (and the right edge)
//       stays put.
//   K3  Same key, new base (append / seal / correction): the renderer never sets a range;
//       LWC keeps rightOffset measured from the last bar, which is the live-chart rule.
//   K4  A key change whose snapshot has no bars paints NOTHING (holds the outgoing frame;
//       the host shows its skeleton) — there is never a blank frame between two series.
// The right-margin policy is owned by components/chart/rightMargin.js (one owner).

import { pinNewestRange } from '../../components/chart/rightMargin'

export { rightMarginBars, lastCandlePos, pinNewestRange } from '../../components/chart/rightMargin'

const finite = (x) => typeof x === 'number' && Number.isFinite(x)

/** Visible width W (= to - from) of a logical range, or null. */
export function visibleWidthOf(range) {
  if (!range || !finite(range.from) || !finite(range.to)) return null
  const w = range.to - range.from
  return w > 0 ? w : null
}

/** Logical index of chart time `time` on `timeScale` (null when the scale lacks it). */
export function indexOfTime(timeScale, time) {
  if (time == null) return null
  try {
    const i = timeScale?.timeToIndex?.(time, false)
    return finite(i) ? i : null
  } catch { return null }
}

/** K1 — the one logical range after a key-change setData. `newestIndex` is the newest
 *  candle's logical index read from the time scale (indexOfTime). `reserve` = seeded
 *  future slots right of it (D/W/M developing period; 0 for a BarStore snapshot, whose
 *  developing bar is a real point). */
export function frameAfterKeyChange({ newestIndex, prevRange = null, defaultVisibleBars = null, plotWidthPx = null, reserve = 0 }) {
  const W = visibleWidthOf(prevRange) ?? (finite(defaultVisibleBars) && defaultVisibleBars > 0 ? defaultVisibleBars : Math.max(1, newestIndex + 1))
  return pinNewestRange(newestIndex, W, plotWidthPx, reserve)
}

/** K2 — the range after the newest bar's logical index moved by `shift` (a prepend). */
export function frameAfterPrepend(prevRange, shift) {
  if (!prevRange || !(shift > 0)) return prevRange
  return { from: prevRange.from + shift, to: prevRange.to + shift }
}

/** Pixel x (bar centre) of logical index `i` for a range on a plot `widthPx` wide —
 *  LWC's geometry (newest-relative), used by the invariant tests. */
export function xOfLogical(range, i, widthPx) {
  const spacing = widthPx / (range.to - range.from + 1)
  return widthPx - (range.to - i + 0.5) * spacing
}
