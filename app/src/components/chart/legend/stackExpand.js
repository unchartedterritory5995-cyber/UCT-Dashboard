/* Two rules about a study stack the member opened with `+N more`.
 *
 * Pure, and outside StockChart.jsx on purpose: that file should export only its component.
 */

/**
 * Has the member's `+N more` outlived the fold it opened?
 *
 * "Expanded" only means something while there is a fold to undo. When the pane grows until every
 * row fits, the `Less` button is no longer drawn, and an expand left standing had no way back: the
 * range bar stayed hidden and the responsive collapse stayed off for the life of the chart
 * (measured 2026-11-17: `+2 more` at a 640px window, then the window at 1000px: no `Less`, and no
 * 3M / 6M / YTD). So the expand is dropped then, and a pane that later shrinks folds again like a
 * fresh one.
 *
 * Only on a settled fold: the frame a new row budget is set, `canFold` still describes the old
 * one. And only on a `canFold` that is exactly `false`: before the legend has rendered once it is
 * `null`, which says nothing.
 */
export function stackExpandIsStale(expanded, canFold, foldSettled) {
  return !!expanded && canFold === false && !!foldSettled
}

/**
 * Is the study stack drawn open, past its fold? The member pressed `+N more` and there is still a
 * fold to close. This is what lifts the legend above the pane divider (`.legendStackOpen`).
 */
export function stackDrawnOpen(legendV2, expanded, canFold) {
  return !!legendV2 && !!expanded && !!canFold
}
