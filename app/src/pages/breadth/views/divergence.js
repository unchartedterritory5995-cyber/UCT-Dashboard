/**
 * Divergence math, kept framework-free so it can be tested without rendering.
 * A "divergence" here is a sustained gap between two z-scored series — one
 * session apart is noise, which is what `minGap` exists to refuse.
 */

// Minimum |z| gap before a session counts as divergent at all. One standard
// deviation apart is the conventional read; below it the two series are
// telling the same story with different units.
export const MIN_Z_GAP = 1.0

/**
 * Fewest sessions this math will run on at all. Below it a standard deviation
 * is noise, so BOTH consumers refuse: `DivergenceView` renders a window-depth
 * refusal, and `theRead.js` omits its divergence clause entirely.
 *
 * ⛔ IT LIVES HERE, NOT IN THE VIEW. It was `const MIN_SESSIONS = 20` inside
 * `DivergenceView.jsx`, which is fine while one caller reads it — and the
 * moment a second one needed the same boundary, a hand-typed copy would have
 * let The Read claim "price and breadth are in step" over a window the lens
 * itself refuses to score.
 */
export const MIN_SESSIONS = 20

export function zscore(values) {
  const nums = values.filter(v => v != null && !isNaN(Number(v))).map(Number)
  if (nums.length < 2) return values.map(() => null)
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length
  const variance = nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length
  const sd = Math.sqrt(variance)
  if (sd === 0) return values.map(v => (v == null ? null : 0))
  return values.map(v => (v == null || isNaN(Number(v)) ? null : (Number(v) - mean) / sd))
}

export function divergenceRuns(zPrice, zPart, minGap = 5) {
  const runs = []
  let start = null, dir = null
  const flush = (endExclusive) => {
    if (start != null && endExclusive - start >= minGap) {
      runs.push({ start, end: endExclusive - 1, dir })
    }
    start = null; dir = null
  }
  for (let i = 0; i < zPrice.length; i++) {
    const a = zPrice[i], b = zPart[i]
    const gap = (a == null || b == null) ? null : a - b
    const d = gap == null || Math.abs(gap) < MIN_Z_GAP
      ? null
      : (gap > 0 ? 'price-leads' : 'breadth-leads')
    if (d == null || d !== dir) { flush(i); }
    if (d != null && start == null) { start = i; dir = d }
  }
  flush(zPrice.length)
  return runs
}
