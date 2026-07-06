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

// Progressive backfill depth: the next fetch depth to jump to when the user pans
// into deep history, instead of leaping straight to fullTarget in one shot.
//
// A full intraday scroll-back is fullBarsFor('1') = 20000 bars, and Massive
// paginates that ~1ms/bar → a single ~20s fetch before ANY deeper history
// appears (measured on prod). Stepping (e.g. 600 -> ~4800 -> full) lands a fast
// first chunk (~5s, usually several days of intraday — enough for the common
// pan) and only fetches the full depth if the user keeps panning past it. Each
// step reuses the same setFetchDepth path, so the view re-anchor holds steady.
//
// `step` is the growth multiplier; the `+4000` floor guarantees a meaningful
// jump from the 600-bar first-paint even on the first step. Small targets
// (W=4000, M=1200) reach full in one step, so slow-fetch intraday is the only
// place the progression is visible — which is exactly where the tail lives.
export function nextBackfillDepth(current, fullTarget, step = 8) {
  if (!(current > 0) || !(fullTarget > 0) || current >= fullTarget) return fullTarget
  const next = Math.max(current * step, current + 4000)
  return Math.min(next, fullTarget)
}
