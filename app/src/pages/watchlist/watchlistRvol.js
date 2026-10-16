// The Watchlist's RVOL column: "volume vs usual by this time of day", the SAME number the
// screener's live `rvol_live`, the chart header and the terminal headline show.
//
//     rvol = today's volume / (30-session average × the share of a normal day this stock —
//            or, without its own curve, the market — has usually traded by this minute)
//
// ⚰️ It was today's volume over the 20-session FULL-day average, which reads ~0.8x at
// 10:00 for a name trading three times its usual pace, so the column and the chart header
// disagreed all morning.
//
// Blank (null) before 09:45 ET, outside the session, or without a stored curve — the same
// as the header. A caller that ALREADY knows the ratio supplies `meta.rvol` directly (the
// breadth drill's payload carries `vr` but no raw volume); that stays as-is.
//
// The value is a PERCENT (2.0x = 200), the column's sort-compatible convention; the cell
// divides by 100.
import { rvolForSymbol } from '../../lib/volumeCurve'

export function watchlistRvol(sym, meta, quote, volCurve, now = new Date()) {
  if (Number.isFinite(meta?.rvol)) return meta.rvol
  const r = rvolForSymbol(volCurve, sym, quote?.volume, meta?.avg_vol_30d, now)
  return r == null ? null : r * 100
}
