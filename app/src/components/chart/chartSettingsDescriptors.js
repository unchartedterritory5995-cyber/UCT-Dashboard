// ── CHART SETTINGS DESCRIPTORS — what every chart setting IS, in one product-owned table ──
//
// `chartDefaults.js` says which keys a chart's settings blob may hold (CHART_DEFAULTS +
// the `mergeChartSettings` allow-list). This table says what each of those keys MEANS:
// a label, where it lives in Chart Settings, its type and allowed values, any prerequisite
// the UI enforces, and — the `agent` field — whether UCT Agent may write it.
//
// It is METADATA, not behaviour. Nothing here writes settings. The writer is the same
// `{...settings, <section>: {...section, key: value}, preset: 'custom'}` set that Chart
// Settings' own `setSetting` / `setHeader` / `setSwing` / `setMarker` / `setPrevDay` do.
// The option lists below are the ones ChartSettingsModal renders (it imports them from
// here), so the dialog and every consumer read one list.
//
// ⛔ COMPLETENESS RAIL — `chartSettingsDescriptors.test.js` walks `mergeChartSettings({})`
// and FAILS for any key with no row here. A new setting is therefore known (classified)
// before it ships, and never executable by accident: only `agent: 'eligible'` rows can be
// written by the Agent, and only through its approved `chart.setSetting` capability.
//
// `agent` classification:
//   'eligible'             — UCT Agent's chart.setSetting may write it (typed + validated below)
//   'specialized:<cap>'    — written only by a dedicated Agent capability with its own rules
//   'owned:<team>'         — owned by another project (indicators); never written here
//   'known'                — a real member-facing setting the Agent can describe but not change yet
//   'internal'             — bookkeeping / no member control (never offered)
// `id` ending in `.*` classifies a whole sub-object (free-form maps such as colour tables).
//
// ⛔ A RECEIPT FOLLOWS A REAL CHANGE. A row whose stored value does not reach what /charts draws is not a row
// the Agent may "succeed" on. These fields say what the chart really does with an eligible row:
//   `store`  — the value does NOT live in the settings blob: 'volumePanePref' (the member's charts_vol_pane_pct,
//              what dragging the separator writes) or 'watermarkPos' (the chart's opts.watermarkPos, what
//              right-click → Move watermark writes). chart.js writes and reads back THAT state.
//   `inert`  — why /charts ignores this row whatever it holds: `settingUnavailable` refuses with exactly that.
//   `scope`  — 'member' when one value applies to all of the member's charts (the receipt says so).
//   `fixedBy`— canvases that ignore this row: 'sunrise' (the workspace's Sunrise theme), 'light' (the Shift+T palette).
//   `drawnOn`— the timeframes that draw it. Elsewhere the value is saved and the receipt says it can't be seen here.
//   `refuseValue(v)` — why one VALUE of this row would not be what the chart shows.
// ⛔ `agent/settingsLiveness.test.js` fails any eligible row whose key the render path does not read, unless `inert` says so.

import { CROSSHAIR_MODES, crosshairModeOf } from './crosshairMode'
import { LEGEND_MODES, legendModeOf } from './legendMode'
import { CHART_DEFAULTS } from './chartDefaults'
import { PANE_LOOK, paneWatermarkOpacity } from './pane/paneLook'

export const CHART_SETTINGS_DESCRIPTOR_VERSION = 1

// ── the option lists Chart Settings renders (ChartSettingsModal imports these) ──
export const COLOR_MODES = [
  { val: 'onecolor', label: 'One Color' },
  { val: 'netchange', label: 'Net Change' },
  { val: 'openclose', label: 'Open vs Close' },
]
export const TITLE_MODES = [
  { val: 'ticker', label: 'Ticker' },
  { val: 'company', label: 'Company' },
  { val: 'both', label: 'Both' },
]
export const TEXT_SIZES = [8, 10, 11, 12, 14, 16, 18, 20, 22, 24, 28, 32, 40]
export const SWING_SENS = [['low', 'Low'], ['medium', 'Med'], ['high', 'High']]
export const EVENT_MARKERS = [['earnings', 'Earnings'], ['splits', 'Splits'], ['dividends', 'Dividends'], ['news', 'News'], ['desk', 'Desk mentions']]
export const PDL_LINES = [['high', 'Prev-day high'], ['low', 'Prev-day low'], ['close', 'Prev-day close']]
export const LINE_STYLES = [['solid', 'Solid'], ['dashed', 'Dashed'], ['dotted', 'Dotted']]
export const PDL_WIDTHS = [1, 2, 3, 4]
// Watermark size scale (× the base per-role font, shown as %) and font weights.
// The crosshair's line options, exactly what the colour panel offers (a test keeps them equal to
// ColorPanel's own literals, which the drawing layer pins — ColorPanel does not import these).
// Style values are the chart library's LineStyle numbers; the labels are what members say.
export const CROSSHAIR_WIDTHS = [1, 2, 3, 4]
export const CROSSHAIR_STYLES = [[0, 'solid'], [2, 'dashed'], [1, 'dotted']]
export const WM_SIZES = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4]
export const WM_WEIGHTS = [[300, 'Thin'], [400, 'Light'], [500, 'Regular'], [600, 'Medium'], [700, 'Bold'], [800, 'Heavy']]
// The watermark's lines; the 3rd element marks a default-OFF line (logo).
export const WM_LINES = [['logo', 'Logo', true], ['ticker', 'Ticker'], ['interval', 'Interval'], ['company', 'Company'], ['sector', 'Sector'], ['industry', 'Industry'], ['theme', 'Theme']]

