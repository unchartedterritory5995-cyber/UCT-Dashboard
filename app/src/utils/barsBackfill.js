// Viewport-first payload (Phase 2): fetch a shallow window first, backfill deep
// history only when the user pans into it. Shared by StockChart (fetch depth +
// backfill trigger) and prefetchBars (warm the same shallow window).

// Shallow first-paint depth. Must exceed the 200-bar default zoom PLUS enough
// left-side lookback that on-screen moving averages (<=~380 periods, i.e.
// typical 50/100/200 MAs) are fully correct in view. Raise if very long
// in-view MAs become common.
export const FIRST_PAINT_BARS = 600

// The deep-history target — the values StockChart used before viewport-first.
export function fullBarsFor(tf) {
  return (tf === 'D' || tf === 'W') ? 8000 : 5000
}

// Pure decision: should we bump from the shallow window to the full depth?
// True only when (a) there is still deeper history to load, (b) the visible
// left edge is within `edgeThreshold` bars of the oldest loaded bar (the user
// panned left), and (c) the view is zoomed IN — not showing essentially the
// whole loaded series. (c) rejects the transient full-range view on first load
// / zoom-settle, so a cold chart doesn't immediately re-fetch the full set.
export function shouldBackfill({
  fromIndex,
  toIndex,
  loadedCount,
  fullTarget,
  edgeThreshold = 50,
  maxViewFrac = 0.7,
}) {
  if (!(loadedCount > 0) || !(fullTarget > 0) || loadedCount >= fullTarget) return false
  if (!(fromIndex <= edgeThreshold)) return false
  const width = toIndex - fromIndex
  if (!(width > 0)) return false
  return width < loadedCount * maxViewFrac
}
