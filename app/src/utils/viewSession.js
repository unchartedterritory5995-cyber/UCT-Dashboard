// The session of the chart view the member is looking at — the one place outside
// StockChart that knows whether the extended-hours (clock-grid) 60m series is the one
// on screen. StockChart publishes it (`setPrefetchShowExtended`); cache peeks outside
// the chart (symbol handoff, warm checks, the warmers) read the key through here.
import { seriesCacheTf } from '../components/chart/barTime'

let _ext = false
export function setViewShowExtended(on) { _ext = !!on }
export function viewShowExtended() { return _ext }
/** The mem/IDB key a chart in the current view reads for `tf` ('60e' = 60m, EXT on). */
export function viewCacheTf(tf) { return seriesCacheTf(tf, _ext) }
