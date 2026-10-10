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

import { CROSSHAIR_MODES, crosshairModeOf } from './crosshairMode'
import { LEGEND_MODES, legendModeOf } from './legendMode'
import { CHART_DEFAULTS } from './chartDefaults'

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
const vals = (xs) => xs.map(x => (Array.isArray(x) ? x[0] : (x && typeof x === 'object' ? x.val : x)))

// ── eligible: typed, validated, writable by the Agent ──
const E = (id, section, label, type, extra = {}) => ({ id, section, label, type, agent: 'eligible', ...extra })
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
  E('textColor', 'canvas', 'Scale text color', 'color', { ui: 'Chart Settings → Canvas → Scale text' }),
  E('watermark.sizeScale', 'watermark', 'Watermark size', 'enum', { options: WM_SIZES, ui: 'Chart Settings → Canvas → Watermark', requires: WHEN_WATERMARK }),
  E('watermark.weight', 'watermark', 'Watermark weight', 'enum', { options: vals(WM_WEIGHTS), ui: 'Chart Settings → Canvas → Watermark', requires: WHEN_WATERMARK }),
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
]

// ── specialized: an Agent capability with its own rules already owns the write ──
const S = (id, cap) => ({ id, agent: `specialized:${cap}` })
const SPECIALIZED = [
  S('chartType', 'chart.setType'), S('breadthChartType', 'chart.setType'),
  S('logScale', 'chart.setScale'), S('percentScale', 'chart.setScale'),
  S('extendedHoursShading', 'chart.setSession'), S('sessionView', 'chart.setSession'),
  S('background', 'chart.setBackground'), S('bgMode', 'chart.setBackground'),
  ...['upColor', 'downColor', 'upBorder', 'downBorder', 'upWick', 'downWick', 'oneColor'].map(k => S(`candles.${k}`, 'chart.setCandleColors')),
  S('volume.visible', 'volume.setState'), S('volume.removed', 'volume.setState'),
  S('comparisonSymbols', 'chart.setSymbol'), S('compareHideBase', 'chart.setSymbol'),
]

// ── owned by another project (Indicator Intelligence) — never written by chart.setSetting ──
const O = (id) => ({ id, agent: 'owned:indicator' })
const OWNED = [
  O('indicatorInstances'), O('indicators.*'), O('overlays'), O('paneOrder'), O('paneSizes'), O('paneSeriesOrder'),
  O('volumeOverlayIndicators'), O('infoValues'),
]

// ── known member settings, not Agent-enabled yet (discoverable, refused) ──
const K = (id, section, label, ui) => ({ id, section, label, agent: 'known', ui })
const KNOWN = [
  K('bgGradient.*', 'canvas', 'Gradient background colors', 'Chart Settings → Canvas → Background'),
  K('crosshair.enabled', 'canvas', 'Crosshair (legacy on/off)', 'Chart Settings → Canvas → Crosshair'),
  K('header.timeframes', 'header', 'Favorite timeframes', 'Timeframe menu ★'),
  K('header.customTimeframes', 'header', 'Custom timeframes', 'Timeframe menu → Custom interval'),
  K('header.showMarketCap', 'header', 'Market cap in the info row', 'Chart Settings → Header → Info row'),
  K('header.showNextEarnings', 'header', 'Next earnings in the info row', 'Chart Settings → Header → Info row'),
  K('header.showUctRating', 'header', 'UCT rating in the info row', 'Chart Settings → Header → Info row'),
  K('header.showLegend', 'header', 'Chart legend (legacy on/off)', 'Chart Settings → Header → Chart Legend'),
  K('header.colors.*', 'header', 'Header colors', 'Chart Settings → Header'),
  K('volume.upColor', 'volume', 'Volume up color', 'Chart Settings → Indicators → Volume'),
  K('volume.downColor', 'volume', 'Volume down color', 'Chart Settings → Indicators → Volume'),
  K('volume.hvcEnabled', 'volume', 'Highest-volume-candle marking', 'Chart Settings → Indicators → Volume'),
  K('volume.separatePane', 'volume', 'Volume in its own pane', 'Chart Settings → Indicators → Volume'),
  K('volume.paneHeightPct', 'volume', 'Volume pane height', 'drag the pane separator'),
  K('volume.labelVisible', 'volume', 'Volume label', 'Chart Settings → Indicators → Volume'),
  K('volume.labelColor', 'volume', 'Volume label color', 'Chart Settings → Indicators → Volume'),
  K('volume.maPeriod', 'volume', 'Volume moving-average period', 'Chart Settings → Indicators → Volume'),
  K('volume.maColor', 'volume', 'Volume moving-average color', 'Chart Settings → Indicators → Volume'),
  K('volume.maLineWidth', 'volume', 'Volume moving-average width', 'Chart Settings → Indicators → Volume'),
  K('volume.maLineStyle', 'volume', 'Volume moving-average style', 'Chart Settings → Indicators → Volume'),
  K('volume.barStyle', 'volume', 'Volume bar style', 'Chart Settings → Indicators → Volume'),
  K('volume.plotStyle', 'volume', 'Volume plot style', 'Chart Settings → Indicators → Volume'),
  K('watermark.opacity', 'watermark', 'Watermark opacity', 'Chart Settings → Canvas → Watermark'),
  K('watermark.color', 'watermark', 'Watermark color', 'Chart Settings → Canvas → Watermark'),
  K('watermark.lines.*', 'watermark', 'Watermark lines (ticker/company/sector…)', 'Chart Settings → Canvas → Watermark'),
  K('watermark.x', 'watermark', 'Watermark position', 'right-click → Move watermark'),
  K('watermark.y', 'watermark', 'Watermark position', 'right-click → Move watermark'),
  K('drawingDefaults.*', 'drawings', 'Default drawing style', 'drawing → Save as default'),
  K('hideDrawings', 'drawings', 'Hide all drawings', 'not on /charts (other chart surfaces)'),
  K('markers.ipo', 'markers', 'IPO marker', 'Chart Settings → Markers'),
  K('markers.ipoColor', 'markers', 'IPO marker color', 'Chart Settings → Markers'),
  K('darkPool.*', 'markers', 'Dark-pool levels (paid)', 'Chart Settings → Markers → Dark pool'),
  K('heikinAshi', 'priceStyle', 'Heikin Ashi', 'not on /charts (other chart surfaces)'),
  K('theme', 'canvas', 'Light/dark palette (Shift+T)', 'Shift+T on the chart'),
  K('positionCalc.*', 'tools', 'Position calculator defaults', 'Position Calculator'),
]

// ── internal: bookkeeping or dead data, never offered ──
const I = (id, why) => ({ id, agent: 'internal', why })
const INTERNAL = [
  I('settingsVersion', 'schema version'), I('preset', 'set to "custom" by every manual write'),
  I('header.legendLayout', 'dead data — nothing reads it'), I('showPatterns', 'control disabled in the product'),
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
/** "#abc" / "abc" / "#aabbcc" → "#aabbcc"; anything else → null. */
export function normalizeHex(raw) {
  const m = HEX.exec(String(raw || '').trim())
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
    // The dialog's colour picker writes a hex colour into the same key.
    const hex = normalizeHex(raw)
    return hex ? { ok: true, value: hex } : { ok: false, why: `${d.label} needs a hex color such as #2962ff` }
  }
  return { ok: false, why: `${d.label} has no supported type` }
}

/** The UI-unavailable reason for this setting on this chart, or null (the same prerequisites the dialog enforces). */
export function settingUnavailable(d, settings) {
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