const BAR_TYPES = ['bars', 'hlc']
// UI prerequisites that are another SETTING (the dialog only shows the control while it holds).
const WHEN_WATERMARK = { setting: 'watermark.visible', value: true, why: 'Turn the watermark on first — its details only apply while it is shown.' }
const WHEN_SWING = { setting: 'swingLabels.enabled', value: true, why: 'Turn swing labels on first — their options only apply while they are shown.' }
const WHEN_CROSSHAIR = { setting: 'crosshair.mode', not: 'off', why: 'The crosshair is off — turn it on first to change its color.' }
const WHEN_SWING_BG = [WHEN_SWING, { setting: 'swingLabels.bgEnabled', value: true, why: 'Turn the swing label background on first.' }]
const WHEN_SWING_TINT = [WHEN_SWING, { setting: 'swingLabels.tintByType', value: true, why: 'Turn on "tinted by high/low" first — the high and low colors only apply then.' }]
const WHEN_EARNINGS = { setting: 'markers.earnings', value: true, why: 'Turn earnings markers on first — their beat/miss colors only apply while they are shown.' }
const whenPdl = (k) => ({ setting: `prevDayLevels.${k}.enabled`, value: true, why: `Turn the ${k} prev-day line on first — its style only applies while it is shown.` })
// ⭐ W1-B (Wave 1, 2026-11-02; owner-approved, announced to Charts): the prerequisites of the rows promoted below
const WHEN_GRADIENT = { setting: 'bgMode', value: 'gradient', why: 'Switch the background to Gradient first — the gradient colors only apply then.' }
const WHEN_VOL_SHOWN = [
  { setting: 'volume.visible', value: true, why: 'Show Volume first — the pane height only applies while it is on the chart.' },
  { setting: 'volume.removed', not: true, why: 'Volume was removed from this chart — add it back first; the pane height only applies then.' },
]
const WHEN_IPO = { setting: 'markers.ipo', value: true, why: 'Turn the IPO marker on first — its color only applies while it is shown.' }
const WHEN_DARKPOOL = { setting: 'darkPool.enabled', value: true, why: 'Turn dark-pool levels on first — their colors only apply while they are shown.' }
const vals = (xs) => xs.map(x => (Array.isArray(x) ? x[0] : (x && typeof x === 'object' ? x.val : x)))
export const VOLUME_BAR_STYLES = ['columns', 'histogram']

