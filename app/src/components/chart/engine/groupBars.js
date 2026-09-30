// app/src/components/chart/engine/groupBars.js — leaf module (no imports).

/**
 * Column geometry for N histograms sharing one pane — `{width, offset}` per series,
 * as fractions of the bar slot.
 *
 * ⭐ SIDE BY SIDE, NEVER STACKED. N full-width histograms in one pane paint over one
 * another, and a stack would draw their SUM, which is a number nobody reported. Each
 * series instead takes an equal share of the slot, centred on its own offset, and
 * every column grows from the SAME zero line on the SAME scale — so all N values
 * stay independently readable at every bar.
 */
export const GROUP_BARS_SPAN = 0.84

/** The starting height of a grouped histogram product's ONE pane (a share of the
 *  stack; `paneLayout` honours it as the host's default, a member's drag outranks it).
 *  Above a lone data series' 0.15 because it holds three series under a four-line
 *  legend. */
export const GROUP_PANE_HEIGHT = 0.22

const r4 = (x) => Math.round(x * 1e4) / 1e4

export function sideBySideBars(n) {
  if (!Number.isInteger(n) || n < 2) return []
  const width = GROUP_BARS_SPAN / n
  return Array.from({ length: n }, (_, i) => ({ width: r4(width), offset: r4((i - (n - 1) / 2) * width) }))
}
