// ── UCT Agent PRODUCT GUIDE: the words that say WHICH one ───────────────────────────────────────────────────
//
// A registry feature teaches a FAMILY: "how do I draw a rectangle" and "how do I draw a pitchfork" are one walkthrough
// with one word changed. A `slot` reads that word from what the member said, and the steps name it as {slot.field}:
//
//   { target: 'chart.tool.{tool.id}', text: 'Click {tool.label}.' }
//
// A step marked `only: 'tool'` is left out when the words named no tool, `unless: 'tool'` when they did. A slot row is
// never a promise about the screen: its control is still found (or not) by targets.js. Nothing here is a phrase rule: a
// slot only ever narrows a feature the member has already been matched to.

import { catalogRows } from '../../components/chart/indicatorCatalog'
import { isCatalogRowOffered } from '../../components/chart/engine/serverCompute'
import * as nativeRegistry from '../../components/chart/engine/nativeRegistry'
import { menuGroups, labelMap } from '../../widgets/registry'
import { CHART_SETTING_DESCRIPTORS } from '../../components/chart/chartSettingsDescriptors'
import { ACTION_SLOTS } from './actions'

const firstRow = (rows) => (text) => rows.find(r => r.re.test(String(text || '').toLowerCase())) || null

// components/chart/ChartToolbar.jsx TOOLS (railed in agentGuideTargets.test.js: every tool has a row, every row a tool).
// `place`: what the member does on the chart once the tool is armed, in the tool's own words.
const TWO = 'Click the first point on the chart, then the second.'
export const DRAWING_TOOLS = [
  { id: 'trendline', label: 'Trendline', re: /\btrend ?lines?\b/, place: TWO },
  { id: 'extended', label: 'Extended Line', re: /\bextended lines?\b/, place: TWO },
  { id: 'hray', label: 'Horizontal Ray', re: /\bhorizontal rays?\b|\bh ?ray\b/, place: 'Click once at the price where the ray should start.' },
  { id: 'horizontal', label: 'Horizontal Line', re: /\bhorizontal (lines?|levels?)\b|\bprice lines?\b/, place: 'Click once at the price you want.' },
  { id: 'vertical', label: 'Vertical Line', re: /\bvertical lines?\b/, place: 'Click once at the date you want.' },
  { id: 'rect', label: 'Rectangle', re: /\b(rectangles?|boxes|box)\b/, place: 'Click one corner on the chart, then the opposite corner.' },
  { id: 'circle', label: 'Circle', re: /\b(circles?|ellipses?)\b/, place: TWO },
  { id: 'arrow', label: 'Arrow', re: /\barrows?\b/, place: 'Click where the arrow starts, then where it points.' },
  { id: 'fibext', label: 'Fibonacci Extension', re: /\bfib\w* ext\w*\b|\bextensions?\b/, place: 'Click the swing start, the swing end, then the retracement point.' },
  { id: 'fib', label: 'Fibonacci Retracement', re: /\bfib\w*\b|\bretracements?\b/, place: 'Click the swing start, then the swing end.' },
  { id: 'pitchfork', label: 'Pitchfork', re: /\bpitch ?forks?\b/, place: 'Click three points on the chart.' },
  { id: 'channel', label: 'Parallel Channel', re: /\b(parallel )?channels?\b/, place: 'Click the two ends of one side, then a third point for its width.' },
  { id: 'cup', label: 'Cup Curve', re: /\bcup\b/, place: 'Click the left rim, the bottom, then the right rim.' },
  { id: 'avwap', label: 'Anchored VWAP', re: /\banchored vwap\b|\bavwap\b|\banchor\w*\b.*\bvwap\b/, place: 'Click the bar to anchor it to.' },
  { id: 'text', label: 'Text Note', re: /\b(text( note)?|notes?|label)\b/, place: 'Click on the chart where the note goes, then type it.' },
  { id: 'measure', label: 'Measure', re: /\bmeasure\b|\bruler\b/, place: 'Click the start, then the end, to read the move.' },
  { id: 'dateRange', label: 'Bars & Time', re: /\bbars (&|and) time\b|\bdate range\b|\bcount\w*\b.*\bbars\b|\bhow many bars\b/, place: 'Click the start, then the end, to count the bars.' },
  { id: 'advance', label: 'Price Move', re: /\bprice move\b/, place: 'Click the setup candle, then the candle where the move tops.' },
  { id: 'position', label: 'Position Calculator', re: /\bposition (calculator|size|sizing|tool)\b|\bposition\b/, place: 'Enter your numbers in the panel; the entry, stop and target lines follow them on the chart.' },
]

