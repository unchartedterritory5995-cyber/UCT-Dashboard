// The chart header's OPTIONAL reads, asked for ahead of the member.
//
// ⚰️ MEASURED ON PRODUCTION 2026-11-13 (a chart whose info row shows 5-day and 30-day change,
// theme, relative volume and IPO date, stepping down a list at 2 s a chart): each of these is
// its own small request, started only once the chart was on the symbol, and the pod answered
// each in 0.3 to 0.85 s at the median (3.9 s at worst). The field read "—" until then. The
// header's default stats had the same lag until `useHeaderSnapshot` (#1176).
//
// So, exactly as there: while a header SHOWS a field, the read behind it is registered with
// `lib/symbolResourceWarm.js` under the hook's own key and fetcher, and the rows the member is
// about to reach are asked for with them. Arriving finds the value on the first render.
//
// ⛔ A FIELD THAT IS NOT SHOWN REGISTERS NOTHING, so a member with the default header pays for
// none of this. The keys are the hooks' own (`hooks/*Key.js`): each hook calls the same
// function with `[sym]`, which is what a header passes it.
//
// It lives beside the chart, not in the hooks: the watchlist reads the same hooks for whole
// lists, on pages that load no chart, and must not carry the warmer.
import { useSymbolResource } from '../../../lib/symbolResourceWarm'
import { watchlistPerformanceKey, watchlistPerformanceFetcher } from '../../../hooks/watchlistPerformanceKey'
import { watchlistThemesKey, watchlistThemesFetcher } from '../../../hooks/watchlistThemesKey'
import { snapshotBatchKey, watchlistMetaFetcher } from '../../../hooks/watchlistMetaKey'
import { volumeCurveKey, volumeCurveFetcher } from '../../../hooks/volumeCurveKey'
import { delistedKey, delistedFetcher } from '../../../hooks/delistedKey'

// "What would this header ask for if it were on `sym`?" One stable function per read.
const perfKeyOf = (sym) => watchlistPerformanceKey([sym])
const themeKeyOf = (sym) => watchlistThemesKey([sym])
const metaKeyOf = (sym) => snapshotBatchKey([sym])
const curveKeyOf = (sym) => volumeCurveKey([sym])

/**
 * @param {{perf?: boolean, theme?: boolean, meta?: boolean, curve?: boolean, delisted?: boolean}} shows
 *   which reads this header is making right now (the same gates it passes its hooks)
 */
export default function useHeaderExtrasWarm(shows) {
  const s = shows || {}
  useSymbolResource(s.perf ? perfKeyOf : null, watchlistPerformanceFetcher)
  useSymbolResource(s.theme ? themeKeyOf : null, watchlistThemesFetcher)
  useSymbolResource(s.meta ? metaKeyOf : null, watchlistMetaFetcher)
  useSymbolResource(s.curve ? curveKeyOf : null, volumeCurveFetcher)
  useSymbolResource(s.delisted ? delistedKey : null, delistedFetcher)
}
