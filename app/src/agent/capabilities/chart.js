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
// candle pickers, the legend's Volume remove, chartThemes.applyThemeToSettings).
// No new settings key, so the chartDefaults allow-list is untouched.

import { registerCapability, registerTargetKind, registerContextProvider } from '../capabilities'
import { CHART_THEMES, CHART_THEME_BY_ID, applyThemeToSettings } from '../../components/chart/chartThemes'
import { primaryChartTypeFor } from '../../components/chart/engine/sourceCapability'
import { canonicalFamily, canonicalProduct, canonicalSourceCapability } from '../../hooks/useMarketIndicators'
import { isEconomicId } from '../../components/chart/engine/econMark'
import { unknownSymbols } from '../agentClient'
import { mergeChartSettings } from '../../components/chart/chartDefaults'

const TYPE_LABEL = { candles: 'Candles', hollow: 'Hollow Candles', bars: 'Bars', hlc: 'HLC Bars', line: 'Line', area: 'Area' }
const TF_LABEL = { 1: '1 minute', 5: '5 minutes', 15: '15 minutes', 30: '30 minutes', 60: '1 hour', D: 'Daily', W: 'Weekly', M: 'Monthly' }
const INTRADAY = new Set(['1', '5', '15', '30', '60'])
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
const sameJson = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

// ── target kind ─────────────────────────────────────────────────────────────
// `host.charts` is the workspace binding (agent/host.js) over every mounted
// ChartWidget's agent adapter.
export const chartKind = {
  name: 'chart',
  list: (host) => host?.charts?.list() || [],
  read: (host, ref) => host?.charts?.read(ref) || null,
  stateOf: (snap) => ({ cs: snap.cs, tf: snap.tf, symbol: snap.symbol }),
  patch(before, after) {
    const p = {}
    if (after.cs !== before.cs) p.settings = after.cs
    if (after.tf !== before.tf) p.tf = after.tf
    if (after.symbol !== before.symbol) p.symbol = after.symbol
    return Object.keys(p).length ? p : null
  },
  commit: (host, ref, patch) => host.charts.commit(ref, patch),
  landed(snap, patch) {
    if (!snap) return false
    if ('settings' in patch && !sameJson(snap.stored, patch.settings)) return false
    if ('tf' in patch && snap.tf !== patch.tf) return false
    if ('symbol' in patch && snap.symbol !== patch.symbol) return false
    return true
  },
  undoPatch(item) {
    const p = {}
    if ('settings' in item.patch) p.settings = item.before.stored ?? null
    if ('tf' in item.patch) p.tf = item.before.tf
    if ('symbol' in item.patch) p.symbol = item.before.symbol
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
    args: { type: 'object', properties: { type: { type: 'string', enum: ['candles', 'hollow', 'bars', 'hlc', 'line', 'area'] } }, required: ['type'], additionalProperties: false },
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
    args: { type: 'object', properties: { timeframe: { type: 'string', enum: ['1', '5', '15', '30', '60', 'D', 'W', 'M'] } }, required: ['timeframe'], additionalProperties: false },
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
    check: (st, { mode }) => (mode === 'regular' || mode === 'extended' ? null : `“${mode}” is not a session.`),
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
    apply: (st, { theme }) => ({ ...st, cs: applyThemeToSettings(st.cs, CHART_THEME_BY_ID[theme]) }),
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
    key: 'otherWidgets',
    build: (host) => host?.otherWidgets?.() || [],
  })
  for (const c of CAPABILITIES) registerCapability({ ...c, target: 'chart', surfaces: ['charts'], available: onCharts })
}
