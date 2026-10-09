// ── CHART capabilities: the first feature registered with UCT Agent ─────────
//
// Everything the Agent knows about charts is in THIS file, through the public
// registration seam (agent/capabilities.js) — the same seam any future feature
// uses. Nothing in the orchestrator, planner, runtime or server names a chart
// action.
//
//   target kind 'chart'   state = { cs, tf, symbol }; commit = ChartWidget's own
//                         agent adapter (settings + tf in ONE onOptsChange, the
//                         ticker through the colour group, as a search pick does)
//   context 'charts'      the compact per-chart description the model sees
//   8 capabilities        non-indicator chart operations only
//
// ⛔ NO INDICATOR CAPABILITIES. Indicators (instances, panes, display targets,
// authoring) belong to Indicator Intelligence; nothing here writes
// `indicatorInstances`, `paneOrder`, `paneSizes` or display targets.
//
// ⛔ EVERY WRITE IS A KEY THE MANUAL UI ALREADY WRITES, in the shape the manual
// control writes it (ChartPane session toggles, ChartSettingsModal canvas and
// candle pickers, the legend's Volume remove, chartThemes.applyThemeToOneChart).
// No new settings key, so the chartDefaults allow-list is untouched.

import { registerCapability, registerTargetKind, registerContextProvider } from '../capabilities'
import { CHART_THEMES, CHART_THEME_BY_ID, applyThemeToOneChart } from '../../components/chart/chartThemes'
import { primaryChartTypeFor } from '../../components/chart/engine/sourceCapability'
import { canonicalFamily, canonicalProduct, canonicalSourceCapability } from '../../hooks/useMarketIndicators'
import { isEconomicId } from '../../components/chart/engine/econMark'
import { getExtSessionCached } from '../../utils/extSession'
import { unknownSymbols } from '../agentClient'
import { mergeChartSettings, CHART_TYPE_OPTIONS } from '../../components/chart/chartDefaults'
import { NATIVE_TFS, tfLabel as productTfLabel } from '../../components/chart/timeframes'
import { ELIGIBLE_SETTINGS, OWNED_TOP_KEYS, settingDescriptor, coerceSettingValue, settingUnavailable, withSetting, settingValue } from '../../components/chart/chartSettingsDescriptors'
import { CHART_DEFAULTS } from '../../components/chart/chartDefaults'
import { makeTfCode, isValidTf, tfLabel as tfShort } from '../../components/chart/timeframes'
import { pickComparisonColor } from '../../components/chart/comparisonUtils'

// The chart types and the timeframes UCT charts natively are the PRODUCT's lists
// (chartDefaults.CHART_TYPE_OPTIONS, timeframes.NATIVE_TFS) — imported, never copied, so a new
// type or timeframe reaches the Agent's enums the day it ships (agentContracts.test.js rails it).
// Only the Agent's receipt wording lives here; a type or timeframe without a word falls back to
// the product's own label.
export const CHART_TYPE_IDS = CHART_TYPE_OPTIONS.map(([id]) => id)
export const CHART_TIMEFRAMES = [...NATIVE_TFS]
const TYPE_WORDING = { hollow: 'Hollow Candles', hlc: 'HLC Bars' }
const TYPE_LABEL = Object.fromEntries(CHART_TYPE_OPTIONS.map(([id, label]) => [id, TYPE_WORDING[id] || label]))
const TF_WORDING = { 1: '1 minute', 5: '5 minutes', 15: '15 minutes', 30: '30 minutes', 60: '1 hour', D: 'Daily', W: 'Weekly', M: 'Monthly' }
const TF_LABEL = Object.fromEntries(CHART_TIMEFRAMES.map(tf => [tf, TF_WORDING[tf] || productTfLabel(tf)]))
const INTRADAY = new Set(CHART_TIMEFRAMES.filter(tf => !['D', 'W', 'M'].includes(tf)))
export const tfLabel = (tf) => TF_LABEL[tf] || String(tf)
export const chartTypeLabel = (t) => TYPE_LABEL[t] || String(t)
const isIntraday = (tf) => INTRADAY.has(String(tf))

// ── colors ── hex from the model; a few plain names members say; nothing guessed.
const NAMED = {
  white: '#ffffff', black: '#000000', cream: '#f3efe4', ivory: '#fffff0', beige: '#f5f5dc',
  navy: '#0b1f3a', 'dark blue': '#0d1b2a', blue: '#2962ff', green: '#2faf68', red: '#df4646',
  gray: '#808080', grey: '#808080', 'dark gray': '#1e1e1e', 'dark grey': '#1e1e1e',
  'light gray': '#e5e5e5', 'light grey': '#e5e5e5', charcoal: '#17181a', teal: '#26a69a',
  orange: '#f59e0b', yellow: '#facc15', purple: '#7c3aed', pink: '#ec4899',
}
export function normalizeColor(raw) {
  if (typeof raw !== 'string') return null
  const s = raw.trim().toLowerCase()
  if (NAMED[s]) return NAMED[s]
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/.exec(s)
  if (!m) return null
  const h = m[1].length === 3 ? m[1].split('').map(c => c + c).join('') : m[1]
  return `#${h}`
}

// ── symbol capability: parity with StockChart's own clamp, so a receipt never
// claims a chart type the canvas will silently override ──
function capabilityFor(sym) {
  // No symbol yet = a chart created earlier in this request: unknown, not
  // economic (the real chart is re-validated against its real symbol at commit).
  if (!sym) return { econ: false, cap: null }
  if (isEconomicId(sym)) return { econ: true, cap: null }
  const fam = canonicalFamily(sym)
  const cap = canonicalProduct(sym)
    ? canonicalSourceCapability(sym, false)
    : fam === 'unknown' ? null : canonicalSourceCapability(sym, fam === 'security' || fam === 'volatility')
  return { econ: false, cap }
}
function hasIntradayBars(sym) {
  if (!sym) return true
  if (isEconomicId(sym)) return false
  const fam = canonicalFamily(sym)
  return fam === 'unknown' || fam === 'security' || fam === 'volatility'
}

