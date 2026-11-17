// ── CHART VIEW OPTIONS — the seven Chart Settings rows that were "Soon" (owner 11-15) ──
//
// Each is a plain chart setting the chart library (lightweight-charts) already draws. This module is the ONE
// reader for each: Chart Settings shows the value it returns, StockChart applies the option it returns, so the
// dialog and the chart can never disagree about what an absent key means.
//
// ⛔ AN ABSENT KEY IS TODAY'S LOOK, AND NOTHING HERE IS DECLARED IN CHART_DEFAULTS. Every blob that never touched
// one of these rows merges byte-identically to before (the pinned merged-blob digests), and each reader below turns
// "absent" into exactly what the chart drew before these rows existed:
//   candles.showBody / showBorders / showWick   absent = true   (every part draws)
//   candles.priceLine                           absent = true   (the last-price line, where the host shows it)
//   candles.priceLineStyle                      absent = 'dashed' (the library's default line style)
//   grid.lines                                  absent = 'both' (with `grid.visible` still the on/off master)
//   scaleTime.rightMargin                       absent = auto   (the host's own right padding — /charts: 6 bars)
//   scaleTime.priceDecimals                     absent = auto   (the library's 2 decimals, or the host's format)
//   scaleTime.timeFormat                        absent = '12'   (12-hour times on the axis and crosshair)
//   scaleTime.timeZone                          absent = 'exchange' (New York times on the axis and crosshair)
// The "Price label on the scale" row writes the existing `showPriceLabels` key — it already IS the price series'
// last-value label — so it needs no key here.

export const LINE_STYLE_NUM = { solid: 0, dotted: 1, dashed: 2 }   // lightweight-charts LineStyle
export const PRICE_LINE_STYLES = [['solid', 'Solid'], ['dashed', 'Dashed'], ['dotted', 'Dotted']]
export const GRID_LINES = [['off', 'Off'], ['horizontal', 'Horizontal'], ['vertical', 'Vertical'], ['both', 'Both']]
export const TIME_FORMATS = [['12', '12-hour'], ['24', '24-hour']]
export const PRICE_DECIMALS = [['auto', 'Auto'], [0, '0'], [1, '1'], [2, '2'], [3, '3'], [4, '4']]
// Chart Settings → Canvas → Scale & time → Time zone (owner 11-16, was Soon). [id, label, IANA zone]. DISPLAY ONLY:
// the intraday time-axis tick labels and the crosshair time label are re-read in this zone (chartTimeZone.js); the
// bars, session breaks, pre-market and every other ET rule stay New York. 'exchange' (absent) = today's labels;
// 'local' = the browser's own zone (resolved when drawn, so it follows the machine).
export const TIME_ZONES = [
  ['exchange', 'Exchange (New York)', 'America/New_York'],
  ['local', 'Local (browser)', null],
  ['utc', 'UTC', 'UTC'],
  ['chicago', 'Chicago', 'America/Chicago'],
  ['los_angeles', 'Los Angeles', 'America/Los_Angeles'],
  ['london', 'London', 'Europe/London'],
  ['frankfurt', 'Frankfurt', 'Europe/Berlin'],
  ['tokyo', 'Tokyo', 'Asia/Tokyo'],
  ['hong_kong', 'Hong Kong', 'Asia/Hong_Kong'],
  ['sydney', 'Sydney', 'Australia/Sydney'],
]
const _TZ_IDS = new Set(TIME_ZONES.map((z) => z[0]))
export const RIGHT_MARGIN_MIN = 0
export const RIGHT_MARGIN_MAX = 30

const intIn = (v, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : null)

/** Which candle parts draw (candles / hollow). */
export function candlePartsOf(cs) {
  const c = cs?.candles || {}
  return { body: c.showBody !== false, borders: c.showBorders !== false, wick: c.showWick !== false }
}

/** The last-price line: drawn or not, and its style as the member names it.
 *  `hostShows` = what the surface does when the member never chose (/charts panes hide it:
 *  PANE_LOOK.hidePriceLine), so an untouched chart keeps today's look and a member's explicit
 *  choice wins on every surface (owner test 11-16: the switch did nothing on /charts). */
export function priceLineOf(cs, hostShows = true) {
  const c = cs?.candles || {}
  const style = Object.prototype.hasOwnProperty.call(LINE_STYLE_NUM, c.priceLineStyle) ? c.priceLineStyle : 'dashed'
  return { visible: typeof c.priceLine === 'boolean' ? c.priceLine : hostShows, style }
}

/** The grid as the one "Lines" control shows it: `grid.visible: false` is Off whatever `grid.lines` holds. */
export function gridLinesOf(cs) {
  const g = cs?.grid || {}
  if (g.visible === false) return 'off'
  return g.lines === 'horizontal' || g.lines === 'vertical' ? g.lines : 'both'
}

/** The grid patch the "Lines" control writes — `visible` stays the master, so old readers keep working. */
export function gridPatchFor(grid, value) {
  const g = { ...(grid || {}) }
  if (value === 'off') return { ...g, visible: false }
  const next = { ...g, visible: true }
  if (value === 'both') delete next.lines
  else next.lines = value
  return next
}

/** lightweight-charts `grid` options: the member's colour on the lines that show, transparent on the rest. */
export function gridOptionsFor(cs, color) {
  const which = gridLinesOf(cs)
  return {
    vertLines: { color: (which === 'both' || which === 'vertical') ? color : 'transparent' },
    horzLines: { color: (which === 'both' || which === 'horizontal') ? color : 'transparent' },
  }
}

