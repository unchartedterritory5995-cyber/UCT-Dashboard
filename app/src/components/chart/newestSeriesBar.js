// The newest bar a chart series holds, for the read-only debug handle (window.__uctChartDebug[id]
// .newestBar) that the proofs read: the tick-latency proof on EVERY animation frame for every chart,
// the all-day soak every few minutes.
//
// ⛔ ONE BY-INDEX LOOKUP, NEVER `series.data()`. data() rebuilds the whole series on each call; read
// per frame it was a quarter of the page's measured main-thread work (2026-11-16 production profile:
// 4.4 s per 90 s with 4 charts), so the instrument loaded the thing it measured. `count` still needs
// the whole series and is computed only when read.
const NEAREST_LEFT = -1 // lightweight-charts MismatchDirection.NearestLeft

const isWhitespaceRow = (p) => !!p && p.value === undefined && p.open === undefined

/**
 * The LOGICAL index (time-scale axis) of the newest REAL (non-whitespace) row of `series`, found
 * with ONE by-index lookup (`dataByIndex` NearestLeft from the end) instead of `series.data()`, a
 * whole-series copy (2026-11-19: ~14 ms of each 50,000-bar hourly flip on the production CPU
 * profile). On lightweight-charts 5.2.0 that lookup never lands on a whitespace slot (the D/W/M load
 * reserve is not a row it searches; proven against the real library in
 * __tests__/chartLibraryPatch.behaviour.test.js). null when the series is empty, the time scale
 * cannot answer, or the row IS whitespace: the caller then reads the series' rows as before.
 */
export function newestRealLogicalIndex(chart, series) {
  const ts = chart?.timeScale?.()
  if (!ts?.timeToIndex || !series?.dataByIndex) return null
  const row = series.dataByIndex(Number.MAX_SAFE_INTEGER, NEAREST_LEFT)
  if (!row || isWhitespaceRow(row)) return null
  const li = ts.timeToIndex(row.time, false)
  return typeof li === 'number' && Number.isFinite(li) ? li : null
}

export function newestSeriesBar(series) {
  const last = series?.dataByIndex?.(Number.MAX_SAFE_INTEGER, NEAREST_LEFT)
  if (!last) return null
  return {
    time: last.time ?? null,
    close: Number.isFinite(last.close) ? last.close : (Number.isFinite(last.value) ? last.value : null),
    get count() { try { return series.data().length } catch { return null } },
  }
}
