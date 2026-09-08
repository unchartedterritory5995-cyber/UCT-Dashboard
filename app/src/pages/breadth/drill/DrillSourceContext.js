import { createContext, useContext } from 'react'

// The breadth cell a drill board is showing.
//
// ⛔ This rides a CONTEXT, never `opts`. The widgets' `opts` are persisted into
// `breadth_drill_board`, and a 134-symbol payload with per-row meta has no
// business in a layout blob — it would be rewritten on every appearance tweak
// and reloaded stale on the next open. `opts` carries the user's PREFERENCES;
// this carries the DATA, and it is rebuilt per open.
//
//   items   — the drill rows, verbatim from the breadth payload:
//             [{ t, n, c, vr, atr, a50, pct }]
//   label   — "UP 4%+"
//   date    — 'YYYY-MM-DD' of the snapshot, or null on a live drill
//   live    — true when this is the intraday row (prices stream)
//   asOf    — ISO stamp for the live clock
//   latestDate — the most recent recorded snapshot, so a drill can tell whether
//             its own date is history or simply the newest day
export const DrillSourceContext = createContext(null)

export function useDrillSource() {
  return useContext(DrillSourceContext)
}