// ── eligible: typed, validated, writable by the Agent ──
const E = (id, section, label, type, extra = {}) => ({ id, section, label, type, agent: 'eligible', ...extra })
// a NUMBER setting: `min`–`max` (inclusive), `integer` when the control takes whole numbers (W1-B)
const N = (id, section, label, extra = {}) => ({ id, section, label, type: 'number', agent: 'eligible', ...extra })
const ELIGIBLE = [
  E('grid.visible', 'canvas', 'Grid lines', 'bool', { ui: 'Chart Settings → Canvas → Grid', words: ['grid', 'grid lines', 'gridlines'] }),
  E('crosshair.mode', 'canvas', 'Crosshair', 'enum', { options: CROSSHAIR_MODES, ui: 'Chart Settings → Canvas → Crosshair', words: ['crosshair'],
    // The Crosshair control writes ONLY `crosshair.mode` (the legacy `enabled` is read-only).
    boolMap: { true: 'always', false: 'off' } }),
  E('textSize', 'canvas', 'Scale text size', 'enum', { options: TEXT_SIZES, ui: 'Chart Settings → Canvas → Scale text' }),
  E('showPriceLabels', 'canvas', 'Price labels on the axis', 'bool', { ui: 'Chart Settings → Canvas', words: ['price labels'] }),
  E('showMaLabels', 'canvas', 'Moving-average labels', 'bool', { ui: 'Chart Settings → Canvas', words: ['ma labels', 'moving average labels'] }),
  E('invertScale', 'scale', 'Inverted price scale', 'bool', { ui: 'Alt+I on the chart', words: ['inverted scale', 'invert scale', 'upside down'] }),
  E('watermark.visible', 'watermark', 'Watermark', 'bool', { ui: 'Chart Settings → Canvas → Watermark', words: ['watermark'] }),
  E('header.titleMode', 'header', 'Title shows', 'enum', { options: vals(TITLE_MODES), ui: 'Chart Settings → Header → Title' }),
  E('header.showChange', 'header', 'Day change beside the title', 'bool', { ui: 'Chart Settings → Header → Title', words: ['day change'] }),
  E('header.legendMode', 'header', 'Chart legend', 'enum', { options: LEGEND_MODES, ui: 'Chart Settings → Header → Chart Legend', words: ['legend', 'chart legend'],
    boolMap: { true: 'always', false: 'off' } }),
  E('candleColorMode', 'priceStyle', 'Candle color mode', 'enum', { options: vals(COLOR_MODES), ui: 'Chart Settings → Price Style → Color mode' }),
  E('candles.thinBars', 'priceStyle', 'Thin bars', 'bool', { ui: 'Chart Settings → Price Style → Bar thickness (Bars / HLC only)',
    requires: { chartType: BAR_TYPES, why: 'Bar thickness only applies to Bars and HLC charts — the Price Style tab shows it only for those types.' } }),
  E('countdown', 'markers', 'Bar-close countdown', 'bool', { ui: 'Chart Settings → Markers → Countdown (intraday)', words: ['countdown', 'bar countdown'] }),
  E('swingLabels.enabled', 'markers', 'Swing labels', 'bool', { ui: 'Chart Settings → Markers → Swing labels', words: ['swing labels'] }),
  E('swingLabels.sensitivity', 'markers', 'Swing label sensitivity', 'enum', { options: vals(SWING_SENS), ui: 'Chart Settings → Markers → Swing labels', requires: WHEN_SWING }),
  // ── Batch 6: promoted from `known` (every one a plain field set in the dialog) ──
  E('swingLabels.tintByType', 'markers', 'Swing labels tinted by high/low', 'bool', { ui: 'Chart Settings → Markers → Swing labels', requires: WHEN_SWING }),
  E('swingLabels.bgEnabled', 'markers', 'Swing label background', 'bool', { ui: 'Chart Settings → Markers → Swing labels', requires: WHEN_SWING, default: true }),
  E('grid.color', 'canvas', 'Grid color', 'color', { ui: 'Chart Settings → Canvas → Grid' }),
  E('crosshair.color', 'canvas', 'Crosshair color', 'color', { ui: 'Chart Settings → Canvas → Crosshair', requires: WHEN_CROSSHAIR }),
  E('crosshair.width', 'canvas', 'Crosshair thickness', 'enum', { options: CROSSHAIR_WIDTHS, ui: 'Chart Settings → Canvas → Crosshair color → Thickness', requires: WHEN_CROSSHAIR }),
  E('crosshair.style', 'canvas', 'Crosshair line style', 'enum', { options: vals(CROSSHAIR_STYLES), labels: Object.fromEntries(CROSSHAIR_STYLES.map(([v, n]) => [n, v])), ui: 'Chart Settings → Canvas → Crosshair color → Line style', requires: WHEN_CROSSHAIR }),
  E('crosshair.magnet', 'canvas', 'Magnet crosshair (snaps to the bar)', 'bool', { ui: 'Right-click the price axis → Magnet crosshair', words: ['magnet', 'snap'] }),
  E('swingLabels.color', 'markers', 'Swing label color', 'color', { ui: 'Chart Settings → Markers → Swing labels → Label color', requires: WHEN_SWING }),
  E('swingLabels.bg', 'markers', 'Swing label background color', 'color', { ui: 'Chart Settings → Markers → Swing labels → Label background', requires: WHEN_SWING_BG }),
  E('swingLabels.upColor', 'markers', 'Swing-high color', 'color', { ui: 'Chart Settings → Markers → Swing labels', requires: WHEN_SWING_TINT }),
  E('swingLabels.downColor', 'markers', 'Swing-low color', 'color', { ui: 'Chart Settings → Markers → Swing labels', requires: WHEN_SWING_TINT }),
  E('markers.earningsBeat', 'markers', 'Earnings beat color', 'color', { ui: 'Chart Settings → Markers → Earnings → Beat color', requires: WHEN_EARNINGS }),
  E('markers.earningsMiss', 'markers', 'Earnings miss color', 'color', { ui: 'Chart Settings → Markers → Earnings → Miss color', requires: WHEN_EARNINGS }),
  // ⛔ layout.textColor is `axisAuto.ink`: the axes follow the canvas (owner request 2026-07-23), never this setting
  E('textColor', 'canvas', 'Scale text color', 'color', { ui: 'Chart Settings → Canvas → Scale text',
    inert: 'The price and date scales pick their text color from the chart background automatically, so this setting wouldn’t change them.' }),
  E('watermark.sizeScale', 'watermark', 'Watermark size', 'enum', { options: WM_SIZES, ui: 'Chart Settings → Canvas → Watermark', requires: WHEN_WATERMARK }),
  E('watermark.weight', 'watermark', 'Watermark weight', 'enum', { options: vals(WM_WEIGHTS), ui: 'Chart Settings → Canvas → Watermark', requires: WHEN_WATERMARK }),
  // ── Charts operator P1: the watermark's colour (the dialog's picker writes it with the opacity beside it, unchanged) ──
  E('watermark.color', 'watermark', 'Watermark color', 'color', { ui: 'Chart Settings → Canvas → Watermark', requires: WHEN_WATERMARK }),
  ...WM_LINES.map(([k, label, defOff]) => E(`watermark.lines.${k}`, 'watermark', `Watermark ${label.toLowerCase()} line`, 'bool',
    { ui: 'Chart Settings → Canvas → Watermark', requires: WHEN_WATERMARK, default: !defOff })),
  ...PDL_LINES.flatMap(([k, label]) => [
    E(`prevDayLevels.${k}.style`, 'markers', `${label} line style`, 'enum', { options: vals(LINE_STYLES), ui: 'Chart Settings → Markers → Prev-day levels', requires: whenPdl(k) }),
    E(`prevDayLevels.${k}.width`, 'markers', `${label} line width`, 'enum', { options: PDL_WIDTHS, ui: 'Chart Settings → Markers → Prev-day levels', requires: whenPdl(k) }),
    E(`prevDayLevels.${k}.color`, 'markers', `${label} line color`, 'color', { ui: 'Chart Settings → Markers → Prev-day levels', requires: whenPdl(k) }),
  ]),
  ...EVENT_MARKERS.map(([k, label]) => E(`markers.${k}`, 'markers', `${label} markers`, 'bool',
    { ui: 'Chart Settings → Markers → Events', words: [`${label.toLowerCase()} markers`, `${label.toLowerCase()} marker`] })),
  ...PDL_LINES.map(([k, label]) => E(`prevDayLevels.${k}.enabled`, 'markers', `${label} line`, 'bool',
    { ui: 'Chart Settings → Markers → Prev-day levels (intraday)', words: [`${label.toLowerCase()} line`, `previous day ${k}`, `prior day ${k}`] })),
  // ── W1-B (Wave 1, 2026-11-02; owner-approved for Wave 1, announced to Charts): KNOWN → ELIGIBLE. Each row is a
  // plain field the product's own control writes (ChartSettingsModal setSetting / the color menu / the pane drag /
  // the toolbar), written here with the same `withSetting` shape. Not promoted: `header.show*` (the Info row now
  // stores `header.fields`; the legacy flags are migration inputs — a `header.fields` list writer is the honest
  // capability), `volume.plotStyle` (declared, not yet honoured by StockChart), `watermark.lines.*` (already rows). ──
  // W1.1 R-01 (LT-3, live 2026-11-03 "turn the gradient off"): the Background control's Solid / Gradient switch itself —
  // ChartSettingsModal setBgMode writes `setSetting({ bgMode })`, a plain field — so gradient on/off is a setting the Agent
  // can name (bgMode gradient|solid) instead of an id the model invents. Its solid COLOR stays chart.setBackground's.
  E('bgMode', 'canvas', 'Gradient background', 'enum', { options: ['solid', 'gradient'], ui: 'Chart Settings → Canvas → Background → Solid / Gradient',
    words: ['gradient', 'gradient background', 'background gradient', 'the gradient', 'gradient bg'], boolMap: { true: 'gradient', false: 'solid' } }),
  E('bgGradient.top', 'canvas', 'Gradient background top color', 'color', { ui: 'Chart Settings → Canvas → Background → Gradient', requires: WHEN_GRADIENT }),
  E('bgGradient.bottom', 'canvas', 'Gradient background bottom color', 'color', { ui: 'Chart Settings → Canvas → Background → Gradient', requires: WHEN_GRADIENT }),
  E('volume.upColor', 'volume', 'Volume up color', 'color', { ui: 'Chart Settings → Indicators → Volume' }),
  E('volume.downColor', 'volume', 'Volume down color', 'color', { ui: 'Chart Settings → Indicators → Volume' }),
  E('volume.hvcEnabled', 'volume', 'Highest-volume-candle marking', 'bool', { ui: 'Chart Settings → Indicators → Volume', words: ['highest volume candle', 'hvc'] }),
  // ⛔ D1: every /charts chart passes `volumeSeparatePane` (paneLook.js PANE_LOOK), and that prop beats this setting. DERIVED from the prop.
  E('volume.separatePane', 'volume', 'Volume in its own pane', 'bool', { ui: 'Chart Settings → Indicators → Volume', words: ['separate volume pane', 'volume in its own pane'],
    ...(PANE_LOOK.volumeSeparatePane ? { inert: 'Charts always draws Volume in its own pane, so this setting changes nothing here. You can resize that pane, or hide Volume.' } : {}) }),
  // ⛔ D1: /charts sizes the pane from the member's charts_vol_pane_pct (paneVolumePct → `volumePaneHeightPct`), never from the blob.
  N('volume.paneHeightPct', 'volume', 'Volume pane height (% of the chart)', { ui: 'drag the pane separator', min: 8, max: 45, integer: true, requires: WHEN_VOL_SHOWN, store: 'volumePanePref', scope: 'member' }),
  E('volume.labelVisible', 'volume', 'Volume label', 'bool', { ui: 'Chart Settings → Indicators → Volume', words: ['volume label'] }),
  E('volume.labelColor', 'volume', 'Volume label color', 'color', { ui: 'Chart Settings → Indicators → Volume' }),
  N('volume.maPeriod', 'volume', 'Volume moving-average period (0 = none)', { ui: 'Chart Settings → Indicators → Volume', min: 0, max: 500, integer: true }),
  E('volume.maColor', 'volume', 'Volume moving-average color', 'color', { ui: 'Chart Settings → Indicators → Volume', alpha: true }),
  E('volume.maLineWidth', 'volume', 'Volume moving-average width', 'enum', { options: PDL_WIDTHS, ui: 'Chart Settings → Indicators → Volume' }),
  // ⛔ StockChart draws the volume MA with a colour and a width only; nothing reads this style
  E('volume.maLineStyle', 'volume', 'Volume moving-average style', 'enum', { options: vals(LINE_STYLES), ui: 'Chart Settings → Indicators → Volume',
    inert: 'The volume moving average is always drawn solid — its line style isn’t something the chart applies. I can change its color or width.' }),
  E('volume.barStyle', 'volume', 'Volume bar style', 'enum', { options: VOLUME_BAR_STYLES, ui: 'Chart Settings → Indicators → Volume → Columns / Histogram' }),
  N('watermark.opacity', 'watermark', 'Watermark opacity (0 to 1)', { ui: 'Chart Settings → Canvas → Watermark → Color & opacity', min: 0, max: 1, requires: WHEN_WATERMARK,
    // paneWatermarkOpacity treats the faint default as "unset" and draws its strong look instead
    refuseValue: (v) => (paneWatermarkOpacity({ watermark: { opacity: v } }) !== v ? `Charts treats ${v} as “not set” and draws the watermark at its strong default instead. Try a value just above or below it.` : null) }),
  // ⛔ D2: a moved watermark is `opts.watermarkPos` (ChartWidget), which beats `cs.watermark.x/y`
  N('watermark.x', 'watermark', 'Watermark horizontal position (0 = left, 1 = right)', { ui: 'right-click → Move watermark', min: 0, max: 1, requires: WHEN_WATERMARK, store: 'watermarkPos' }),
  N('watermark.y', 'watermark', 'Watermark vertical position (0 = top, 1 = bottom)', { ui: 'right-click → Move watermark', min: 0, max: 1, requires: WHEN_WATERMARK, store: 'watermarkPos' }),
  E('markers.ipo', 'markers', 'IPO marker', 'bool', { ui: 'Chart Settings → Markers', words: ['ipo marker', 'ipo markers', 'ipo badge'] }),
  E('markers.ipoColor', 'markers', 'IPO marker color', 'color', { ui: 'Chart Settings → Markers', requires: WHEN_IPO }),
  E('darkPool.enabled', 'markers', 'Dark-pool levels', 'bool', { ui: 'Chart Settings → Markers → Dark pool', words: ['dark pool', 'dark pool levels', 'dark pool bars', 'dark pool prints'] }),
  E('darkPool.barColor', 'markers', 'Dark-pool bar color', 'color', { ui: 'Chart Settings → Markers → Dark pool', alpha: true, requires: WHEN_DARKPOOL }),
  E('darkPool.labelColor', 'markers', 'Dark-pool label color', 'color', { ui: 'Chart Settings → Markers → Dark pool', alpha: true, requires: WHEN_DARKPOOL }),
  E('heikinAshi', 'priceStyle', 'Heikin Ashi candles', 'bool', { ui: 'a chart setting with no button on /charts (the chart draws it once set)', words: ['heikin ashi', 'heiken ashi', 'heikin-ashi'] }),
  E('showChartIq', 'tools', 'Chart IQ pattern recognition', 'bool', { ui: 'Chart toolbar → Chart IQ (server-gated: drawn only where Chart IQ is served)', words: ['chart iq', 'pattern recognition', 'patterns'] }),
  N('positionCalc.accountSize', 'tools', 'Position calculator account size', { ui: 'Position Calculator', min: 0, max: 1e9 }),
  N('positionCalc.riskPct', 'tools', 'Position calculator risk per trade (%)', { ui: 'Position Calculator', min: 0, max: 100 }),
]

