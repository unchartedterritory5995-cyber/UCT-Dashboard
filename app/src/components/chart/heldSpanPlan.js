// ⭐⭐ (2026-11-22) THE DEPTH ANOTHER SYMBOL IS HELD AT: ASKED ONCE, AT THE DEPTH THIS TIMEFRAME'S CHART IS ABOUT TO HOLD.
//
// ⚰️ Measured on production (the 1D -> 5m switch trace with Fred RS, RDDT): ONE switch sent 20 `/api/bars` requests.
// SPX 5m at 2,000, 600 and 5,000 rows at once, 10,000 at 1.1 s, 40,000 at 1.9 s, and the daily rows the run reads
// with them (RDDT D, SPX D, the RS seed) at 36 / 18 / 75 / 139 / 523 sessions. The held span followed the chart's LOADED
// row count up the ladder (`useSecondarySources.heldSpanFor`): first the previous timeframe's count (1D's 12,500 → a
// 20,000-row 5m page), then the first paint's 600, then the deep backfill's thousands. Every new depth is a new fetch
// and a new run, and while the chart holds more rows than the page asked, the run waits for "a deeper page"
// (`requestSupply.pageEdgeOf`): the Fred RS legend read BLANK for 0.6-1.1 s on every first intraday visit
// (the every-timeframe run, 2026-11-22: 5m 1,090 ms blank, 15m 987, 30m 745, 1h 618, 1m 561).
//
// So the held span starts at the depth the chart is about to hold: its full target (`barsBackfill.fullBarsFor`, what the
// deep backfill fills to), and only the CURRENT timeframe's own rows can raise it (a pan beyond the target). One page, one
// run, no wait. ⛔ Rows still showing the PREVIOUS timeframe (the frame before the new bars land) never count: a 5m
// chart's 30,000 rows are not a daily chart's depth.
import { fullBarsFor } from '../../utils/barsBackfill'
import { parseTf } from './timeframes'
import { heldSpanFor } from './engine/useSecondarySources'

/** Whether a timeframe code's bars are intraday (unix-second times): a native intraday code or a custom one of minutes/hours. */
export function intradayLikeTf(tf) {
  const p = parseTf(tf == null ? 'D' : String(tf))
  return p != null && p.minutes != null && Number.isFinite(p.minutes)
}

/** The rows the held span starts from on `tf`: the chart's full target there. */
export function heldFloorFor(tf) {
  return fullBarsFor(tf == null ? 'D' : String(tf))
}

/** The loaded rows that may raise the span on `tf`: the shown rows only when they are `tf`'s kind (unix seconds on an
 *  intraday code, ISO dates on D / W / M); otherwise 0 (the previous timeframe's rows, still on screen). */
export function heldRowsFor(tf, rows, newestT) {
  if (!(rows > 0)) return 0
  return (typeof newestT === 'number') === intradayLikeTf(tf) ? rows : 0
}

/** The held span on `tf`: the full target, raised only by `tf`'s own loaded rows (`loadedTf` = the timeframe `loaded`
 *  was counted on), and never below the chart's requested `barCount`. */
export function heldSpanOn(tf, loaded, loadedTf, barCount) {
  const own = loadedTf === tf ? loaded : 0
  return heldSpanFor(Math.max(own || 0, heldFloorFor(tf)), barCount)
}
