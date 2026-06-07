// Re-anchor a chart's visible LOGICAL range so the user's date-position is held
// fixed when the underlying bar COUNT changes.
//
// Lightweight-Charts preserves the visible logical range NUMERICALLY across
// setData(). Logical indices are measured from the FIRST bar, so when many older
// bars are prepended (or a small IDB-cached set is replaced by the larger network
// full-fetch), the same numeric range suddenly maps to a much older date — the
// chart appears to "jump back to ~2019". Re-anchoring to the same bars-from-right
// (distance of the right edge from the newest bar) + width keeps the view stable
// in date terms regardless of how the count changed.
//
// Used in two places in StockChart:
//   1. cross-ticker view-lock (carry the view to the next ticker on a sym switch)
//   2. same-ticker data-phase swap (IDB cache → network full-fetch / backfill)
//
// Returns { from, to } to apply, or null when the inputs are unusable (caller
// then leaves the view as-is / falls back to a default fit).
export function reanchorLogicalRange(oldBarCount, oldRange, newBarCount) {
  if (!oldRange || !(oldBarCount > 0) || !(newBarCount > 0)) return null
  const barsFromRight = oldBarCount - oldRange.to
  const width = oldRange.to - oldRange.from
  const to = newBarCount - barsFromRight
  const from = to - width
  if (width > 0 && Number.isFinite(from) && Number.isFinite(to) && to > 1 && from < newBarCount) {
    return { from, to }
  }
  return null
}