// components/chart/keyboardShortcuts.js: the chord that arms a tool when a narrow chart cannot show its button
const CHORDS = { trendline: 'Alt+T', horizontal: 'Alt+H', hray: 'Alt+J', vertical: 'Alt+V', rect: 'Alt+R', circle: 'Alt+C', arrow: 'Alt+A', fib: 'Alt+F', fibext: 'Alt+E', pitchfork: 'Alt+Y', avwap: 'Alt+W', text: 'Alt+X', position: 'Alt+P', dateRange: 'Alt+Shift+D' }
for (const t of DRAWING_TOOLS) {
  t.a = /^[AEIOU]/.test(t.label) ? 'an' : 'a'
  t.narrow = CHORDS[t.id] ? `Click the chart, then press ${CHORDS[t.id]} to pick it.` : 'Make the chart wider (close a widget beside it, or close me for a moment) to reach it.'
}

// pages/charts/grid/gridLayouts.js LAYOUTS
export const GRID_PRESETS = [
  { id: '1x2', label: 'Side by side', re: /\bside by side\b|\b(two|2)[- ]charts?\b|\b1 ?[x×] ?2\b/ },
  { id: '2x1', label: 'Stacked', re: /\bstacked\b|\b2 ?[x×] ?1\b/ },
  { id: '2x3', label: '2×3', re: /\b2 ?[x×] ?3\b|\b(six|6)[- ]charts?\b/ },
  { id: '3x2', label: '3×2', re: /\b3 ?[x×] ?2\b/ },
  { id: '3x3', label: '3×3', re: /\b3 ?[x×] ?3\b|\b(nine|9)[- ]charts?\b/ },
  { id: '4x4', label: '4×4', re: /\b4 ?[x×] ?4\b|\b(sixteen|16)[- ]charts?\b/ },
  { id: '2x2', label: '2×2', re: /\b2 ?[x×] ?2\b|\b(four|4)[- ]charts?\b|\bquad\b/ },
]
const GRID_2X2 = GRID_PRESETS[GRID_PRESETS.length - 1]

// the per-indicator Inspector's own field labels (components/chart/ChartSettingsIndicators.jsx renderField / its sections)
export { CHORDS as TOOL_CHORDS }
export const INDICATOR_FIELDS = [
  { id: 'period', label: 'Period', re: /\b(period|length|lookback)\b/ },
  { id: 'source', label: 'Source', re: /\bsource\b/ },
  { id: 'maType', label: 'Type', re: /\b(ma )?type\b/ },
  { id: '__timeframe__', label: 'Timeframe', re: /\b(calculation )?time ?frame\b/ },
  { id: '__display__', label: 'Display', re: /\b(display|pane|panel)\b/ },
  { id: '__visibility__', label: 'Visibility', re: /\bvisib\w+\b/ },
  { id: 'lineStyle', label: 'Line style', re: /\b(line )?style\b|\bdash\w*\b|\bdott?ed\b/ },
  { id: 'lineWidth', label: 'Line width', re: /\b(line )?(width|thickness)\b|\bthick\w*\b|\bthin\w*\b/ },
  { id: 'offset', label: 'Offset', re: /\boffset\b/ },
]

