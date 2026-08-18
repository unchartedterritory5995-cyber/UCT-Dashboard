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
export const LEGEND_MODES = ['always', 'hold', 'off']

// ⚰️ `'click'` WAS `'hold'`'S NAME FOR ONE DAY (2026-08-16 → 08-17). It shipped as
// click-to-PIN — a click latched the legend to a bar until you dismissed it — and
// the owner's actual ask was press-and-hold to PEEK. A stored `'click'` therefore
// means exactly what `'hold'` means now, so it maps rather than being refused; and
// the token was RENAMED rather than left alone, because an identifier called
// `click` whose behaviour is "while held" is the stale-name defect this repo keeps
// paying for (see `youtube_client.upload_unlisted` in CLAUDE.md).
const _LEGACY_ALIAS = { click: 'hold' }

/**
 * What a chart does when its settings say nothing.
 *
 * ⭐⭐ THE DEFAULT LIVES HERE, AND `CHART_DEFAULTS` DELIBERATELY DOES NOT DECLARE
 * IT. A schema entry would be spread into every merged blob, and the merge output
 * is what every settings write persists — so the default would be written back as
 * though the user had chosen it, and no later default could ever outrank it. That
 * is precisely what happened on 2026-08-16 and is why the owner never received
 * the flip. `legendStamp.test.js` is the rail.
 *
 * ⚠️ CHANGING THIS CHANGES EVERY EXISTING USER whose blob carries no explicit
 * mode. That is the intent — but it only WORKS because the merge no longer
 * stamps the resolved answer into stored settings (see below). While it did, a
 * flip reached nobody who had ever saved a chart setting, which is how the
 * 2026-08-16 change to `hold` failed silently in production.
 *
 * ⭐ `'always'` — owner call 2026-08-17, from user feedback: TradingView shows its
 * legend on arrival and people expect the same here. `hold` and `off` remain one
 * click away for anyone who wants a clean chart.
 */
export const DEFAULT_LEGEND_MODE = 'always'

const _VALID = new Set(LEGEND_MODES)

/**
 * The mode the user EXPLICITLY chose, or `undefined` when they never did.
 *
 * ⭐ THE ONE VALIDITY RULE, AND THE ONE THING THE MERGE MAY PERSIST. Everything
 * else — the legacy fallback, the default — is DERIVED on every read and must
 * never be written back: `mergeChartSettings` output is what every settings write
 * persists, so a key the read invents becomes a stored choice the user never made
 * and no future default can outrank. See `legendStamp.test.js`.
 */
export function explicitLegendMode(cs) {
  const header = (cs && typeof cs === 'object' && cs.header && typeof cs.header === 'object')
    ? cs.header : null
  const raw = header?.legendMode
  const mapped = _LEGACY_ALIAS[raw] || raw
  return _VALID.has(mapped) ? mapped : undefined
}

/**
 * The mode this chart's settings ask for.
 *
 * - `always` — legend on, following the crosshair on hover (the long-standing look)
 * - `hold`   — chart stays clean; PRESS AND HOLD peeks at the bar under the
 *              cursor and releasing hides it again
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
  const mode = explicitLegendMode(cs)
  if (mode) return mode
  // ── LEGACY FALLBACK, AND ONLY ONE LEGACY VALUE CARRIES A DECISION ─────────
  //
  // `showLegend === false` is somebody deliberately turning the legend OFF, and
  // a change to what "unset" means must never quietly re-enable it.
  //
  // ⚠️ `showLegend === true` DOES NOT MEAN 'always'. It is the old checkbox's ON
  // state, and that checkbox had no third option — it could not express the
  // difference between "always" and "hold". Reading it as an explicit vote
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
