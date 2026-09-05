/**
 * RISK-016 (Phase One Track B, 2026-09-04). Both AI-touching doors —
 * `ConciergeBox` (`POST /api/user-definitions/propose`) and `ImageBox`
 * (`POST /api/indicator-vision/candidates`) — used to attach the chart's
 * ENTIRE cached bar buffer to the request, uncapped. For a long-listed symbol
 * (SPY: 8,000 daily bars back to 1994) that exceeds the server's
 * `MAX_PROPOSE_BARS` (5,000, `api/routers/user_definitions.py`) and produced a
 * raw 400 that bypassed both endpoints' own documented `{ok:false, gate,
 * reason}` refusal contract, surfacing to the member as a generic "could not
 * be reached" message that misrepresented the actual cause.
 *
 * ⛔ THE FIX IS AT THE ONE SHARED CHOKEPOINT, NOT AT EVERY `bars` SOURCE. Three
 * separate `<ChartToolbar>` mounts in `StockChart.jsx` each pass their own
 * `bars` state down through `ChartToolbar` -> `BuilderSheet` -> here — fixing
 * each origin separately would be three authorities over one cap, the exact
 * shape this codebase's own CLAUDE.md calls out repeatedly as the recurring
 * defect. Truncating once, at the last point before either door serializes
 * the array onto the wire, is the single place that can never be missed by a
 * future fourth mount site.
 *
 * ⭐ MOST RECENT BARS, NOT THE OLDEST. Bars arrive oldest-first (ascending by
 * time — confirmed against the real captured payload during Phase Zero: first
 * entry 1994-11-21, last 2026-09-04), and `ChartToolbar`'s own Phase D Task 13
 * comment states the concierge's compute stage is meant to run "on the window
 * the user is looking at" — recent context, not three decades of it. `slice`
 * from the end keeps the newest entries.
 *
 * ⚠️ WELL UNDER THE SERVER'S CAP, NOT RIGHT AT IT. 2,000 leaves a wide margin
 * (5,000 is the hard refusal) for whatever a future compute-stage change might
 * need, while still being far more history than any of today's supported
 * lookbacks (a 200-bar SMA, the longest common case) could plausibly use.
 */
export const PROPOSE_BARS_LIMIT = 2000

export function truncateBarsForPropose(bars) {
  if (!Array.isArray(bars) || bars.length <= PROPOSE_BARS_LIMIT) return bars || []
  return bars.slice(-PROPOSE_BARS_LIMIT)
}