// What StockChart's themeColors ignores (a Sunrise canvas has no grid and its own colors; the light palette has its own)
const FIXED_BY = {
  'grid.visible': ['sunrise'], 'grid.color': ['sunrise', 'light'], 'crosshair.color': ['sunrise', 'light'],
  bgMode: ['sunrise', 'light'], 'bgGradient.top': ['sunrise', 'light'], 'bgGradient.bottom': ['sunrise', 'light'],
}
for (const d of ELIGIBLE) {
  if (FIXED_BY[d.id]) d.fixedBy = FIXED_BY[d.id]
  // StockChart's own gates: `_isDWM` (swing labels), `pdlIntraday`, `countdownTfSec`, CHART_IQ_TFS
  if (d.id.startsWith('swingLabels.')) d.drawnOn = 'dailyUp'
  if (d.id.startsWith('prevDayLevels.')) d.drawnOn = 'intraday'
  if (d.id === 'countdown') d.drawnOn = 'countdown'
  if (d.id === 'showChartIq') d.drawnOn = 'chartIq'
}

// ── specialized: an Agent capability with its own rules already owns the write ──
const S = (id, cap) => ({ id, agent: `specialized:${cap}` })
const SPECIALIZED = [
  S('chartType', 'chart.setType'), S('breadthChartType', 'chart.setType'),
  S('logScale', 'chart.setScale'), S('percentScale', 'chart.setScale'),
  S('extendedHoursShading', 'chart.setSession'), S('sessionView', 'chart.setSession'),
  S('background', 'chart.setBackground'),
  ...['upColor', 'downColor', 'upBorder', 'downBorder', 'upWick', 'downWick', 'oneColor'].map(k => S(`candles.${k}`, 'chart.setCandleColors')),
  S('volume.visible', 'volume.setState'), S('volume.removed', 'volume.setState'),
  S('comparisonSymbols', 'chart.compare'), S('compareHideBase', 'chartSetup.compareDisplay'),
]