const set = (cs, patch) => ({ ...cs, ...patch, preset: 'custom' })
const SCALE_LABEL = { linear: 'Linear', log: 'Logarithmic', percent: 'Percent' }
// Same precedence as StockChart's effectiveScale: percent before log.
const scaleOf = (cs) => (cs?.percentScale ? 'percent' : (cs?.logScale ? 'log' : 'linear'))
export const volState = (cs) => (cs?.volume?.removed === true ? 'removed' : (cs?.volume?.visible === false ? 'hidden' : 'visible'))
export const sessionOf = (cs, tf) => (isIntraday(tf)
  ? (cs?.extendedHoursShading === false ? 'regular' : 'extended')
  : (cs?.sessionView === 'extended' ? 'extended' : 'regular'))
// ChartPane's `extEnabled`: the D/W/M Extended button is live only in the pre/post window.
export const extWindowOpen = () => { const s = getExtSessionCached()?.session; return s === 'pre' || s === 'post' }
const sameJson = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

// ── chart.setSetting helpers (generated from the product's descriptor table) ──
const settingWord = (d, v) => (d.type === 'bool' ? (v ? 'on' : 'off')
  : d.labels ? (Object.entries(d.labels).find(([, x]) => x === v)?.[0] ?? String(v)) : String(v))
const SETTING_HINTS = (() => {
  // Settings that share one option list are written once ("prevDayLevels.high|low|close.style: …").
  const groups = new Map()
  for (const d of ELIGIBLE_SETTINGS.filter(x => x.type === 'enum')) {
    const key = d.labels ? Object.keys(d.labels).join('|') : d.options.join('|')
    groups.set(key, [...(groups.get(key) || []), d.id])
  }
  const short = (ids) => {
    if (ids.length === 1) return ids[0]
    const parts = ids.map(id => id.split('.'))
    const same = parts.every(p => p.length === parts[0].length && p.every((x, i) => i === 1 || x === parts[0][i]))
    return same ? parts[0].map((x, i) => (i === 1 ? ids.map(id => id.split('.')[1]).join('|') : x)).join('.') : ids.join(', ')
  }
  const enums = [...groups.entries()].map(([opts, ids]) => `${short(ids)}: ${opts}`)
  return 'value = true/false for on/off settings (crosshair.mode and header.legendMode also take true/false); '
    + 'a hex color (#2962ff) for color settings. '
    + `Allowed values — ${enums.join('; ')}. `
    + 'Only these settings: for any other chart setting (watermark opacity, volume style…) do NOT plan an op — '
    + 'say it is not Agent-enabled yet and where it lives in Chart Settings.'
})()
// "turn off the grid", "hide the watermark", "crosshair off", "show swing labels"
const SETTING_WORDS = new Map(ELIGIBLE_SETTINGS.flatMap(d => (d.words || []).map(w => [w, d])))
function fastSetting(text) {
  const t = String(text || '').trim().replace(/[.!]$/, '').replace(/ on (?:this|the|my) chart$/, '')
  const pats = [
    [/^(?:turn|switch) (on|off) (?:the )?(.+)$/, 1, 2], [/^(?:turn|switch) (?:the )?(.+?) (on|off)$/, 2, 1],
    [/^(show|hide|enable|disable) (?:the )?(.+)$/, 1, 2], [/^(?:the )?(.+?) (on|off)$/, 2, 1],
  ]
  for (const [re, vi, wi] of pats) {
    const m = re.exec(t)
    if (!m) continue
    const d = SETTING_WORDS.get(m[wi])
    if (!d) continue
    const on = ['on', 'show', 'enable'].includes(m[vi])
    return { setting: d.id, value: d.type === 'bool' ? on : d.boolMap[String(on)] }
  }
  return null
}

// ── the date view (chart.goToDate) ──
const DAY_MS = 86400000
// Did the view arrive? The Time Navigator puts the LAST BAR ON OR BEFORE the date at the right
// edge (clamped to the first bar before inception, and to the last bar for a future date).
export function viewAt(meta, target) {
  if (!meta || !Number.isFinite(meta.rightMs) || meta.loading) return false
  if (Number.isFinite(meta.lastMs) && target >= meta.lastMs) return meta.rightMs === meta.lastMs
  if (Number.isFinite(meta.firstMs) && target <= meta.firstMs && meta.fullyLoaded) return meta.rightMs === meta.firstMs
  return meta.rightMs <= target + DAY_MS && target - meta.rightMs <= 45 * DAY_MS
}
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/
export function dateMs(s) {
  const m = ISO_DAY.exec(String(s || '').trim())
  if (!m) return null
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3])
  const d = new Date(ms)
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? ms : null
}
const fmtDay = (ms) => new Date(ms).toISOString().slice(0, 10)

// ── saved chart templates (the member's own, pref chart_templates) ──
let TEMPLATES = []
export const templatesNow = () => TEMPLATES
function readTemplates(host) {
  const raw = host?.prefs?.read?.()?.chart_templates
  try { const a = typeof raw === 'string' ? JSON.parse(raw) : raw; TEMPLATES = Array.isArray(a) ? a.filter(t => t && t.name && t.settings) : [] } catch { TEMPLATES = [] }
  return TEMPLATES
}
const findTemplate = (name) => {
  const n = String(name || '').trim().toLowerCase()
  const hits = TEMPLATES.filter(t => String(t.name).trim().toLowerCase() === n)
  return hits.length === 1 ? hits[0] : null
}