/** The member's right margin in bars, or null = auto (the host's own padding). */
export function rightMarginOf(cs) { return intIn(cs?.scaleTime?.rightMargin, RIGHT_MARGIN_MIN, RIGHT_MARGIN_MAX) }

/** The member's price decimals (0–4), or null = auto. */
export function priceDecimalsOf(cs) { return intIn(cs?.scaleTime?.priceDecimals, 0, 4) }

/** A lightweight-charts priceFormat for N decimals. */
export function priceFormatForDecimals(n) {
  return { type: 'price', precision: n, minMove: n === 0 ? 1 : Number((10 ** -n).toFixed(n)) }
}
/** lightweight-charts' own default priceFormat — what "Auto" puts back. */
export const AUTO_PRICE_FORMAT = Object.freeze({ type: 'price', precision: 2, minMove: 0.01 })

/** '12' | '24'. */
export function timeFormatOf(cs) { return cs?.scaleTime?.timeFormat === '24' ? '24' : '12' }

/** The time-zone id (a TIME_ZONES id); anything unknown or absent is 'exchange'. */
export function timeZoneOf(cs) {
  const z = cs?.scaleTime?.timeZone
  return typeof z === 'string' && _TZ_IDS.has(z) ? z : 'exchange'
}

/**
 * The stored `scaleTime` block, sanitised: only valid, non-default values survive, and an empty block is null
 * (so `mergeChartSettings` emits no key at all and an untouched blob merges byte-identically).
 */
export function sanitizeScaleTime(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const out = {}
  const rm = intIn(raw.rightMargin, RIGHT_MARGIN_MIN, RIGHT_MARGIN_MAX)
  if (rm != null) out.rightMargin = rm
  const pd = intIn(raw.priceDecimals, 0, 4)
  if (pd != null) out.priceDecimals = pd
  if (raw.timeFormat === '24') out.timeFormat = '24'
  if (typeof raw.timeZone === 'string' && raw.timeZone !== 'exchange' && _TZ_IDS.has(raw.timeZone)) out.timeZone = raw.timeZone
  return Object.keys(out).length ? out : null
}

/** The `scaleTime` patch for one field (null / 'auto' / '12' / 'exchange' removes it); returns the whole settings patch. */
export function scaleTimePatch(settings, field, value) {
  const cur = { ...((settings?.scaleTime && typeof settings.scaleTime === 'object') ? settings.scaleTime : {}) }
  if (value == null || value === 'auto' || (field === 'timeFormat' && value !== '24')
    || (field === 'timeZone' && (value === 'exchange' || !_TZ_IDS.has(value)))) delete cur[field]
  else cur[field] = value
  return { scaleTime: sanitizeScaleTime(cur) || {} }
}

// ── Session breaks + Pre-market high & low (owner 11-15, the next two Soon rows) ──
// Top-level booleans, ABSENT = OFF (today's look). mergeChartSettings keeps each only while it is `true`, so an
// untouched blob merges byte-identically. The lines themselves are computed in sessionMarks.js (intraday only).
/** Chart Settings → Canvas → Grid → Session breaks. */
export function sessionBreaksOf(cs) { return cs?.sessionBreaks === true }
/** Chart Settings → Markers → Previous-day levels → Pre-market high & low. */
export function preMarketLevelsOf(cs) { return cs?.preMarketLevels === true }
// ── Next earnings date (owner 11-16, the next Soon row) ── top-level boolean, ABSENT = OFF, kept by mergeChartSettings
// only while `true`. The chip itself is placed and drawn by nextEarningsMark.js (every timeframe).
/** Chart Settings → Markers → Events → Next earnings date. */
export function nextEarningsMarkerOf(cs) { return cs?.nextEarningsMarker === true }
// ── Price alerts (owner 11-16, was Soon) ── top-level boolean, ABSENT = OFF (the chart drew no alert lines before this
// row), kept by mergeChartSettings only while `true`. The lines are the member's ACTIVE price alerts on the chart's
// symbol, read from the existing alerts list and drawn as series price lines (priceAlertLines.js). Read-only.
/** Chart Settings → Markers → Your activity → Price alerts. */
export function priceAlertLinesOf(cs) { return cs?.priceAlertLines === true }
// ── My trades (owner 11-16, was Soon, the last Markers Soon row) ── top-level boolean, ABSENT = OFF (a /charts chart drew
// none of the member's trades before this row), kept by mergeChartSettings only while `true`. The markers are the
// member's own Journal fills on the chart's symbol, drawn on the bars they happened in (myTradeMarkers.js). Read-only.
/** Chart Settings → Markers → Your activity → My trades. */
export function myTradeMarkersOf(cs) { return cs?.myTradeMarkers === true }
// ── Shade pre / post-market (owner 11-16, was Soon) ── NOT a new key: the row is the existing per-chart
// `extendedHoursShading` (the toolbar's "Extended hours" / EXT-RTH toggle, the chart menu, UCT Agent's
// chart.setSession), read through the one rule every surface uses (resolveShowExtended: absent = ON). ON shows the
// pre/post-market bars with their shading on intraday charts; OFF is the regular session only.
/** Chart Settings → Canvas → Background → Extended hours. */
export function extendedHoursOf(cs) { return cs?.extendedHoursShading ?? true }