// ── owned by another project (Indicator Intelligence) — never written by chart.setSetting ──
const O = (id) => ({ id, agent: 'owned:indicator' })
const OWNED = [
  O('indicatorInstances'), O('indicators.*'), O('overlays'), O('paneOrder'), O('paneSizes'), O('paneSeriesOrder'),
  O('volumeOverlayIndicators'), O('infoValues'),
  // ⭐ VA2 — "Save as my default" (the indicator settings dialog and the phone sheet).
  O('indicatorDefaults.*'),
]

// ── known member settings, not Agent-enabled yet (discoverable, refused) ──
const K = (id, section, label, ui) => ({ id, section, label, agent: 'known', ui })
const KNOWN = [
  K('crosshair.enabled', 'canvas', 'Crosshair (legacy on/off)', 'Chart Settings → Canvas → Crosshair'),
  K('header.timeframes', 'header', 'Favorite timeframes', 'Timeframe menu ★'),
  K('header.customTimeframes', 'header', 'Custom timeframes', 'Timeframe menu → Custom interval'),
  // (W1-B) the Info row stores `header.fields` (headerFields.js); these legacy flags are migration inputs it reads only
  // when `fields` is absent — writing them would change nothing on a migrated chart, so they stay known.
  K('header.showMarketCap', 'header', 'Market cap in the info row (Info row fields)', 'Chart Settings → Header → Info row'),
  K('header.showNextEarnings', 'header', 'Next earnings in the info row (Info row fields)', 'Chart Settings → Header → Info row'),
  K('header.showUctRating', 'header', 'UCT rating in the info row (Info row fields)', 'Chart Settings → Header → Info row'),
  K('header.showLegend', 'header', 'Chart legend (legacy on/off)', 'Chart Settings → Header → Chart Legend'),
  K('header.colors.*', 'header', 'Header colors', 'Chart Settings → Header'),
  K('volume.plotStyle', 'volume', 'Volume plot style (declared, not yet honoured)', 'Chart Settings → Indicators → Volume'),
  K('drawingDefaults.*', 'drawings', 'Default drawing style', 'drawing → Save as default'),
  K('theme', 'canvas', 'Light/dark palette (Shift+T)', 'Shift+T on the chart'),
]