// components/chart/indicatorCatalog — the catalog's own names, never a hand list. "EMA" is one of the Moving Average's
// types, so it is matched there and typed as the member said it.
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
let catalogCache = null
const optionLabel = (input, value) => {
  for (const o of input?.options || []) {
    const [v, l] = Array.isArray(o) ? o : [o?.value, o?.label]
    if (v === value) return String(l)
  }
  return null
}
// what a new instance is called before anyone changes it, for a definition named after its own inputs: a new Moving Average
// is "SMA 5", whichever kind the member asked for. Read from the definition's defaults (meta.nameFrom), never a hand list.
function freshInstance(r) {
  let def = null
  try { def = nativeRegistry.getDefinition(r.id) } catch { def = null }
  const from = def?.meta?.nameFrom
  const inputs = def?.inputs || r.inputs || []
  if (!from) return null
  const stem = inputs.find(i => i.key === from.stem)
  const length = inputs.find(i => i.key === (from.params || [])[0])
  const stemLabel = optionLabel(stem, stem?.default)
  if (!stemLabel || length?.default == null) return null
  return { stem: stemLabel, stemField: stem.label || 'Type', length: String(length.default), lengthField: length.label || 'Period' }
}
function catalog() {
  if (catalogCache) return catalogCache
  let rows = []
  try { rows = catalogRows(nativeRegistry).filter(r => !r.userDefined) } catch { rows = [] }
  const out = []
  for (const r of rows) {
    const say = r.shortName || r.name
    const fresh = freshInstance(r)
    for (const w of new Set([r.name, r.shortName].filter(Boolean))) out.push({ word: w, id: r.id, name: r.name, say, fresh })
    for (const i of r.inputs || []) {
      if (i?.type !== 'enum' || !/type/i.test(`${i.key} ${i.label}`)) continue
      for (const o of i.options || []) if (/^[A-Z]{2,5}$/.test(String(o.label))) out.push({ word: o.label, id: r.id, name: r.name, say: o.label, perLength: true, fresh })
    }
  }
  // the longest name first: "Stochastic RSI" is not "RSI"
  catalogCache = out.filter(x => String(x.word).length >= 2).sort((a, b) => String(b.word).length - String(a.word).length)
    .map(x => ({ ...x, re: new RegExp(`(^|[^a-z0-9])${escapeRe(String(x.word).toLowerCase())}($|[^a-z0-9])`) }))
  return catalogCache
}
// "EMA 20", "the 20 EMA", "20-day EMA", "EMA(20)": which one, of several of the same kind
function lengthIn(q, word) {
  const w = escapeRe(String(word).toLowerCase())
  const m = new RegExp(`(?:^|[^a-z0-9.])(\\d{1,3})(?:[- ](?:day|period|bar|week))?[- ]${w}(?:$|[^a-z0-9])`).exec(q)
    || new RegExp(`(?:^|[^a-z0-9])${w}[ (-]*(\\d{1,3})(?:$|[^0-9.])`).exec(q)
  return m ? m[1] : null
}
// what the add walkthrough may say once it is done: the instance that really went on, and what is left for the member to set.
// It never claims a type or a length that was not applied.
function afterAdding(hit, q) {
  const f = hit.fresh
  if (!f) return { addedSay: hit.say, addedRow: hit.say, addNext: ' Click it here to change its settings, colours and pane.' }
  const addedSay = `${f.stem} ${f.length}`
  const n = lengthIn(q, hit.word)
  const sets = [
    ...(hit.perLength && hit.say !== f.stem ? [`${f.stemField} to ${hit.say}`] : []),
    ...(n && n !== f.length ? [`${f.lengthField} to ${n}`] : []),
  ]
  return { addedSay, addedRow: addedSay, addNext: sets.length
    ? ` That’s what a new one starts as. Click it here, then set ${sets.join(' and ')}.`
    : ' Click it here to change its settings, colours and pane.' }
}
/** The one catalog indicator the words name → { id, name, say, label, labelName } | null. `say` is what to search for, and
 *  `label` is the one on the chart: "EMA 20" when the words give its length, so the EMA 9 above it is not taken for it. */
export function readIndicator(text) {
  const q = String(text || '').toLowerCase()
  // ⭐ RS split U1 — the gate is read at LOOKUP, not when the cache is built: a `meta.requiresServer`
  // definition the live server has not listed yet is skipped here, and found once the answer lands.
  const hit = catalog().find(c => c.re.test(q) && isCatalogRowOffered({ id: c.id }, nativeRegistry))
  if (!hit) return null
  const n = hit.perLength ? lengthIn(q, hit.word) : null
  const label = n ? `${hit.say} ${n}` : hit.say
  return { ...hit, label, labelName: n ? label : hit.name, ...afterAdding(hit, q) }
}