// ── target kind ─────────────────────────────────────────────────────────────
// `host.charts` is the workspace binding (agent/host.js) over every mounted
// ChartWidget's agent adapter.
export const chartKind = {
  name: 'chart',
  list: (host) => host?.charts?.list() || [],
  read: (host, ref) => host?.charts?.read(ref) || null,
  stateOf: (snap) => ({ cs: snap.cs, tf: snap.tf, symbol: snap.symbol, goto: null }),
  patch(before, after) {
    const p = {}
    if (after.cs !== before.cs) p.settings = after.cs
    if (after.tf !== before.tf) p.tf = after.tf
    if (after.symbol !== before.symbol) p.symbol = after.symbol
    if (after.goto != null) p.goto = after.goto
    return Object.keys(p).length ? p : null
  },
  // Settings / timeframe / ticker in ONE write through the widget; a date jump (a VIEW) through
  // the Time Navigator's own goToDate, then wait for the view to arrive (a jump past the loaded
  // history loads it first) — the receipt only claims what the chart then shows.
  async commit(host, ref, patch) {
    const { goto, ...rest } = patch
    let ok = true
    if (Object.keys(rest).length) ok = host.charts.commit(ref, rest)
    if (goto != null && ok) {
      if (!host.charts.goTo?.(ref, goto)) return false
      const t0 = Date.now()
      while (Date.now() - t0 < 10000) {
        if (viewAt(host.charts.read(ref)?.view, goto)) break
        await new Promise(r => setTimeout(r, 150))
      }
    }
    return ok
  },
  landed(snap, patch) {
    if (!snap) return false
    if ('settings' in patch && !sameJson(snap.stored, patch.settings)) return false
    if ('tf' in patch && snap.tf !== patch.tf) return false
    if ('symbol' in patch && snap.symbol !== patch.symbol) return false
    if ('goto' in patch && !viewAt(snap.view, patch.goto)) return false
    return true
  },
  undoPatch(item) {
    const p = {}
    if ('settings' in item.patch) p.settings = item.before.stored ?? null
    if ('tf' in item.patch) p.tf = item.before.tf
    if ('symbol' in item.patch) p.symbol = item.before.symbol
    // Undo a date jump = jump back to where the right edge was.
    if ('goto' in item.patch) { if (item.before.view?.rightMs == null) return null; p.goto = item.before.view.rightMs }
    return p
  },
  fingerprint: (snap) => JSON.stringify([snap.stored ?? null, snap.tf, snap.symbol]),
  // A chart that does not exist yet (created earlier in the same request): the
  // product's defaults for a new chart, used ONLY to validate the plan before the
  // first write. The runtime re-plans against the real chart once it exists.
  virtual: ({ alias, n }) => ({
    ref: alias, label: `New chart ${n}`, position: null, symbol: null, tf: 'D',
    cs: mergeChartSettings(null), stored: null, linkedCount: 0, virtual: true,
  }),
  // A new chart given its OWN symbol must be created unlinked, or the symbol
  // would retarget every existing widget in the default link group.
  // …and when its ticker (and timeframe) are already known it is BORN on them
  // (handleAddWidget's unlinkedSymbol) — no default symbol is ever loaded first.
  createFlags: (ops) => {
    const sym = [...ops].reverse().find(o => o.action === 'chart.setSymbol')?.args?.symbol
    if (!sym) return {}
    const tf = [...ops].reverse().find(o => o.action === 'chart.setTimeframe')?.args?.timeframe || null
    // `complete`: the ticker and timeframe ARE everything asked of this chart, so once
    // it is born on them there is nothing left to commit through the mounted widget.
    const complete = ops.every(o => o.action === 'chart.setSymbol' || o.action === 'chart.setTimeframe')
    return { unlink: true, init: { symbol: String(sym).trim().toUpperCase(), tf }, complete }
  },
  // A chart born complete is verified from the workspace's own state (layout +
  // link-group ticker) instead of waiting for it to mount: mounting waits on market
  // data (PANEL_MOUNT_CAP), which says nothing about whether the configuration landed.
  verifyBorn: (host, ref, born) => {
    const c = host?.widgets?.configOf?.(ref)
    return !!c && c.color === 'N' && c.symbol === born.symbol && (!born.tf || c.tf === born.tf)
  },
}

// A whole-look write (template, restore defaults) with every indicator-owned top-level key carried
// over from the chart as it is now — present keeps its value, absent stays absent (door SEVEN: a bulk
// write must never stamp indicatorInstances over what the member had).
export function keepOwned(next, prev) {
  const out = JSON.parse(JSON.stringify(next))
  for (const k of OWNED_TOP_KEYS) {
    if (prev && Object.prototype.hasOwnProperty.call(prev, k)) out[k] = JSON.parse(JSON.stringify(prev[k]))
    else delete out[k]
  }
  return out
}

export function describeChart(snap, shortRef) {
  const cs = snap.cs || {}
  return {
    ref: shortRef, label: snap.label, position: snap.position || null,
    symbol: snap.symbol, timeframe: snap.tf, timeframeLabel: tfLabel(snap.tf),
    chartType: cs.chartType || 'candles', volume: volState(cs),
    background: cs.bgMode === 'gradient' ? 'gradient' : (cs.background || null),
    upColor: cs.candles?.upColor || null, downColor: cs.candles?.downColor || null,
    extendedHours: sessionOf(cs, snap.tf) === 'extended',
    scale: scaleOf(cs),
    linkedWidgets: snap.linkedCount || 0,
  }
}

const onCharts = (ctx) => ctx.surface === 'charts'

