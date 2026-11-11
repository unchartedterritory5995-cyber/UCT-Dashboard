// BarStore framing contract (P2, BARSTORE-SPEC "Renderer & framing"). NOT WIRED yet.
//
// ⭐ THE CONTRACT, in logical-index space (LWC: bar i sits at logical i; the visible range
// is {from, to} and bar spacing = plotWidth / (to - from + 1)):
//   K1  After a KEY CHANGE (symbol / tf / session) the renderer setData()s the complete
//       new series and, synchronously in the same call (so the same animation frame),
//       sets ONE logical range:  to = n - 1 + RIGHT_PAD_BARS,  from = to - W,
//       with W = the outgoing view's visible width (to - from), or `defaultVisibleBars`
//       on a first paint. Both W and the pad are preserved ⇒ the newest bar's x and the
//       bar spacing are INVARIANT across tf / symbol switches.
//   K2  Deep history is a LEFT PREPEND only: the range shifts by exactly the number of
//       bars added on the left, so every on-screen bar (and the right edge) stays put.
//   K3  Same key, new base (append / seal / correction): the renderer never sets a range;
//       LWC keeps rightOffset measured from the last bar, which is the live-chart rule.
//   K4  A key change whose snapshot has no bars paints NOTHING (holds the outgoing frame;
//       the host shows its skeleton) — there is never a blank frame between two series.
//
// ⭐ RIGHT-MARGIN POLICY — ONE CONSTANT. `RIGHT_PAD_BARS` is the empty slots between the
// newest bar and the price scale. It equals StockChart's `rightPadBars` prop default (3)
// and is the value the symbol-switch worker (W-R, charts/symbol-switch-pinned) must share.
// ⚠ Today's default zoom (StockChart computeDefaultLogicalRange) instead places the
// newest candle at a FRACTION of the plot (LAST_CANDLE_POS 0.95, ≥34px gap, ≤16%) —
// a pixel policy. Both are x-invariant across switches as long as W is preserved; they
// differ only in the first-ever frame. Reconciling the two into this one constant is a
// P3-S3 decision (see the PR body).

export const RIGHT_PAD_BARS = 3

const finite = (x) => typeof x === 'number' && Number.isFinite(x)

/** Visible width W (= to - from) of a logical range, or null. */
export function visibleWidthOf(range) {
  if (!range || !finite(range.from) || !finite(range.to)) return null
  const w = range.to - range.from
  return w > 0 ? w : null
}

/** K1 — the one logical range after a key-change setData of `n` bars. */
export function frameAfterKeyChange({ n, prevRange = null, defaultVisibleBars = null, rightPadBars = RIGHT_PAD_BARS }) {
  const W = visibleWidthOf(prevRange) ?? (finite(defaultVisibleBars) && defaultVisibleBars > 0 ? defaultVisibleBars : Math.max(1, n - 1 + rightPadBars))
  const to = n - 1 + rightPadBars
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