// ── internal: bookkeeping or dead data, never offered ──
const I = (id, why) => ({ id, agent: 'internal', why })
const INTERNAL = [
  I('settingsVersion', 'schema version'), I('preset', 'set to "custom" by every manual write'),
  I('header.legendLayout', 'dead data — nothing reads it'),
  // the Auto patterns layer of the UCT Intelligence indicator (uctIntelligence.js) and the toolbar's Patterns button: gated per
  // viewer, so never a generic setting — the Agent writes it only through uctIntelligence.set, which checks those gates
  I('showPatterns', 'UCT Intelligence → Auto patterns (and the toolbar Patterns button); the Agent uses uctIntelligence.set'),
  I('hideDrawings', 'right-click → Hide all drawings; the Agent hides drawings per drawing, through drawing.setAllVisible'),
  I('signature.*', 'not a member control on /charts')
]

export const CHART_SETTING_DESCRIPTORS = [...ELIGIBLE, ...SPECIALIZED, ...OWNED, ...KNOWN, ...INTERNAL]

export const ELIGIBLE_SETTINGS = ELIGIBLE
// The top-level keys other projects own (Indicator Intelligence: instances, panes, overlays).
// A whole-look write by UCT Agent (template, restore defaults) carries these over from the
// chart UNCHANGED — the Agent never adds, removes or resets an indicator.
export const OWNED_TOP_KEYS = [...new Set(OWNED.map(d => d.id.split('.')[0]))]
export const settingDescriptor = (id) => CHART_SETTING_DESCRIPTORS.find(d => d.id === id) || null

