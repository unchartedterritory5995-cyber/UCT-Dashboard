// app/src/components/chart/patternShapes/learnedLabelNudge.js — display-only spacing for the learned
// levels' price labels. Two levels a fraction of an ATR apart (v3 draws a near support beside a named
// level, e.g. "prev wk H 20.37" over "old low / flip 20.44") put their labels on top of each other. This
// moves LABELS apart vertically; the lines stay exactly where the drawing put them. Pure; no React.

export const LABEL_MIN_GAP_PX = 11

/**
 * @param {Array<number|null>} ys  each label's y (the level's y), in render order; null = not drawn
 * @param {number} gap  minimum vertical distance between two labels
 * @returns {number[]} a y offset per label (0 for most), in the same order
 */
export function nudgeLabelOffsets(ys, gap = LABEL_MIN_GAP_PX) {
  const offs = ys.map(() => 0)
  const order = ys
    .map((y, i) => [y, i])
    .filter(([y]) => typeof y === 'number' && Number.isFinite(y))
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])
  let prev = null
  for (const [y, i] of order) {
    const placed = prev == null ? y : Math.max(y, prev + gap)
    offs[i] = placed - y
    prev = placed
  }
  return offs
}
