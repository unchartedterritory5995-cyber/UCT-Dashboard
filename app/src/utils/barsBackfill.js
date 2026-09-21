// Viewport-first payload (Phase 2): fetch a shallow window first, backfill deep
// history only when the user pans into it. Shared by StockChart (fetch depth +
// backfill trigger) and prefetchBars (warm the same shallow window).

// Shallow first-paint depth. Must exceed the 200-bar default zoom PLUS enough
// left-side lookback that on-screen moving averages (<=~380 periods, i.e.
// typical 50/100/200 MAs) are fully correct in view. Raise if very long
// in-view MAs become common.
//
// ⚠️ THIS IS A FETCHED COUNT, AND ON INTRADAY THE USER DOES NOT SEE IT. Prefer
// `firstPaintBarsFor(tf, showExtended)` below for intraday; this stays the D/W/M
// and default value, and the floor every intraday budget is measured against.
export const FIRST_PAINT_BARS = 600

// ── Intraday first paint is budgeted in VISIBLE bars, not fetched ones ──────
// ⛔⛔ THE RTH FILTER DISCARDS ~60% OF AN INTRADAY PAYLOAD, AND NOTHING USED TO
// ACCOUNT FOR IT. `StockChart.sessionBars` keeps only 09:30-16:00 ET when the
// EXT toggle is off, so the flat 600 above arrived on screen as ~240 bars against
// a 200-bar default zoom — about 40 bars of scroll-back before blank space.
// Measured on AAPL, production 2026-09-20: 600 fetched → 390 visible on 1m and
// 234 / 242 / 247 / 246 on 5m / 15m / 30m / 60m. So the number a trader
// experiences was never the number this module named.
//
// ⭐ THE RATIO IS A PROPERTY OF THE CLOCK, NOT A TUNING KNOB. A payload spans the
// 04:00-20:00 extended day (960 min) and RTH is 390 of it, so RTH-only mode keeps
// 390/960 = 0.406 of the bars. The measured 0.39-0.41 above is that fraction, which
// is why it is DERIVED here rather than typed as a fudge factor.
const RTH_MINUTES = 390          // 09:30-16:00 ET
const EXTENDED_MINUTES = 960     // 04:00-20:00 ET — the span a payload actually covers
export const RTH_VISIBLE_FRACTION = RTH_MINUTES / EXTENDED_MINUTES

// Visible-bar target per intraday timeframe: what must be ON SCREEN at first paint,
// before any deepening. Sized so the 200-bar default zoom sits inside a window with
// real scroll-back, and so the coarse timeframes carry the multi-day context they
// are chosen for. Trading-day coverage (RTH buckets per session in brackets):
//   1m  [390] → 1 session      5m  [78] → 6 sessions     15m [26] → 18 sessions
//   30m [13] → 35 sessions     60m [7]  → 66 sessions
const VISIBLE_TARGET = { '1': 390, '5': 468, '15': 468, '30': 455, '60': 462 }

// ⛔ THE CAP IS LOAD-BEARING, NOT A ROUND NUMBER. `bars_fetch._DEEP_REQUEST_THRESHOLD`
// is 1200: at or above it the server classifies the request as a deep-history
// backfill and takes a DIFFERENT, heavier branch. A first paint must never cross
// that line, so every budget below is clamped under it. Raising a target past the
// clamp silently changes which server path a chart open takes.
export const FIRST_PAINT_MAX = 1199

/**
 * Fetched-bar count for the first paint of `tf`.
 *
 * With extended hours ON nothing is filtered, so the visible target IS the fetch.
 * With it OFF the client drops ~59% of the payload, so the fetch is grossed up by
 * the session fraction. D/W/M and any non-native code keep FIRST_PAINT_BARS.
 */
export function firstPaintBarsFor(tf, showExtended = false) {
  const target = VISIBLE_TARGET[String(tf)]
  if (!target) return FIRST_PAINT_BARS
  const fetched = showExtended ? target : Math.ceil(target / RTH_VISIBLE_FRACTION)
  return Math.min(FIRST_PAINT_MAX, Math.max(FIRST_PAINT_BARS, fetched))
}

/** Bars expected ON SCREEN for `tf` at first paint — the number the budgets mean. */
export function firstPaintVisibleFor(tf, showExtended = false) {
  const fetched = firstPaintBarsFor(tf, showExtended)
  return showExtended ? fetched : Math.round(fetched * RTH_VISIBLE_FRACTION)
}

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
    case 'D': return 12500   // ~50 years of daily sessions — full life of any tradeable
                             // name (even 1970s-80s IPOs) without the ~79yr request
                             // that made the backend chase empty pre-1976 history.
                             // MUST match deep_history_warm _DEEP_TARGET['D'].
    case 'W': return 4000    // ~77 years of weeks
    case 'M': return 1200    // ~100 years of months
    case '1': return 20000   // ~1 month of 1-min (provider-limited; deep 1m is rare)
    case '5': return 30000   // ~10 months of 5-min
    case '15': return 30000  // ~2 years of 15-min
    case '30': return 32000  // ~4.2 years of 30-min
    case '60': return 32000  // ~8 years of hourly
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