/** The descriptor that classifies a settings PATH (exact id first, then the nearest `x.*`). */
export function classifySettingPath(path) {
  const exact = CHART_SETTING_DESCRIPTORS.find(d => d.id === path)
  if (exact) return exact
  const parts = path.split('.')
  for (let n = parts.length; n >= 1; n -= 1) {
    const hit = CHART_SETTING_DESCRIPTORS.find(d => d.id === `${parts.slice(0, n).join('.')}.*`)
    if (hit) return hit
  }
  return null
}

const getPath = (o, path) => path.split('.').reduce((v, k) => (v == null ? undefined : v[k]), o)

/** The setting's current value, as the chart resolves it (missing nested keys read as the UI's default). */
export function settingValue(settings, d) {
  // The two 3-way modes resolve through the product's own resolvers (legacy booleans are
  // fallback INPUTS to them, never read here — legendSingleAuthority.test.js).
  if (d.id === 'crosshair.mode') return crosshairModeOf(settings)
  if (d.id === 'header.legendMode') return legendModeOf(settings)
  const v = getPath(settings, d.id)
  if (v !== undefined) return v
  // A missing key reads as the dialog shows it: the descriptor's `default` (e.g. a watermark
  // line that is ON unless turned off), else the CHART_DEFAULTS value, else off.
  if (d.default !== undefined) return d.default
  const dv = getPath(CHART_DEFAULTS, d.id)
  if (dv !== undefined) return dv
  return d.type === 'bool' ? false : undefined
}

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i
const HEX_ALPHA = /^#?([0-9a-f]{8})$/i
/** "#abc" / "abc" / "#aabbcc" → "#aabbcc"; anything else → null. With `alpha`, "#aabbccdd" (the color menu's
 *  opacity slider stored inline — dark-pool bars, the volume MA) is kept as the 8-digit form. */
export function normalizeHex(raw, { alpha = false } = {}) {
  const s = String(raw || '').trim()
  if (alpha) { const a = HEX_ALPHA.exec(s); if (a) return `#${a[1].toLowerCase()}` }
  const m = HEX.exec(s)
  if (!m) return null
  const h = m[1].length === 3 ? m[1].split('').map(c => c + c).join('') : m[1]
  return `#${h.toLowerCase()}`
}

/**
 * Validate a requested value against the descriptor. Returns { ok, value } with the value in
 * the setting's own type, or { ok: false, why }. A bool-shaped request for a 3-way mode uses
 * the descriptor's `boolMap` ("crosshair off" → 'off').
 */
