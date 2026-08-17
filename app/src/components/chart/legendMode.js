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

/**
 * What a chart does when its settings say nothing.
 *
 * ⭐⭐ THE DEFAULT LIVES HERE, NOT IN `CHART_DEFAULTS`. `mergeChartSettings`
 * resolves `header.legendMode` by calling `legendModeOf` on the STORED blob, so
 * the schema's declaration is downstream of this constant — changing the schema
 * alone moves nothing, which is measurable and is why the test asserts the two
 * agree rather than asserting a literal in each place.
 *
 * ⚠️ CHANGING THIS CHANGES EVERY EXISTING USER whose blob carries no explicit
 * mode — which, the day it flipped, was all of them. Owner call, 2026-08-16:
 * a clean chart that answers when asked is the better out-of-box behaviour.
 */
export const DEFAULT_LEGEND_MODE = 'click'

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
  // ── LEGACY FALLBACK, AND ONLY ONE LEGACY VALUE CARRIES A DECISION ─────────
  //
  // `showLegend === false` is somebody deliberately turning the legend OFF, and
  // a change to what "unset" means must never quietly re-enable it.
  //
  // ⚠️ `showLegend === true` DOES NOT MEAN 'always'. It is the old checkbox's ON
  // state, and that checkbox had no third option — it could not express the
  // difference between "always" and "on click". Reading it as an explicit vote
  // for 'always' would pin every pre-existing user to the old behaviour forever
  // and make the default flip a no-op for exactly the people it is for. So
  // everything except an explicit `false` takes the current default.
  return header?.showLegend === false ? 'off' : DEFAULT_LEGEND_MODE
}

/** The next state in the cycle. An unknown input restarts at the head. */
export function nextLegendMode(mode) {
  const i = LEGEND_MODES.indexOf(mode)
  return LEGEND_MODES[(i + 1) % LEGEND_MODES.length]
}
