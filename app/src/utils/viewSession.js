// The session of the chart view the member is looking at — the one place outside
// StockChart that knows whether the extended-hours (clock-grid) 60m series is the one
// on screen. StockChart publishes it (`setPrefetchShowExtended`); cache peeks outside
// the chart (symbol handoff, warm checks, the warmers) read the key through here.
import { seriesCacheTf } from '../components/chart/barTime'

let _ext = false
export function setViewShowExtended(on) { _ext = !!on }
export function viewShowExtended() { return _ext }

/** ⭐ THE rule for whether a chart shows extended hours — the ONE derivation (StockChart's
 *  `showExtended`, and every surface that must name the same view: ChartWidget's handoff key,
 *  ChartPane / GridChartCell's EXT toggle). `forceExtendedHours` (when not null / undefined)
 *  wins; else the `extendedHoursShading` setting, default ON. */
export function resolveShowExtended(cs, forceExtendedHours) {
  if (forceExtendedHours !== null && forceExtendedHours !== undefined) return !!forceExtendedHours
  return cs?.extendedHoursShading ?? true
}
/** The mem/IDB key a chart in the current view reads for `tf` ('60e' = 60m, EXT on). */
export function viewCacheTf(tf) { return seriesCacheTf(tf, _ext) }