// widgets/registry.js: the product's own menu, and its own words for each widget
const ALSO = { chart: [], watchlist: [], optionsflow: ['flow', 'options'], tradeExchangeNews: ['trade exchange'], scatter: ['market map', 'scatter'], nhnl: ['new highs'], ai: ['ai search'] }
let widgetCache = null
export function widgetRows() {
  if (widgetCache) return widgetCache
  let ids = []; let labels = {}
  try { ids = menuGroups('workspace').flatMap(g => g.items); labels = labelMap('menu') } catch { ids = [] }
  widgetCache = ids.map(id => {
    const label = String(labels[id] || id)
    const words = [label, ...(ALSO[id] || [])].map(w => escapeRe(w.toLowerCase()))
    return { id, label, re: new RegExp(`(^|[^a-z0-9])(${words.join('|')})s?($|[^a-z0-9])`) }
  }).sort((a, b) => b.label.length - a.label.length)
  return widgetCache
}
export const readWidget = (text) => widgetRows().find(w => w.re.test(String(text || '').toLowerCase())) || null

// widget header controls (pages/charts/WidgetHeader.jsx)
export const HEADER_CONTROLS = [
  { id: 'float', label: 'Float', re: /\bfloat\w*\b|\bon top of\b|\boverlay a widget\b/, say: 'This button floats the widget on top of the others, for example over a chart. Its ⊞ docks it back.' },
  { id: 'popOut', label: 'Pop out', re: /\bpop\w*[- ]?out\b|\b(own|separate|new) window\b|\bother monitor\b|\bsecond (monitor|screen)\b/, say: 'This button opens the widget in its own window, which you can drag to another monitor.' },
  { id: 'addTab', label: 'Add a tab', re: /\btabs?\b/, say: 'This + adds a tab, so one slot can hold several widgets.' },
  { id: 'close', label: 'Close', re: /\b(close|remove|delete|get rid of)\b/, say: 'This × closes the widget.' },
]

