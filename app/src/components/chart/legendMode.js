// app/src/components/chart/legendMode.js — WHO DECIDES WHETHER THE OHLCV LEGEND SHOWS
//
// ⭐ ONE AUTHORITY. `cs.header.legendMode` is the only key anything WRITES; every
// surface that needs the answer calls `legendModeOf(cs)` rather than reading a
// field. StockChart, ChartPane and the settings modal all go through here, so
// they cannot disagree about whether a chart's legend is on.
//
// ⚠️ `header.showLegend` (boolean) shipped first and sits in every stored blob in
// production. It is a READ-ONLY FALLBACK now — consulted only when `legendMode`
// is absent, never written. Keeping both writable and "syncing" them is the
// second-authority-over-one-value defect that has cost this repo repeatedly: two
// keys, one fact, and whichever a surface happened to read decided the answer.
//
// ⛔ THE HOST-LEVEL `hideLegend` PROP IS NOT THIS. A surface that renders a chart
// too small for chrome (IntradayDayPopover, ChartsGallery, Model Book, the video
// dock) passes `hideLegend` to force the legend off regardless of the user's
// setting. That is a host decision about its own canvas; this is the user's
// preference. Both must hold — see StockChart's render gate.

/** The three states, in the order the toolbar button cycles them. */
export const LEGEND_MODES = ['always', 'click', 'off']

const _VALID = new Set(LEGEND_MODES)

/**
 * The mode this chart's settings ask for.
 *
 * - `always` — legend on, following the crosshair on hover (the long-standing look)
 * - `click`  — chart stays clean; clicking a candle pins the legend to that bar
 * - `off`    — never drawn
 *
 * An unrecognised stored value falls through to the legacy answer rather than
 * blanking a chart: a blob written by a future version (or corrupted) should
 * degrade to what the user last had, not to nothing.
 */
export function legendModeOf(cs) {
  const header = (cs && typeof cs === 'object' && cs.header && typeof cs.header === 'object')
    ? cs.header
    : null
  const mode = header?.legendMode
  if (_VALID.has(mode)) return mode
  // Legacy fallback. `showLegend === false` is the ONLY off signal — an absent
  // key means a blob written before either key existed, which was always-on.
  return header?.showLegend === false ? 'off' : 'always'
}

/** The next state in the cycle. An unknown input restarts at the head. */
export function nextLegendMode(mode) {
  const i = LEGEND_MODES.indexOf(mode)
  return LEGEND_MODES[(i + 1) % LEGEND_MODES.length]
}
