// ── CHART APPEARANCE — what "Apply to all charts" copies, and what it never touches ──
//
// Chart Settings → sidebar foot → "Apply to all charts" (owner 11-16, was Soon) copies THIS chart's LOOK onto every
// other chart in the open layout. This module is the one answer to "which part of a settings blob is the look":
//
//   APPEARANCE_SECTION_KEYS — the keys each appearance section of Chart Settings writes (Price style, Canvas,
//                             Header & legend, Markers). "Reset this section" resets exactly these (ChartSettingsModal
//                             reads this table), and "Apply to all charts" copies exactly these.
//   PER_CHART_KEYS          — the chart's own identity and state, NEVER copied: indicators/studies, moving averages,
//                             volume, panes and their sizes, compare symbols, scales, drawings, session/extended-hours,
//                             the indicator-owned header values and the timeframe favourites.
//
// The symbol, timeframe, drawings, zoom / visible range and link group are not in the settings blob at all (they are the
// widget's `opts.tf`, its colour group, the drawing store and the chart's own view), so they can never be copied here.
//
// ⛔ CLASSIFICATION RAIL — `chartAppearance.test.js` fails when the settings allow-list (`mergeChartSettings`) or
// CHART_DEFAULTS grows a top-level key that is in neither list. A new setting is therefore decided (look or per-chart)
// before it ships, and never broadcast to every chart by accident.

import { INFO_VALUES_KEY } from './engine/infoValues'

export const APPEARANCE_SECTION_KEYS = Object.freeze({
  // `candles` carries the Body / Borders / Wick on/offs and the last-price line; `showPriceLabels` is the
  // "Price label on the scale" row here (and "Price labels" on Canvas — one key, both sections own it).
  price: Object.freeze(['chartType', 'candleColorMode', 'candles', 'countdown', 'showPriceLabels']),
  // `grid` carries `grid.lines`; `scaleTime` is the right margin, price decimals, time format and time zone;
  // `sessionBreaks` is Grid → Session breaks. (Background → "Shade pre / post-market" writes the per-chart
  // `extendedHoursShading` below — it is the chart's session/data mode, so it is never copied or section-reset.)
  canvas: Object.freeze(['bgMode', 'background', 'bgGradient', 'grid', 'crosshair', 'textSize', 'textColor', 'showPriceLabels', 'showMaLabels', 'watermark', 'scaleTime', 'sessionBreaks']),
  header: Object.freeze(['header']),
  // `preMarketLevels` is Previous-day levels → Pre-market high & low; `priceAlertLines` is Your activity → Price alerts;
  // `myTradeMarkers` is Your activity → My trades.
  markers: Object.freeze(['swingLabels', 'markers', 'prevDayLevels', 'darkPool', 'preMarketLevels', 'nextEarningsMarker', 'priceAlertLines', 'myTradeMarkers']),
})

// The look outside the sections: the Shift+T light/dark palette and the preset marker every manual write stamps.
const APPEARANCE_EXTRA = ['theme', 'preset']

export const APPEARANCE_KEYS = Object.freeze([...new Set([
  ...Object.values(APPEARANCE_SECTION_KEYS).flat(), ...APPEARANCE_EXTRA,
])])

export const PER_CHART_KEYS = Object.freeze([
  // indicators / studies (the Indicators project owns these)
  'overlays', 'volume', 'indicators', 'indicatorInstances', 'volumeOverlayIndicators', 'indicatorDefaults',
  'uctIntelligence', 'showChartIq', 'showPatterns', 'signature',
  // panes
  'paneOrder', 'paneSizes', 'paneSeriesOrder',
  // compare symbols + the chart's scale / data mode (toolbar state, not Chart Settings)
  'comparisonSymbols', 'compareHideBase', 'invertScale', 'logScale', 'percentScale', 'heikinAshi',
  'extendedHoursShading', 'sessionView', 'breadthChartType',
  // drawings
  'hideDrawings', 'drawingDefaults',
  // tools + bookkeeping
  'positionCalc', 'settingsVersion',
])

// Inside an appearance section, the few sub-keys that belong to the chart rather than to its look — kept from the
// TARGET, never copied (the same ones "Reset this section" keeps): the header's indicator values (they name the
// source chart's own indicator instances), the timeframe menu's favourites, and the price scale's magnet.
const KEEP_FROM_TARGET = Object.freeze({
  header: Object.freeze([INFO_VALUES_KEY, 'timeframes', 'customTimeframes']),
  crosshair: Object.freeze(['magnet']),
})

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const own = (o, k) => isObj(o) && Object.prototype.hasOwnProperty.call(o, k) && o[k] !== undefined
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)))

/** The look of a settings blob: only the appearance keys it holds, deep-copied, without the per-chart sub-keys. */
export function appearanceOf(settings) {
  const out = {}
  if (!isObj(settings)) return out
  for (const k of APPEARANCE_KEYS) {
    if (!own(settings, k)) continue
    let v = clone(settings[k])
    if (KEEP_FROM_TARGET[k] && isObj(v)) {
      for (const sub of KEEP_FROM_TARGET[k]) delete v[sub]
    }
    out[k] = v
  }
  return out
}

/**
 * `target` wearing `source`'s look. Pure: neither argument is changed.
 *
 * Every appearance key takes the source's value; an appearance key the source does NOT hold is removed from the
 * target, because absent means "the default look" (the opt-in keys such as `sessionBreaks` / `scaleTime` are only
 * stored while set) — so the target ends up drawing exactly what the source draws. Every other key of the target
 * (indicators, panes, compare symbols, scales, drawings…) and the per-chart sub-keys above stay the target's own.
 */
export function applyAppearance(target, source) {
  const t = isObj(target) ? target : {}
  const look = appearanceOf(source)
  const out = { ...t }
  for (const k of APPEARANCE_KEYS) {
    if (own(look, k)) out[k] = look[k]
    else delete out[k]
    const keep = KEEP_FROM_TARGET[k]
    if (!keep) continue
    const mine = isObj(t[k]) ? t[k] : null
    const kept = mine ? keep.filter((sub) => own(mine, sub)) : []
    if (!kept.length) continue
    const merged = isObj(out[k]) ? { ...out[k] } : {}
    for (const sub of kept) merged[sub] = clone(mine[sub])
    out[k] = merged
  }
  return out
}