export function coerceSettingValue(d, raw) {
  if (!d || d.agent !== 'eligible') return { ok: false, why: 'not a setting UCT Agent can change' }
  if (d.type === 'bool') {
    if (typeof raw === 'boolean') return { ok: true, value: raw }
    const s = String(raw).trim().toLowerCase()
    if (['true', 'on', 'show', 'yes', 'enabled'].includes(s)) return { ok: true, value: true }
    if (['false', 'off', 'hide', 'no', 'disabled'].includes(s)) return { ok: true, value: false }
    return { ok: false, why: `${d.label} is on or off` }
  }
  if (d.type === 'enum') {
    if (typeof raw === 'boolean' && d.boolMap) return { ok: true, value: d.boolMap[String(raw)] }
    const hit = d.options.find(o => String(o).toLowerCase() === String(raw).trim().toLowerCase())
    if (hit !== undefined) return { ok: true, value: hit }
    const named = d.labels ? d.labels[String(raw).trim().toLowerCase()] : undefined
    if (named !== undefined) return { ok: true, value: named }
    if (d.boolMap && ['on', 'off', 'true', 'false', 'show', 'hide'].includes(String(raw).trim().toLowerCase())) {
      return { ok: true, value: d.boolMap[String(['on', 'true', 'show'].includes(String(raw).trim().toLowerCase()))] }
    }
    return { ok: false, why: `${d.label} can be ${d.labels ? Object.keys(d.labels).join(', ') : d.options.join(', ')}` }
  }
  if (d.type === 'color') {
    // The dialog's colour picker writes a hex colour into the same key (8-digit where its opacity slider is stored inline).
    const hex = normalizeHex(raw, { alpha: d.alpha === true })
    return hex ? { ok: true, value: hex } : { ok: false, why: `${d.label} needs a hex color such as #2962ff` }
  }
  if (d.type === 'number') {
    // W1-B: the control's own range; a whole-number control takes whole numbers (a "70%" opacity is said as 0.7)
    const n = typeof raw === 'number' ? raw : Number(String(raw).trim().replace(/%$/, ''))
    if (!Number.isFinite(n)) return { ok: false, why: `${d.label} is a number${d.min != null ? ` from ${d.min} to ${d.max}` : ''}` }
    if ((d.min != null && n < d.min) || (d.max != null && n > d.max)) return { ok: false, why: `${d.label} is from ${d.min} to ${d.max}` }
    if (d.integer && !Number.isInteger(n)) return { ok: false, why: `${d.label} is a whole number from ${d.min} to ${d.max}` }
    return { ok: true, value: n }
  }
  return { ok: false, why: `${d.label} has no supported type` }
}

/** Why this chart's canvas ignores a color change right now (`fixedBy` = which canvases to ask about), or null. */
export function canvasLock(settings, canvasTheme, fixedBy = ['sunrise', 'light']) {
  if (canvasTheme === 'sunrise' && fixedBy.includes('sunrise')) return 'Charts is on the Sunrise theme, which sets its own canvas, grid and candle colors, so this would change nothing. Switch the Charts theme back first.'
  if (settings?.theme === 'light' && fixedBy.includes('light')) return 'This chart is on the light palette (Shift+T), which sets its own canvas, grid and crosshair colors, so this would change nothing. Switch it back to dark first.'
  return null
}

const DRAWN_ON = {
  dailyUp: { on: ['D', 'W', 'M'], word: 'daily, weekly and monthly charts' },
  intraday: { on: ['1', '5', '15', '30', '60'], word: 'the 1, 5, 15, 30 and 60 minute charts' },
  countdown: { on: ['1', '5', '15', '30', '60', 'D'], word: 'intraday and daily charts' },
  chartIq: { on: ['D', 'W'], word: 'daily and weekly charts' },
}
/** The clause a receipt owes when this timeframe does not draw the row (saved, but nothing changes on screen), or ''. */
export function settingHiddenNote(d, tf, value) {
  const gate = DRAWN_ON[d?.drawnOn]
  if (!gate || value === false || gate.on.includes(String(tf))) return ''
  return ` — saved, but it only shows on ${gate.word}, so you won't see it on this chart at this timeframe`
}

/** The UI-unavailable reason for this setting on this chart, or null (the same prerequisites the dialog enforces). */
export function settingUnavailable(d, settings, { canvasTheme = null } = {}) {
  if (d?.inert) return d.inert
  const lock = d?.fixedBy ? canvasLock(settings, canvasTheme, d.fixedBy) : null
  if (lock) return lock
  if (Array.isArray(d?.requires)) {
    for (const one of d.requires) { const why = settingUnavailable({ requires: one }, settings); if (why) return why }
    return null
  }
  const r = d?.requires
  if (r?.chartType && !r.chartType.includes(settings?.chartType || 'candles')) return r.why
  if (r?.setting) {
    const dep = settingDescriptor(r.setting)
    const cur = dep ? settingValue(settings, dep) : getPath(settings, r.setting)
    if ('value' in r && cur !== r.value) return r.why
    if ('not' in r && cur === r.not) return r.why
  }
  return null
}

/**
 * THE write — exactly the shape Chart Settings' own setters produce: the nested section is
 * spread (siblings kept), the leaf set, and `preset: 'custom'` stamped.
 */
export function withSetting(settings, d, value) {
  const parts = d.id.split('.')
  const next = { ...settings, preset: 'custom' }
  let o = next
  for (let i = 0; i < parts.length - 1; i += 1) {
    o[parts[i]] = { ...((o[parts[i]] && typeof o[parts[i]] === 'object') ? o[parts[i]] : {}) }
    o = o[parts[i]]
  }
  o[parts[parts.length - 1]] = value
  return next
}