// ── fast-path phrases (agent/fastPath.js asks each capability) ──
const TF_WORDS = [
  [/^(1|one)\s*(m|min|mins|minute|minutes)$/, '1'],
  [/^(5|five)\s*(m|min|mins|minute|minutes)$/, '5'],
  [/^(15|fifteen)\s*(m|min|mins|minute|minutes)$/, '15'],
  [/^(30|thirty)\s*(m|min|mins|minute|minutes)$/, '30'],
  [/^(60\s*(m|min|mins|minute|minutes)|1\s*(h|hr|hour)|one hour|hourly)$/, '60'],
  [/^(d|1d|day|daily)$/, 'D'],
  [/^(w|1w|week|weekly)$/, 'W'],
  [/^(mo|1mo|month|monthly)$/, 'M'],
]
const TYPE_WORDS = [
  [/^(candles?|candlesticks?|candlestick chart|candle chart)$/, 'candles'],
  [/^(hollow|hollow candles?|hollow candlesticks?)$/, 'hollow'],
  [/^(bars?|bar chart|ohlc|ohlc bars?)$/, 'bars'],
  [/^(hlc|hlc bars?)$/, 'hlc'],
  [/^(line|line chart)$/, 'line'],
  [/^(area|area chart)$/, 'area'],
]
const firstMatch = (table, s) => { for (const [re, v] of table) if (re.test(s)) return v; return null }

