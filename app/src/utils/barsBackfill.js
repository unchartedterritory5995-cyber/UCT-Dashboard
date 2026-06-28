// Viewport-first payload (Phase 2): fetch a shallow window first, backfill deep
// history only when the user pans into it. Shared by StockChart (fetch depth +
// backfill trigger) and prefetchBars (warm the same shallow window).

// Shallow first-paint depth. Must exceed the 200-bar default zoom PLUS enough
// left-side lookback that on-screen moving averages (<=~380 periods, i.e.
// typical 50/100/200 MAs) are fully correct in view. Raise if very long
// in-view MAs become common.
export const FIRST_PAINT_BARS = 600

// The deep-history target the backfill jumps to once the user pans toward the
// oldest loaded bar. Sized to reach the FULL available history per timeframe so
// scrolling left walks all the way back to the first traded bar:
//   • D  → ~79yr of sessions (covers any US equity back to its IPO; the backend
//          pulls the yfinance pre-2003 tail Massive/Polygon lacks)
//   • W/M → decades
//   • intraday → multi-year (Massive retains intraday back to ~2010+); the
//     backend per-TF lookback ceiling is the real limiter, this just has to
//     exceed it. Lower TFs get fewer calendar years (more bars/day) by design —
//     nobody scrolls 1-min back a decade, and the payload must stay renderable.
export function fullBarsFor(tf) {
  switch (tf) {
    case 'D': return 20000   // ~79 years of daily sessions → IPO for any name
    case 'W': return 4000    // ~77 years of weeks
    case 'M': return 1200    // ~100 years of months
    case '1': return 20000   // ~1 month of 1-min
    case '5': return 26000   // ~6 months of 5-min
    case '15': return 26000  // ~1.7 years of 15-min
    case '30': return 28000  // ~3.6 years of 30-min
    case '60': return 22000  // ~5.7 years of hourly
    default: return 8000
  }
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
