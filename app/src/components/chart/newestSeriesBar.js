// The newest bar a chart series holds, for the read-only debug handle (window.__uctChartDebug[id]
// .newestBar) that the proofs read: the tick-latency proof on EVERY animation frame for every chart,
// the all-day soak every few minutes.
//
// ⛔ ONE BY-INDEX LOOKUP, NEVER `series.data()`. data() rebuilds the whole series on each call; read
// per frame it was a quarter of the page's measured main-thread work (2026-11-16 production profile:
// 4.4 s per 90 s with 4 charts), so the instrument loaded the thing it measured. `count` still needs
// the whole series and is computed only when read.
const NEAREST_LEFT = -1 // lightweight-charts MismatchDirection.NearestLeft

export function newestSeriesBar(series) {
  const last = series?.dataByIndex?.(Number.MAX_SAFE_INTEGER, NEAREST_LEFT)
  if (!last) return null
  return {
    time: last.time ?? null,
    close: Number.isFinite(last.close) ? last.close : (Number.isFinite(last.value) ? last.value : null),
    get count() { try { return series.data().length } catch { return null } },
  }
}