// ── capabilities ────────────────────────────────────────────────────────────
const CAPABILITIES = [
  {
    name: 'chart.setType',
    summary: 'Change how price is drawn on one chart.',
    args: { type: 'object', properties: { type: { type: 'string', enum: CHART_TYPE_IDS } }, required: ['type'], additionalProperties: false },
    check(st, { type }) {
      if (!TYPE_LABEL[type]) return `“${type}” is not a chart type UCT has.`
      const { econ, cap } = capabilityFor(st.symbol)
      if (econ) return `${st.symbol} is an economic series; it always draws in its own style.`
      if (cap && primaryChartTypeFor(type, cap) !== type) return `${st.symbol} can't be drawn as ${chartTypeLabel(type)} — it has no open/high/low data.`
      return null
    },
    fast: ({ core }) => { const type = firstMatch(TYPE_WORDS, core); return type ? { type } : null },
    apply: (st, { type }) => (st.cs.chartType === type ? st : { ...st, cs: set(st.cs, { chartType: type }) }),
    describe: (b, a) => (b.cs.chartType === a.cs.chartType ? null : `Changed chart to ${chartTypeLabel(a.cs.chartType)}`),
    noop: (b, a) => `Already ${chartTypeLabel(a.cs.chartType)}`,
  },
  {
    name: 'chart.setTimeframe',
    summary: "Change one chart's timeframe.",
    hints: 'Codes: 1, 5, 15, 30, 60 are minutes; D daily, W weekly, M monthly.',
    args: { type: 'object', properties: { timeframe: { type: 'string', enum: CHART_TIMEFRAMES } }, required: ['timeframe'], additionalProperties: false },
    check(st, { timeframe }) {
      if (!TF_LABEL[timeframe]) return `“${timeframe}” is not a timeframe UCT charts.`
      if (isIntraday(timeframe) && !hasIntradayBars(st.symbol)) return `${st.symbol} has daily, weekly and monthly data only.`
      return null
    },
    fast: ({ core }) => { const timeframe = firstMatch(TF_WORDS, core); return timeframe ? { timeframe } : null },
    apply: (st, { timeframe }) => (st.tf === timeframe ? st : { ...st, tf: timeframe }),
    describe: (b, a) => (b.tf === a.tf ? null : `Switched timeframe to ${tfLabel(a.tf)}`),
    noop: (b, a) => `Already ${tfLabel(a.tf)}`,
  },
  {
    name: 'chart.setSymbol',
    summary: 'Show a different ticker on one chart. Widgets linked to the same color group follow, exactly as a manual symbol search does.',
    args: { type: 'object', properties: { symbol: { type: 'string' } }, required: ['symbol'], additionalProperties: false },
    // "$NVDA", or chart|open|show|load|pull up + an UPPERCASE ticker in the RAW
    // text (so "show volume" can never read as the ticker VOLUME).
    fast: ({ raw }) => {
      // An explicit "symbol/ticker to X" may be lowercase: the noun removes the
      // ambiguity that keeps "show volume" from ever reading as a ticker.
      const m = /^\$([A-Za-z][A-Za-z0-9.]{0,9})$/.exec(raw)
        || /^(?:chart|open|show|load|pull up|put|switch to|go to)\s+\$?([A-Z][A-Z0-9.]{0,9})$/.exec(raw)
        || /^(?:change|switch|set)\s+(?:the\s+)?(?:symbol|ticker)\s+to\s+\$?([A-Za-z][A-Za-z0-9.]{0,9})$/i.exec(raw)
      return m ? { symbol: m[1].toUpperCase() } : null
    },
    // Async lookup BEFORE planning: an unknown ticker is refused, never charted blank.
    // Symbols that came from UCT itself (`trusted`: a screen's results, a saved
    // list's rows) are not looked up again.
    async prepare(ops) {
      const syms = ops.filter(o => !o.trusted).map(o => String(o.args?.symbol || '').trim().toUpperCase()).filter(Boolean)
      return syms.length ? { unknownSymbols: await unknownSymbols(syms) } : {}
    },
    check(st, { symbol }, env) {
      const s = String(symbol || '').trim().toUpperCase()
      if (!s) return 'Which ticker?'
      if (!/^[A-Z0-9.$:^_\-/]{1,24}$/.test(s)) return `“${symbol}” doesn't look like a ticker.`
      if (env?.unknownSymbols?.has(s)) return `UCT has no symbol “${s}”.`
      return null
    },
    apply(st, { symbol }) {
      const s = String(symbol).trim().toUpperCase()
      if (st.symbol === s) return st
      // Parity with ChartWidget.handleSymbolChange: a new ticker abandons the
      // "group only" compare view and its overlays.
      const cs = st.cs?.compareHideBase ? set(st.cs, { compareHideBase: false, comparisonSymbols: [] }) : st.cs
      return { ...st, cs, symbol: s }
    },
    describe(b, a, _args, env) {
      if (b.symbol === a.symbol) return null
      const n = env?.target?.linkedCount || 0
      return n > 0 ? `Changed symbol to ${a.symbol} (and ${n} linked widget${n === 1 ? '' : 's'})` : `Changed symbol to ${a.symbol}`
    },
    noop: (b, a) => `Already showing ${a.symbol}`,
  },
  {
    name: 'chart.setSession',
    summary: 'Show or hide pre/post-market (extended hours) on one chart.',
    args: { type: 'object', properties: { mode: { type: 'string', enum: ['regular', 'extended'] } }, required: ['mode'], additionalProperties: false },
    fast: ({ lower, core }) => {
      for (const s of [lower, core]) {
        if (/^(show |turn on |include )?(extended hours|extended|ext hours|extended trading|pre ?\/ ?post)( on)?$/.test(s)) return { mode: 'extended' }
        if (/^(hide extended hours|extended hours off|ext hours off|regular hours( only)?|regular session|rth( only)?)$/.test(s)) return { mode: 'regular' }
      }
      return null
    },
    // The SAME eligibility as the manual toggle (ChartPane → ChartIdentityRow): economic-data
    // charts have no session control at all, and on D/W/M "Include pre/post-market" is DISABLED
    // outside the pre/post window (ChartPane's `extEnabled`, from getExtSessionCached()). The
    // Agent refuses exactly where the button is disabled, instead of writing a state the member
    // could not have chosen.
    check(st, { mode }) {
      if (mode !== 'regular' && mode !== 'extended') return `“${mode}” is not a session.`
      if (st.symbol && isEconomicId(st.symbol)) return 'Economic-data charts have no regular/extended session setting.'
      if (mode === 'extended' && !isIntraday(st.tf) && sessionOf(st.cs, st.tf) !== 'extended' && !extWindowOpen()) {
        return 'On daily, weekly and monthly charts “Include pre/post-market” is only available during pre-market and post-market — the same as the chart’s own toggle. Try again then, or switch this chart to an intraday timeframe.'
      }
      return null
    },
    apply(st, { mode }) {
      if (sessionOf(st.cs, st.tf) === mode) return st
      // The key the manual toggle for THIS timeframe writes: ChartPane.setExtHours
      // on intraday, ChartPane.setSessionView on D/W/M.
      return { ...st, cs: set(st.cs, isIntraday(st.tf) ? { extendedHoursShading: mode === 'extended' } : { sessionView: mode }) }
    },
    describe(b, a) {
      if (sessionOf(b.cs, a.tf) === sessionOf(a.cs, a.tf) && b.cs === a.cs) return null
      return sessionOf(a.cs, a.tf) === 'extended' ? 'Showing extended hours' : 'Showing regular hours only'
    },
    noop: (b, a) => (sessionOf(a.cs, a.tf) === 'extended' ? 'Already showing extended hours' : 'Already regular hours only'),
  },
  {
    name: 'chart.setScale',
    summary: "Set one chart's price scale: linear (arithmetic), logarithmic, or percent.",
    args: { type: 'object', properties: { scale: { type: 'string', enum: ['linear', 'log', 'percent'] } }, required: ['scale'], additionalProperties: false },
    fast: ({ core }) => {
      if (/^(log|log scale|logarithmic|logarithmic scale)$/.test(core)) return { scale: 'log' }
      if (/^(linear|linear scale|arithmetic|arithmetic scale|arith)$/.test(core)) return { scale: 'linear' }
      if (/^(percent scale|percentage scale|% scale)$/.test(core)) return { scale: 'percent' }
      return null
    },
    check(st, { scale }) {
      if (!SCALE_LABEL[scale]) return `“${scale}” is not a price scale.`
      // StockChart forces percent while any "new scale" comparison is on
      // (compareForcesPct) — a receipt must never claim a scale the chart won't show.
      const forcing = (st.cs.comparisonSymbols || []).some(c => c && c.enabled && c.sym && (c.scaleMode || 'new') !== 'same')
      if (forcing && scale !== 'percent') return 'Compare overlays keep this chart on a percent scale — remove them first.'
      return null
    },
    // The exact keys StockChart.setScale (the A/L/% toggle) persists.
    apply: (st, { scale }) => (scaleOf(st.cs) === scale ? st
      : { ...st, cs: set(st.cs, { logScale: scale === 'log', percentScale: scale === 'percent' }) }),
    describe: (b, a) => (scaleOf(b.cs) === scaleOf(a.cs) ? null : `Changed scale to ${SCALE_LABEL[scaleOf(a.cs)]}`),
    noop: (b, a) => `Already on a ${SCALE_LABEL[scaleOf(a.cs)].toLowerCase()} scale`,
  },
  {
    name: 'chart.applyTheme',
    summary: "Apply one of UCT's built-in chart color themes (canvas, candles, grid, text) to one chart.",
    args: { type: 'object', properties: { theme: { type: 'string', enum: CHART_THEMES.map(t => t.id) } }, required: ['theme'], additionalProperties: false },
    // "cream theme" / "apply the nord theme" — only a real chart-theme id or name.
    fast: ({ core }) => {
      const m = /^(?:apply\s+)?(?:the\s+)?(.+?)\s+(?:chart\s+)?theme$/.exec(core)
      if (!m) return null
      const want = m[1].trim().toLowerCase()
      const hit = CHART_THEMES.find(t => t.id === want || t.name.toLowerCase() === want)
      return hit ? { theme: hit.id } : null
    },
    check: (st, { theme }) => (CHART_THEME_BY_ID[theme] ? null : `UCT has no chart theme “${theme}”.`),
    // The SAME function Chart Settings -> theme gallery -> 'this chart' calls (app-mirrored themes use the app surface).
    apply: (st, { theme }) => ({ ...st, cs: applyThemeToOneChart(st.cs, CHART_THEME_BY_ID[theme]) }),
    describe: (b, a, { theme }) => `Applied the ${CHART_THEME_BY_ID[theme]?.name || theme} chart theme`,
  },
  {
    name: 'chart.setBackground',
    summary: "Set one chart's background to a single solid color.",
    hints: 'Pass a hex color like #f3efe4; translate plain color names to hex.',
    args: { type: 'object', properties: { color: { type: 'string' } }, required: ['color'], additionalProperties: false },
    // "background to black" / "change the background to #f3efe4" — only a color
    // that normalizes; anything else goes to the model.
    fast: ({ core }) => {
      const m = /^(?:the\s+)?(?:background|bg|background color|canvas)\s+(?:to\s+|=\s*)?(.+)$/.exec(core)
      return m && normalizeColor(m[1]) ? { color: m[1].trim() } : null
    },
    check: (st, { color }) => (normalizeColor(color) ? null : `“${color}” isn't a color I can set — use a hex value like #f3efe4.`),
    apply(st, { color }) {
      const c = normalizeColor(color)
      if (st.cs.background === c && st.cs.bgMode !== 'gradient') return st
      return { ...st, cs: set(st.cs, { background: c, bgMode: 'solid' }) }
    },
    describe: (b, a) => (b.cs.background === a.cs.background && b.cs.bgMode === a.cs.bgMode ? null : `Changed background to ${a.cs.background}`),
    noop: (b, a) => `Background is already ${a.cs.background}`,
  },
  {
    name: 'chart.setCandleColors',
    summary: "Set one chart's up and/or down candle colors.",
    hints: 'Hex colors; pass null for a side that should not change.',
    args: { type: 'object', properties: { up: { type: ['string', 'null'] }, down: { type: ['string', 'null'] } }, required: ['up', 'down'], additionalProperties: false },
    check(st, { up, down }) {
      if (up == null && down == null) return 'Which candle color?'
      if (up != null && !normalizeColor(up)) return `“${up}” isn't a color I can set.`
      if (down != null && !normalizeColor(down)) return `“${down}” isn't a color I can set.`
      return null
    },
    apply(st, { up, down }) {
      const c = { ...(st.cs.candles || {}) }
      const u = up != null ? normalizeColor(up) : null
      const d = down != null ? normalizeColor(down) : null
      if ((!u || c.upColor === u) && (!d || c.downColor === d)) return st
      if (u) Object.assign(c, { upColor: u, upBorder: u, upWick: u, oneColor: u })
      if (d) Object.assign(c, { downColor: d, downBorder: d, downWick: d })
      return { ...st, cs: set(st.cs, { candles: c }) }
    },
    describe(b, a) {
      const out = []
      if (b.cs.candles?.upColor !== a.cs.candles?.upColor) out.push(`up candles to ${a.cs.candles.upColor}`)
      if (b.cs.candles?.downColor !== a.cs.candles?.downColor) out.push(`down candles to ${a.cs.candles.downColor}`)
      return out.length ? `Changed ${out.join(' and ')}` : null
    },
    noop: () => 'Candle colors already set',
  },
  {
    name: 'volume.setState',
    summary: "Show, hide, or remove one chart's built-in Volume pane.",
    hints: '"hide volume" is hidden (stays in the legend); "remove volume" is removed (off the chart).',
    args: { type: 'object', properties: { state: { type: 'string', enum: ['visible', 'hidden', 'removed'] } }, required: ['state'], additionalProperties: false },
    fast: ({ lower }) => {
      const m = /^(hide|show|remove|delete|turn off|turn on|unhide)\s+(the\s+)?volume( pane)?$/.exec(lower) || /^volume\s+(off|on)$/.exec(lower)
      if (!m) return null
      const v = m[1]
      return { state: v === 'hide' || v === 'turn off' || v === 'off' ? 'hidden' : (v === 'remove' || v === 'delete') ? 'removed' : 'visible' }
    },
    check: (st, { state }) => (['visible', 'hidden', 'removed'].includes(state) ? null : `“${state}” is not a Volume state.`),
    apply(st, { state }) {
      if (volState(st.cs) === state) return st
      const v = { ...(st.cs.volume || {}) }
      if (state === 'visible') { v.visible = true; v.removed = false }
      else if (state === 'hidden') { v.visible = false; v.removed = false }
      else v.removed = true
      return { ...st, cs: set(st.cs, { volume: v }) }
    },
    describe(b, a) {
      const now = volState(a.cs)
      if (volState(b.cs) === now) return null
      return now === 'visible' ? 'Showed Volume' : now === 'hidden' ? 'Hid Volume' : 'Removed Volume'
    },
    noop: (b, a) => ({ visible: 'Volume is already showing', hidden: 'Volume is already hidden', removed: 'Volume is already removed' })[volState(a.cs)],
  },  {
    // ── chart.setSetting: ONE capability over the product's own descriptor table ──
    // Only rows classified `agent: 'eligible'` in components/chart/chartSettingsDescriptors.js
    // are offered (the id enum is generated from that table); the value is typed and validated
    // by the descriptor; the write is the descriptor's `withSetting` — the same shape Chart
    // Settings' own setters produce — committed through the chart's normal onOptsChange path,
    // read back, and undoable like every other chart change. A UI prerequisite (thin bars only
    // on Bars/HLC) refuses exactly where the dialog hides the control.
    name: 'chart.setSetting',
    summary: 'Change one chart display setting from UCT\'s approved list (grid and its color, crosshair and its color, scale text size/color, legend, watermark and its size/weight/lines, labels, event markers, swing labels and their options, prev-day lines and their style/width/color, countdown, title, color mode, thin bars, inverted scale).',
    hints: SETTING_HINTS,
    args: { type: 'object', properties: {
      setting: { type: 'string', enum: ELIGIBLE_SETTINGS.map(d => d.id) },
      value: { type: ['string', 'number', 'boolean'] },
    }, required: ['setting', 'value'], additionalProperties: false },
    fast: ({ lower, core }) => fastSetting(lower) || fastSetting(core),
    check(st, { setting, value }) {
      const d = settingDescriptor(setting)
      if (!d || d.agent !== 'eligible') return `“${setting}” isn't a chart setting UCT Agent can change.`
      const v = coerceSettingValue(d, d.type === 'color' ? (normalizeColor(value) || value) : value)
      if (!v.ok) return `${d.label}: ${v.why}.`
      return settingUnavailable(d, st.cs)
    },
    apply(st, { setting, value }) {
      const d = settingDescriptor(setting)
      const v = coerceSettingValue(d, d.type === 'color' ? (normalizeColor(value) || value) : value).value
      if (sameJson(settingValue(st.cs, d), v)) return st
      return { ...st, cs: withSetting(st.cs, d, v) }
    },
    describe(b, a, { setting }) {
      const d = settingDescriptor(setting)
      const now = settingValue(a.cs, d)
      if (sameJson(settingValue(b.cs, d), now)) return null
      return `${d.label}: ${settingWord(d, now)}`
    },
    noop: (b, a, { setting } = {}) => {
      const d = settingDescriptor(setting)
      return d ? `${d.label} is already ${settingWord(d, settingValue(a.cs, d))}` : 'Already set'
    },
  },
  {
    // ── chart.applyTemplate: the right-click "Chart template" flyout's own apply ──
    // (ChartWidget.applyChartTemplate → paneRef.applySettings({...t.settings, preset:'custom'})),
    // EXCEPT the indicator-owned keys (OWNED_TOP_KEYS), which stay exactly as the chart has them.
    // A whole-look change, so it is always proposed.
    name: 'chart.applyTemplate',
    risk: 'confirm',
    summary: "Apply one of the member's saved chart templates' LOOK to ONE chart (right-click → Chart template). The chart's indicators are kept exactly as they are — UCT Agent never changes indicators.",
    hints: 'template = a name from chartTemplates, exactly. For several charts ("all my charts"), one op per chart.',
    args: { type: 'object', properties: { template: { type: 'string' } }, required: ['template'], additionalProperties: false },
    check: (st, { template }) => (findTemplate(template) ? null
      : templatesNow().length ? `You have no chart template named “${template}” (you have: ${templatesNow().map(t => t.name).slice(0, 8).join(', ')}).` : 'You have no saved chart templates yet — save one in Chart Settings → Templates.'),
    apply: (st, { template }) => ({ ...st, cs: keepOwned({ ...findTemplate(template).settings, preset: 'custom' }, st.cs) }),
    describe: (b, a, { template }) => (sameJson(b.cs, a.cs) ? null : `Applied the look of your chart template “${findTemplate(template)?.name || template}” (your indicators are unchanged)`),
    noop: () => 'The chart already looks exactly like that template',
  },
  {
    // ── chart.resetDefaults: Chart Settings' own "Restore defaults" (a clone of the LIVE
    // CHART_DEFAULTS), EXCEPT the indicator-owned keys, which stay exactly as the chart has them ──
    name: 'chart.resetDefaults',
    risk: 'confirm',
    summary: "Restore ONE chart's look to UCT's defaults (Chart Settings → Restore defaults): colours, markers, header, watermark and display settings. The chart's indicators are kept exactly as they are.",
    hints: 'target = the chart. Always shown as a proposal first.',
    args: { type: 'object', properties: {}, required: [], additionalProperties: false },
    check: () => null,
    apply: (st) => ({ ...st, cs: keepOwned(JSON.parse(JSON.stringify(CHART_DEFAULTS)), st.cs) }),
    describe: (b, a) => (sameJson(b.cs, a.cs) ? null : "Restored this chart's default look (your indicators are unchanged)"),
    noop: () => 'This chart already has the default settings',
  },
  {
    // ── chart.goToDate: the Time Navigator's jump (a VIEW; nothing is saved) ──
    name: 'chart.goToDate',
    summary: 'Scroll ONE chart so a past date is at its right edge — exactly the Time Navigator date box. A view change only: every bar stays on the chart (it is not a replay), nothing is saved; Undo scrolls back.',
    hints: 'date = YYYY-MM-DD. "As it looked on <date>" = this (say in the reply that later bars are still there, just scrolled off to the right).',
    args: { type: 'object', properties: { date: { type: 'string' } }, required: ['date'], additionalProperties: false },
    check(st, { date }) {
      const ms = dateMs(date)
      if (ms == null) return `“${date}” isn't a date — use YYYY-MM-DD.`
      if (ms < Date.UTC(1900, 0, 1)) return 'That date is earlier than any chart history.'
      if (ms > Date.now() + DAY_MS) return 'That date is in the future.'
      return null
    },
    apply: (st, { date }) => ({ ...st, goto: dateMs(date) }),
    describe: (b, a) => (a.goto != null ? `Moved the view to ${fmtDay(a.goto)} — the right edge shows the last bar on or before it (view only; later bars are still there)` : null),
  },
  {
    // ── chart.compare: the Compare Symbols panel's add / remove / clear (comparisonSymbols) ──
    // Entries are exactly the panel's: {sym, enabled:true, color: pickComparisonColor, scaleMode:'new'};
    // clear also leaves "Group only", and (as the open panel does) a percent scale is switched off.
    name: 'chart.compare',
    summary: 'Overlay other symbols on ONE chart (Tools → Compare Symbols): add tickers, remove some, or clear all comparisons.',
    hints: 'add = tickers to overlay, uppercase ([] for none); remove = tickers to take off ([] for none); clear = true to remove every comparison. "Compare NVDA against QQQ on this chart" = target the NVDA chart, add [QQQ].',
    args: { type: 'object', properties: {
      add: { type: 'array', items: { type: 'string' } }, remove: { type: 'array', items: { type: 'string' } }, clear: { type: 'boolean' },
    }, required: ['add', 'remove', 'clear'], additionalProperties: false },
    async prepare(ops) {
      const syms = ops.flatMap(o => (o.args?.add || []).map(x => String(x || '').trim().toUpperCase())).filter(Boolean)
      return syms.length ? { unknownSymbols: await unknownSymbols(syms) } : {}
    },
    check(st, { add, remove, clear }, env) {
      const list = (add || []).map(x => String(x || '').trim().toUpperCase())
      if (!clear && !list.length && !(remove || []).length) return 'Which symbols should I compare?'
      const odd = list.find(x => !/^[A-Z0-9.$:^_\-/]{1,24}$/.test(x))
      if (odd) return `“${odd}” doesn't look like a ticker.`
      if (list.includes(String(st.symbol || '').toUpperCase())) return `The chart already shows ${st.symbol} — compare it against a different symbol.`
      const bad = list.find(x => env?.unknownSymbols?.has(x))
      if (bad) return `UCT has no symbol “${bad}”.`
      const cur = Array.isArray(st.cs?.comparisonSymbols) ? st.cs.comparisonSymbols.length : 0
      if (cur + list.length > 10) return 'That would be more than 10 comparisons on one chart.'
      return null
    },
    apply(st, { add, remove, clear }) {
      let list = clear ? [] : (Array.isArray(st.cs?.comparisonSymbols) ? [...st.cs.comparisonSymbols] : [])
      const drop = new Set((remove || []).map(x => String(x).trim().toUpperCase()))
      list = list.filter(x => !drop.has(String(x.sym).toUpperCase()))
      for (const raw of add || []) {
        const sym = String(raw || '').trim().toUpperCase()
        if (!sym || list.some(x => x.sym === sym)) continue
        list = [...list, { sym, enabled: true, color: pickComparisonColor(list.length, list.map(x => x.color)), scaleMode: 'new' }]
      }
      const next = { ...st.cs, comparisonSymbols: list, preset: 'custom' }
      if (clear) next.compareHideBase = false
      if (list.length && next.percentScale) { next.percentScale = false; next.logScale = false }
      return sameJson(next.comparisonSymbols, st.cs?.comparisonSymbols ?? []) && !clear ? st : { ...st, cs: next }
    },
    describe(b, a) {
      const was = (b.cs?.comparisonSymbols || []).map(x => x.sym), now = (a.cs?.comparisonSymbols || []).map(x => x.sym)
      if (sameJson(was, now)) return null
      return now.length ? `Comparing ${a.symbol || 'this chart'} with ${now.join(', ')}` : 'Removed every comparison from this chart'
    },
    noop: () => 'Those comparisons are already there',
  },
  {
    // ── chart.addCustomTimeframe: the timeframe menu's "Custom interval" (ChartPane.addCustomTf):
    // the code joins header.customTimeframes and, when asked, the chart switches to it.
    name: 'chart.addCustomTimeframe',
    summary: 'Add a custom timeframe (e.g. 45 minutes, 2 hours, 3 days) to ONE chart\'s timeframe menu, exactly like the menu\'s Custom interval, and optionally switch the chart to it.',
    hints: 'unit = minutes | hours | days | weeks | months; count = how many (45 for 45 minutes); switch = true to show the chart on it now (the usual case), false to only add it to the menu.',
    args: { type: 'object', properties: {
      unit: { type: 'string', enum: ['minutes', 'hours', 'days', 'weeks', 'months'] }, count: { type: 'integer' }, switch: { type: 'boolean' },
    }, required: ['unit', 'count', 'switch'], additionalProperties: false },
    check(st, { unit, count }) {
      if (!Number.isInteger(count) || count < 1 || count > 999) return 'Give a whole number of units (1–999).'
      const code = makeTfCode(unit, count)
      if (!code || !isValidTf(code)) return `UCT can't chart a ${count}-${unit} timeframe.`
      return null
    },
    apply(st, { unit, count, switch: sw }) {
      const code = makeTfCode(unit, count)
      const hdr = st.cs?.header || {}
      const customs = Array.isArray(hdr.customTimeframes) ? hdr.customTimeframes : []
      let next = st
      if (!customs.includes(code)) next = { ...next, cs: { ...st.cs, header: { ...hdr, customTimeframes: [...customs, code] }, preset: 'custom' } }
      if (sw && st.tf !== code) next = { ...next, tf: code }
      return next
    },
    describe(b, a, { unit, count }) {
      const code = makeTfCode(unit, count)
      const added = !sameJson(b.cs?.header?.customTimeframes, a.cs?.header?.customTimeframes)
      const switched = a.tf !== b.tf
      if (!added && !switched) return null
      return `${added ? `Added a ${tfShort(code)} timeframe` : `Switched to ${tfShort(code)}`}${added && switched ? ' and switched the chart to it' : ''}`
    },
    noop: () => 'That timeframe is already in the menu',
  },
]

let registered = false
export function registerChartCapabilities() {
  if (registered) return
  registered = true
  registerTargetKind(chartKind)
  registerContextProvider({
    key: 'charts',
    build: (host, refFor) => chartKind.list(host).map(s => describeChart(s, refFor('chart', s.ref))),
  })
  registerContextProvider({
    key: 'chartTemplates',
    // The member's saved chart templates, by name (chart.applyTemplate).
    build: (host) => { const t = readTemplates(host); return t.length ? t.slice(0, 30).map(x => x.name) : undefined },
  })
  registerContextProvider({
    key: 'otherWidgets',
    build: (host) => host?.otherWidgets?.() || [],
  })
  for (const c of CAPABILITIES) registerCapability({ ...c, target: 'chart', surfaces: ['charts'], available: onCharts })
}