// components/chart/chartSettingsDescriptors.js: the product's own table of what Chart Settings holds and where
const TABS = { 'price style': 'price', canvas: 'canvas', indicators: 'indicators', header: 'header', markers: 'markers' }
// where a row really sits, in the tab's own words, where the product's table says it differently (a controlled row's
// sentence names what the member has to do first)
const ONLY_ON = ' Its controls show beside the switch once the line is on.'
const SETTING_SPOT = {
  showPriceLabels: { where: 'Price labels' }, showMaLabels: { where: 'Moving average labels' },
  candleColorMode: { where: 'Color based on' }, 'candles.thinBars': { where: 'Bar thickness', note: ' This shows while the chart type is Bars or HLC.', alt: 'Thin bars shows on this tab only while the chart type is Bars or HLC. Choose Bars under Chart type first, and it appears here.' },
  'crosshair.style': { where: 'Crosshair', note: ' Click the Line color swatch below it: the panel has the line style.' },
  'crosshair.width': { where: 'Crosshair', note: ' Click the Line color swatch below it: the panel has the thickness.' },
  'header.colors.*': { where: 'Title color', note: ' Each info row’s colour is further down this tab.' },
  'markers.earnings': { where: 'Earnings' }, 'markers.splits': { where: 'Splits' }, 'markers.dividends': { where: 'Dividends' }, 'markers.news': { where: 'News' }, 'markers.desk': { where: 'Desk mentions' },
  'markers.ipo': { where: 'Event markers' }, 'markers.ipoColor': { where: 'Event markers' },
}
for (const [k, label] of [['high', 'Prev-day high'], ['low', 'Prev-day low'], ['close', 'Prev-day close']]) {
  SETTING_SPOT[`prevDayLevels.${k}.enabled`] = { where: label }
  for (const f of ['style', 'width', 'color']) SETTING_SPOT[`prevDayLevels.${k}.${f}`] = { where: label, note: ONLY_ON }
}
let settingCache = null
export function settingRows() {
  if (settingCache) return settingCache
  const rows = []
  for (const d of CHART_SETTING_DESCRIPTORS) {
    const m = /^Chart Settings → ([^→]+?)(?: → ([^→(]+?))?(?: \(.*\))?(?: → .*)?$/.exec(String(d.ui || ''))
    const tab = m && TABS[m[1].trim().toLowerCase()]
    if (!tab || tab === 'indicators' || d.agent === 'internal' || !d.label) continue
    const words = [d.label, ...(d.words || [])].map(w => escapeRe(String(w).toLowerCase()))
    // `alt`: what is true when the row is not on the tab (a row that shows only in some state says which); else it is further down
    rows.push({ id: d.id, label: d.label, tab, tabLabel: m[1].trim(), where: (m[2] || d.label).trim(), note: '', alt: `It’s on this tab: scroll down for ${d.label}.`, ...SETTING_SPOT[d.id], re: new RegExp(`(^|[^a-z0-9])(${words.join('|')})($|[^a-z0-9])`), len: Math.max(...words.map(w => w.length)) })
  }
  settingCache = rows.sort((a, b) => b.len - a.len)
  return settingCache
}
// ⭐ cov-4: a member's spelling (colour, grey) is the settings table's (color, gray)
const usSpelling = (s) => String(s || '').toLowerCase().replace(/\bcolour/g, 'color').replace(/\bgrey\b/g, 'gray')
// the label's own content words, each found in the request by its stem ("earnings beats" holds earnings + beat): the settings
// table names a row in words, and a request that holds every one of them is about that row, in any order
const SETTING_STOP = new Set(['the', 'a', 'an', 'in', 'on', 'of', 'to', 'and', 'or', 'its', 'legacy', 'off', 'not', 'yet', 'declared', 'honoured', 'shows'])
const contentWords = (label) => String(label).toLowerCase().replace(/\(.*?\)/g, ' ').split(/[^a-z0-9]+/).filter(w => w.length > 1 && !SETTING_STOP.has(w))
const holdsWord = (q, w) => new RegExp(`(^|[^a-z0-9])${escapeRe(w.length > 4 ? w.replace(/s$/, '') : w)}`).test(q)
export const readSetting = (text) => {
  const q = usSpelling(text)
  const exact = settingRows().find(r => r.re.test(q))
  // a longer label every word of which the request holds beats a shorter one it holds outright ("IPO marker color" over "IPO marker")
  const whole = settingRows().filter(r => { const ws = contentWords(r.label); return ws.length >= 2 && ws.every(w => holdsWord(q, w)) }).sort((a, b) => contentWords(b.label).length - contentWords(a.label).length)[0]
  if (whole && (!exact || contentWords(whole.label).length > contentWords(exact.label).length)) return whole
  return exact || null
}

export const SLOTS = {
  tool: { read: firstRow(DRAWING_TOOLS), rows: DRAWING_TOOLS },
  field: { read: firstRow(INDICATOR_FIELDS), rows: INDICATOR_FIELDS },
  grid: { read: firstRow(GRID_PRESETS), rows: GRID_PRESETS, fallback: GRID_2X2 },
  ind: { read: readIndicator },
  widget: { read: readWidget, get rows() { return widgetRows() } },
  ctl: { read: firstRow(HEADER_CONTROLS), rows: HEADER_CONTROLS, fallback: HEADER_CONTROLS[0] },
  setting: { read: readSetting, get rows() { return settingRows() } },
  ...ACTION_SLOTS,
}

/** What a feature's slots read from these words: { tool: row, … } (a slot the words did not fill is absent). */
export function slotValues(feature, text) {
  const out = {}
  for (const name of feature?.slots || []) {
    const s = SLOTS[name]
    const v = s?.read?.(text) || s?.fallback || null
    if (v) out[name] = v
  }
  return out
}

const fillStr = (s, v) => s.replace(/\{(\w+)\.(\w+)\}/g, (m, a, b) => (v[a]?.[b] != null ? String(v[a][b]) : m))
function fill(x, v) {
  if (typeof x === 'string') return fillStr(x, v)
  if (Array.isArray(x)) return x.map(y => fill(y, v))
  if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).map(([k, y]) => [k, fill(y, v)]))
  return x
}
/** A family's steps for these words: the steps that apply, with the words filled in. */
export function stepsFor(feature, text) {
  const v = slotValues(feature, text)
  // a family's rows walk different paths: { each: 'slot' } takes the chosen row's own steps (guide/actions.js)
  const steps = feature.steps.flatMap(s => (s.each ? v[s.each]?.steps || [] : [s]))
  return steps.filter(s => (!s.only || v[s.only]) && (!s.unless || !v[s.unless])).map(s => fill(s, v))
}
/** The feature as these words make it: its title names the one they asked about. */
export const titleFor = (feature, text) => {
  const v = slotValues(feature, text)
  const t = fill(feature.title, v)
  return /\{\w+\.\w+\}/.test(t) ? (feature.titleAny || t.replace(/\{\w+\.\w+\}/g, '').trim()) : t
}
