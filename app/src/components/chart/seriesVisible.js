// app/src/components/chart/seriesVisible.js
//
// ─── ⭐⭐ SHOW OR HIDE ONE SERIES, AND LEAVE ONE ALREADY SO ALONE (switch smoothness, 2026-11-20) ──────────────
//
// StockChart's "Group only" effect sets `visible` on the candles, the volume, the averages and every series the
// indicator binder holds, and it re-runs on every bars update. MEASURED (patrick-54's trace, RDDT 1D -> 5m with Fred
// RS): 10-19 ms per run, because each `applyOptions` makes lightweight-charts recompute the chart, one call per
// series, while every one of them was already showing. A series whose `visible` already IS the value asked for is
// left alone: re-applying it changes nothing it draws. Anything else (another value, a series that cannot say what it
// shows) is set exactly as before. Railed: `seriesVisible.test.js`.

/** Make `series` show (`true`) or hide (`false`); a no-op when it already does. Never throws. */
export function setSeriesVisible(series, visible) {
  try {
    if (!series || typeof series.applyOptions !== 'function') return
    const now = typeof series.options === 'function' ? series.options() : null
    if (now && now.visible === visible) return
    series.applyOptions({ visible })
  } catch { /* disposed */ }
}
