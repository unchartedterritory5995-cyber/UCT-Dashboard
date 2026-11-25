/* eslint-disable react-refresh/only-export-components -- a test harness */
// CAPABILITY REGRESSION (Mission 2) — one REAL Agent panel per case (testing/panelHarness: AgentPanel + useAgent +
// registry, routing, fast path, planner wiring, policy, runtime, receipts and Undo over the fixture board and the
// REAL Indicators mutation interface), a fixture server for the reads, and a FAITHFUL scripted model.
//
// The faithful model is the corpus's stand-in for a correct planner that can only use what it was SENT: it returns
// the case's canonical plan when every canonical action is in the request's `capabilities`; otherwise it asks for
// the missing groups (`need_groups`, the bounded reroute — the real protocol); if they are still missing after the
// reroute it plans nothing. So a capability the routing hides is a FAILURE here, never masked by a script that
// answers regardless. No paid model call; no real market value (every figure below is synthetic).
import { vi } from 'vitest'
import { screen } from '@testing-library/react'
import { setupPanel, bareSettings } from '../../../testing/panelHarness'
import { makeBoard } from '../../../__fixtures__/board'
import { buildDrawingSource, buildFlaggedSource, buildIndicatorAlertSource, buildListViewSource, buildDrawingBoardSource, buildLayoutDockSource } from '../../../host'
import { DOCK_PREF, addPin, removePin, shiftPin } from '../../../../pages/charts/layoutDockPins'
import { publishListView } from '../../../../pages/watchlist/watchlistViews'
import { DEFAULT_COL_ORDER } from '../../../../pages/watchlist/watchlistColumns'
import { readFlagged, writeFlagged } from '../../../../hooks/flaggedStore'
import * as drawingsStore from '../../../../components/chart/drawingsStore'
import { setAuthoringSources } from '../../../capabilities/indicatorAuthoring'
import { storeConversation } from '../../../../components/chart/builder/conversationSave'
import { CREATE_INDICATOR_FLAG_KEY } from '../../../../components/chart/builder/studio/createIndicatorFlag'
import { groupOfAction } from '../../../routing'
import { parseFormula } from '../../../../components/chart/engine/ast/parse'
import { mutate } from 'swr'
import { USER_DEFINITIONS_KEY } from '../../../../hooks/useUserDefinitions'
import { configFor, PROD_KINDS } from './registry'
import { installStepServer } from '../../../testing/stepServer'
import { captureIndicatorTemplate } from '../../../../components/chart/builder/indicatorTemplates'
import { mergeChartSettings } from '../../../../components/chart/chartDefaults'
import { makeGridControl } from './gridStub'
import * as nativeRegistry from '../../../../components/chart/engine/nativeRegistry'
import { _resetAgentConfig, loadAgentConfig } from '../../../agentClient'
import { publishWidgetDoor } from '../../../../pages/charts/widgetDoors'
import { _resetNewsLibraryForTests, _setNewsFeedForTests } from '../../../capabilities/newsLibrary'
import { ECON_SYMBOLS } from '../../../../pages/terminal/panels/economyModel'
import { LIQ_SYMBOLS } from '../../../../pages/terminal/panels/liquidityModel'
import { OIL_SYMBOLS } from '../../../../pages/terminal/panels/oilModel'

const chart = (id, x, y, w, h) => ({ id, type: 'chart', x, y, w, h, color: 'N', opts: { settings: bareSettings() } })
/** Named fixture boards. Charts are bare (the default 9/20/50/200 overlays removed, as a member's removal leaves them). */
export const BOARDS = {
  EMPTY: () => [[], {}],
  ONE: () => [[chart('c1', 0, 0, 24, 20)], { 'N:c1': 'NVDA' }],
  // a chart with the PRODUCT DEFAULTS (EMA 9/20, SMA 50/200 overlays on), as a member's untouched chart is
  ONE_TSLA_DEFAULT: () => [[{ id: 'c1', type: 'chart', x: 0, y: 0, w: 24, h: 20, color: 'N', opts: {} }], { 'N:c1': 'TSLA' }],
  ONE_SPY: () => [[chart('c1', 0, 0, 24, 20)], { 'N:c1': 'SPY' }],
  HALF: () => [[chart('c1', 0, 0, 12, 20)], { 'N:c1': 'NVDA' }],
  TWO: () => [[chart('c1', 0, 0, 12, 20), chart('c2', 12, 0, 12, 20)], { 'N:c1': 'NVDA', 'N:c2': 'AMD' }],
  // a saved-layout library (the Layout Dock's semantics: __fixtures__/board.js) — Swing open, Momentum a 2-chart board
  LAYOUTS: () => [[chart('c1', 0, 0, 24, 20)], { 'N:c1': 'NVDA', 'N:m1': 'SPY', 'N:m2': 'QQQ' }, { layouts: { entries: [{ id: 1, name: 'Swing' }, { id: 2, name: 'Momentum' }],
    boards: { 1: [chart('c1', 0, 0, 24, 20)], 2: [chart('m1', 0, 0, 12, 20), chart('m2', 12, 0, 12, 20)] }, active: 1 } }],
  // C3-037..039: the Layout Dock's BAR over a three-layout library (`layoutDock`: the bar's pins, by layout id) — Breadth off the bar
  LAYOUT_BAR: () => [[chart('c1', 0, 0, 24, 20)], { 'N:c1': 'NVDA' }, { layouts: { entries: [{ id: 1, name: 'Main Trading' }, { id: 2, name: 'Breadth' }, { id: 3, name: 'Day Trading' }],
    boards: { 1: [chart('c1', 0, 0, 24, 20)] }, active: 1 }, layoutDock: [1, 3] }],
  // … and with Breadth on the end of the bar
  LAYOUT_BAR_FULL: () => [[chart('c1', 0, 0, 24, 20)], { 'N:c1': 'NVDA' }, { layouts: { entries: [{ id: 1, name: 'Main Trading' }, { id: 2, name: 'Breadth' }, { id: 3, name: 'Day Trading' }],
    boards: { 1: [chart('c1', 0, 0, 24, 20)] }, active: 1 }, layoutDock: [1, 3, 2] }],
  // saved watchlists behind the real routes' semantics (__fixtures__/board.js)
  WATCH: () => [[chart('c1', 0, 0, 24, 20)], { 'N:c1': 'NVDA' }, { watchlists: [{ id: 'w1', name: 'Momentum', symbols: ['NVDA', 'TSLA'] }, { id: 'w2', name: 'Earnings', symbols: ['AAPL'] }] }],
  // watchlist group A (pl-exec): a chart + ONE Watchlist widget showing Momentum, with the saved watchlists (watchlist.showList)
  WLW: () => [[chart('c1', 0, 0, 12, 20), { id: 'wl1', type: 'watchlist', x: 12, y: 0, w: 12, h: 20, color: 'N', opts: { watchKey: 'user:w1', watchName: 'Momentum', watchTab: 'mine' } }],
    { 'N:c1': 'NVDA' }, { watchlists: [{ id: 'w1', name: 'Momentum', symbols: ['NVDA', 'TSLA'] }, { id: 'w2', name: 'Earnings', symbols: ['AAPL'] }] }],
  // PKG2: a half-width chart (room for new charts) + the saved watchlists — a screen's results go to a list and onto new charts
  SCAN: () => [[chart('c1', 0, 0, 12, 20)], { 'N:c1': 'NVDA' }, { watchlists: [{ id: 'w1', name: 'Momentum', symbols: ['NVDA', 'TSLA'] }, { id: 'w2', name: 'Earnings', symbols: ['AAPL'] }] }],
  // + the chart's drawings (the real drawings store through host.buildDrawingSource) and the indicator-alert library
  //   (the real hook writers through host.buildIndicatorAlertSource over the fixture /api/indicator-alerts below)
  DRAW: () => [[chart('c1', 0, 0, 24, 20)], { 'N:c1': 'NVDA' }, { drawings: true }],
  IALERTS: () => [[{ id: 'c1', type: 'chart', x: 0, y: 0, w: 24, h: 20, color: 'N', opts: { settings: { indicatorInstances: [
    { instanceId: 'inst:rsi:1', defId: 'rsi', inputs: { period: 14 } }] } } }], { 'N:c1': 'NVDA' }, { indicatorAlerts: true }],
  // + the TIME NAVIGATOR over the synthetic history (view, go-to-date, Replay Mode) and the chart's drawings
  TIMED: () => [[chart('c1', 0, 0, 24, 20)], { 'N:c1': 'NVDA' }, { timeNav: true, drawings: true }],
  // family C (C1-061): a chart whose watermark was dragged by hand (ChartWidget endWatermarkAdjust's opts.watermarkPos)
  // chartFeatures: a chart whose Company Info panel is added (collapsed, on Ownership, dragged to 520px) and Earnings Strip shown
  DOCKED: () => [[{ ...chart('c1', 0, 0, 24, 20), opts: { settings: bareSettings(), dock: { company: true, open: false, tab: 'ownership', rightW: 520, strip: true, stripH: 140 } } }], { 'N:c1': 'NVDA' }],
  WATERMARK: () => [[{ ...chart('c1', 0, 0, 24, 20), opts: { settings: bareSettings(), watermarkPos: { x: 0.2, y: 0.8, anchor: null } } }], { 'N:c1': 'NVDA' }],
  // newsLibrary.*: a chart beside a UCT News widget (its door: three rendered rows), over a library stand-in seeded per case
  NEWS_LIB: () => [[chart('c1', 0, 0, 12, 20), { id: 'n1', type: 'tradeExchangeNews', x: 12, y: 0, w: 12, h: 20, color: 'A', opts: {} }], { 'N:c1': 'NVDA' }, { newsLibrary: true }],
  // C3-144 (pl-newsfam): the same News widget, its AMD headline OPEN (its ⋯ menu: the door's `selected`), beside the saved watchlists
  NEWS_WL: () => [[chart('c1', 0, 0, 12, 20), { id: 'n1', type: 'tradeExchangeNews', x: 12, y: 0, w: 12, h: 20, color: 'A', opts: {} }], { 'N:c1': 'NVDA' },
    { newsLibrary: true, newsSelected: 'h1', watchlists: [{ id: 'w1', name: 'Momentum', symbols: ['NVDA', 'TSLA'] }, { id: 'w2', name: 'Earnings', symbols: ['AAPL'] }] }],
  // a chart drawn with a GRADIENT background (live LT-3: "turn the gradient off on this chart")
  GRADIENT: () => [[{ ...chart('c1', 0, 0, 24, 20), opts: { settings: { ...bareSettings(), bgMode: 'gradient' } } }], { 'N:c1': 'NVDA' }],
  // one chart on its DEFAULT settings (EMA 9/20, SMA 50/200) with the indicator-alert library
  // + the Indicators AUTHORING interface (the real engine, draft store and canonical Save) with the builder's model and the
  //   definitions server as stand-ins (agentIndicatorCreate.test.jsx's construction)
  AUTHOR: () => [[chart('c1', 0, 0, 24, 20)], { 'N:c1': 'QQQ' }, { authoring: true }],
  // AUTHOR on a board of TWO charts (a new draft with no chart must ask which one: agentPlannerV2Screens.test.jsx)
  AUTHOR_TWO: () => [[chart('c1', 0, 0, 12, 20), chart('c2', 12, 0, 12, 20)], { 'N:c1': 'QQQ', 'N:c2': 'SPY' }, { authoring: true }],
  // PACKAGE 3: AUTHOR on a board of FOUR ("apply it to my other chart" is ambiguous there: it must ask which)
  AUTHOR_FOUR: () => [['c1', 'c2', 'c3', 'c4'].map((id, i) => chart(id, (i % 2) * 12, Math.floor(i / 2) * 10, 12, 10)),
    { 'N:c1': 'QQQ', 'N:c2': 'SPY', 'N:c3': 'NVDA', 'N:c4': 'TSLA' }, { authoring: true }],
  // + the member's PREFERENCES (host.prefs: setPref's contract — write resolves true once the server accepted it): app
  //   settings, and a saved chart template "Clean" (black background) in chart_templates
  PREFS: () => [[chart('c1', 0, 0, 24, 20)], { 'N:c1': 'NVDA' }, { prefs: true }],
  // Agent Phase 1: a Watchlist widget showing the saved list Momentum, beside a chart, published through the REAL registry and
  // read through the REAL host source (host.js buildListViewSource) and Flagged store. The widget itself is a stand-in with
  // Watchlists.jsx's published shape: qa/chartsOutcome/listControl.outcome.test.jsx covers the real widget.
  LISTVIEW: () => [[chart('c1', 0, 0, 16, 20), { id: 'wl', type: 'watchlist', x: 16, y: 0, w: 8, h: 20, color: 'N', opts: { watchKey: 'user:w1', watchName: 'Momentum' } }], { 'N:c1': 'NVDA' },
    { watchlists: [{ id: 'w1', name: 'Momentum', symbols: ['NVDA', 'TSLA', 'AMD'] }], listView: true }],
  // Agent Phase 1: a chart with one indicator and the member's saved INDICATOR templates (seed.indicatorTemplates: names, each
  // holding one MACD, built by the REAL capture; the surface's build flag is on for such a case only)
  TEMPLATES: () => [[{ ...chart('c1', 0, 0, 24, 20), opts: { settings: { ...bareSettings(), indicatorInstances: [{ instanceId: 'inst:rsi:1', defId: 'rsi', inputs: { period: 14 } }] } } }], { 'N:c1': 'NVDA' }, { prefs: true }],
  ONE_DEFAULT_IA: () => [[{ id: 'c1', type: 'chart', x: 0, y: 0, w: 24, h: 20, color: 'N', opts: {} }], { 'N:c1': 'NVDA' }, { indicatorAlerts: true }],
  // four charts on their DEFAULT settings: every chart carries its own EMA 9 / EMA 20 (the same names, ids ovl:0 / ovl:1)
  FOUR_DEFAULT: () => [['c1', 'c2', 'c3', 'c4'].map((id, i) => ({ id, type: 'chart', x: (i % 2) * 12, y: Math.floor(i / 2) * 10, w: 12, h: 10, color: 'N', opts: {} })),
    { 'N:c1': 'SPY', 'N:c2': 'QQQ', 'N:c3': 'NVDA', 'N:c4': 'TSLA' }, { indicatorAlerts: true }],
  // #1030: ONE + the Multi Chart grid's control surface (testing/gridStub.js; the grid closed, 2×2 kept for next time)
  GRID: () => [[chart('c1', 0, 0, 24, 20)], { 'N:c1': 'NVDA' }, { grid: true }],
  FOUR: () => [['c1', 'c2', 'c3', 'c4'].map((id, i) => chart(id, (i % 2) * 12, Math.floor(i / 2) * 10, 12, 10)),
    { 'N:c1': 'SPY', 'N:c2': 'QQQ', 'N:c3': 'NVDA', 'N:c4': 'TSLA' }],
  // uctIntelligence.set: a chart whose StockChart offers the UCT Intelligence row (S/R and Setups released; Candlestick
  // patterns and Caution not) — never added, and with it added (Auto patterns on, Support & resistance chosen)
  UCTI: () => [[chart('c1', 0, 0, 24, 20)], { 'N:c1': 'NVDA' }, { uctIntel: UCTI_GATES }],
  UCTI_ADDED: () => [[{ ...chart('c1', 0, 0, 24, 20), opts: { settings: { ...bareSettings(), showPatterns: true, uctIntelligence: { added: true, labels: true, supportResistance: true } } } }],
    { 'N:c1': 'NVDA' }, { uctIntel: UCTI_GATES }],
}
const UCTI_GATES = { available: true, known: true, availability: { supportResistance: true, supportResistanceEmpty: false, candles: false, setups: true, caution: false } }

// Synthetic screener catalog / universe (never real values)
const FIELDS = [{ key: 'adr_pct', label: 'ADR %', type: 'range', unit: '%' }, { key: 'price', label: 'Price', type: 'range', unit: '$' },
  { key: 'chg_pct', label: 'Change %', type: 'range', unit: '%' }, { key: 'rel_volume', label: 'Rel Volume', type: 'range', unit: 'x' }, { key: 'days_to_earnings', label: 'Days to earnings', type: 'range', unit: 'd' },
  // PKG2 (conversational scanning): the catalog keys the owner's screen + refinements use (filters.py), and one LIST field with its values
  { key: 'chg_pct_1m', label: 'Change 1M', type: 'range', unit: '%' }, { key: 'chg_pct_3m', label: 'Change 3M', type: 'range', unit: '%' },
  { key: 'dist_52w_high_pct', label: '% From 52W High', type: 'range', unit: '%' }, { key: 'vol_ratio', label: 'Volume vs 30D Avg', type: 'range', unit: 'x' },
  { key: 'sector', label: 'Sector', type: 'enum', unit: '', category: 'descriptive' },
  // SG-2: the industry list holds an IT-services industry whose name contains "Technology" (the live wrong match)
  { key: 'industry', label: 'Industry', type: 'enum', unit: '', category: 'descriptive' }]
const FIELD_OPTIONS = { sector: { values: ['Technology', 'Healthcare', 'Energy', 'Financial Services'] },
  industry: { values: ['Information Technology Services', 'Semiconductors', 'Software - Application', 'Oil & Gas E&P'] } }
// the indicator-alert catalog as the evaluator serves it (indicator_alert_evaluator.alert_catalog), RSI + the MA cross (train 3)
const OSC = [{ value: 'above', label: 'Above threshold', needs_threshold: true }, { value: 'below', label: 'Below threshold', needs_threshold: true },
  { value: 'cross_above', label: 'Crosses above', needs_threshold: true }, { value: 'cross_below', label: 'Crosses below', needs_threshold: true }]
const XC = [{ value: 'cross_above', label: 'Fast MA crosses above slow MA', needs_threshold: false }, { value: 'cross_below', label: 'Fast MA crosses below slow MA', needs_threshold: false }]
const IA_CATALOG = [
  { indicator: 'rsi', label: 'RSI', conditions: OSC, default_threshold: 70, plots: [{ value: 'rsi', label: 'RSI', conditions: OSC, default_threshold: 70, inputs: { period: 14 }, instance_label: 'RSI (14)' }] },
  { indicator: 'ma_cross', label: 'MA Cross', conditions: XC, default_threshold: null, plots: [{ value: 'ma_cross', label: 'MA Cross', conditions: XC, default_threshold: null,
    inputs: { ma_type: 'ema', fast: 9, slow: 20 }, instance_defs: ['movingAverage'], instance_label: 'EMA(9) vs EMA(20)' }] },
]
// ── the indicator BUILDER's model (/converse), as agentIndicatorCreate.test.jsx: the EMA 9/20 % request → its formula ──
const PATCH = 'uct.authoring.patch/1'
const CLOSE = { type: 'series', name: 'close' }
const ema = (n) => ({ type: 'call', name: 'ema', args: [CLOSE, { type: 'num', value: n }] })
const opn = (name, ...args) => ({ type: 'op', name, args })
const PCT = opn('*', opn('/', opn('-', ema(9), ema(20)), ema(20)), { type: 'num', value: 100 })
/** A scripted builder op with `formula` strings → the canonical trees (the engine's own parser; a bad formula fails the case). */
const parsed = (f) => { const r = parseFormula(f); if (!r.ok) throw new Error(`scripted builder formula "${f}": ${r.error}`); return r.ast }
const treesOf = (ops) => ops.map(o => {
  const x = { ...o }
  if (typeof x.formula === 'string') { x.tree = parsed(x.formula); delete x.formula }
  if (Array.isArray(x.outputs)) x.outputs = x.outputs.map(out => (typeof out.formula === 'string' ? (({ formula, ...rest }) => ({ ...rest, tree: parsed(formula) }))(out) : out))
  return x
})
// ── SYNTHETIC BAR HISTORY (deterministic; never a market value): a weekday calendar from 2025-01-02 to 2026-10-30 and a
// smooth made-up price path. The chart's Time Navigator read-out (view.firstMs / lastMs / rightMs) and the `bars.daily`
// gateway kind are both served from it, so time anchors, go-to-date and replay resolve against the same bars.
const DAY = 86400000
export const BAR_DAYS = (() => {
  const out = []
  for (let t = Date.UTC(2025, 0, 2); t <= Date.UTC(2026, 9, 30); t += DAY) { const d = new Date(t).getUTCDay(); if (d !== 0 && d !== 6) out.push(t) }
  return out
})()
const synthBar = (t, i) => { const c = 100 + 20 * Math.sin(i / 17) + i * 0.05; return { t: new Date(t).toISOString().slice(0, 10), o: c - 0.5, h: c + 1.5, l: c - 1.5, c, v: 1000000 + (i % 7) * 50000 } }
export const SYNTH_BARS = BAR_DAYS.map((t, i) => synthBar(t, i))
const lastOnOrBefore = (ms) => { let r = BAR_DAYS[0]; for (const t of BAR_DAYS) { if (t <= ms) r = t; else break } return r }
const LOWER_OK = new Set(['NVDA', 'TSLA', 'AMD', 'AAPL', 'QQQ'])
// asset_classes.py's words used by the corpus (word → {kind, asset, label})
const ASSET_ROUTES = { gold: { kind: 'commodity.quote', asset: 'gold', label: 'gold' }, bitcoin: { kind: 'crypto.quote', asset: 'btc', label: 'Bitcoin' },
  btc: { kind: 'crypto.quote', asset: 'btc', label: 'Bitcoin' }, dow: { kind: 'index.quote', asset: 'dji', label: 'Dow Jones Industrial Average' } }
// a made-up event-study answer (the study's own {lead, text, table, caveats} shape) — never a market value
const SYNTH_STUDY = (sym) => ({ lead: `${sym} synthetic condition: 3 events (fixture)`, text: `${sym} synthetic condition: 3 events (fixture)\nSynthetic fixture study: no market value.`,
  table: { columns: [{ key: 'window', label: 'Window' }, { key: 'n', label: 'Events' }], rows: [{ window: '1 trading session', n: '3' }] }, caveats: ['Small sample (fixture).'] })
// Terminal data wave 1 (dark kinds `analyst.actions`, `highsLows.session`, `sectors.performance`, `leaders.longRun`,
// `levels.darkpool`): each kind's answer in the shape its adapter returns (api/services/uct_agent/marketdata/), with made-up
// symbols and figures — never a market value. kind → (params) => the envelope fields that differ from a plain `periodic` ok.
const TERMINAL_ANALYST = { upgrades: [{ ticker: 'AAA', action: 'Upgrade', firm: 'Example Securities', from_rating: 'Hold', to_rating: 'Buy', price_target: '$120' }],
  downgrades: [{ ticker: 'CCC', action: 'Downgrade', firm: 'Sample Capital', from_rating: 'Buy', to_rating: 'Hold', price_target: null }],
  pt_changes: [{ ticker: 'DDD', action: 'Raises PT', firm: 'Example Securities', from_rating: null, to_rating: 'Buy', price_target: 150 }] }
const TERMINAL_DATA = {
  'analyst.actions': (p) => {
    const side = p.side || 'all'
    const lists = Object.fromEntries(Object.entries(TERMINAL_ANALYST).map(([k, rows]) => [k, side === 'all' || side === k ? rows : []]))
    return { as_of: '2026-11-03T05:00:00Z', data: { ...lists, summary: Object.fromEntries(Object.entries(lists).map(([k, rows]) => [k, rows.length])), side, wire_date: '2026-11-03', wire_status: 'fresh' } }
  },
  'highsLows.session': () => ({ data: { window: 'rth', active: true, date: '2026-11-03', asof: '2026-11-03T10:59:58-05:00', tick_at: '2026-11-03T15:59:58Z', group: null, value: null,
    highs: [{ sym: 'AAA', price: 10.5, pct: 2.5, count: 12, ts: '2026-11-03T10:59:58-05:00', dir: 'high' }], lows: [{ sym: 'CCC', price: 20.25, pct: -4.1, count: 3, ts: '2026-11-03T10:59:58-05:00', dir: 'low' }],
    highs_total: 40, lows_total: 2 } }),
  'sectors.performance': (p) => ({ data: { period: p.period || 'Today', sessions: { Today: 1, '1W': 5, '1M': 21, '3M': 63 }[p.period || 'Today'],
    sectors: [{ sector: 'Technology', ticker: 'XLK', change_pct: 2.1 }, { sector: 'Financials', ticker: 'XLF', change_pct: 1.4 }, { sector: 'Energy', ticker: 'XLE', change_pct: -0.9 }], missing: [] } }),
  'leaders.longRun': (p) => ({ data: { list: p.list, family: 'gain', what: 'synthetic list (fixture)', status: 'ok',
    results: [{ sym: 'AAA', price: 18, prev_close: 17.5, change_pct: 1.2, change_nd: 80, ref_close: 10 }, { sym: 'BBB', price: 9, prev_close: 9.1, change_pct: -1.1, change_nd: 50, ref_close: 6 }],
    count: 2, as_of: '2026-11-03T10:59:30-05:00', computed_at: '2026-11-03T15:59:30Z' } }),
  'levels.darkpool': (p) => ({ freshness: 'historical', as_of: '2026-11-02T21:00:00Z', data: { sym: String(p.symbol || '').toUpperCase(),
    levels: [{ price: 98.5, notional: 12500000, printCount: 4, lastDate: '2026-11-02', lo: 98.4, hi: 98.6, rank: 2 }, { price: 101.25, notional: 25000000, printCount: 4, lastDate: '2026-10-29', lo: 101.15, hi: 101.35, rank: 1 }],
    windowDays: 20, datesCovered: 14, version: 'fixture', asOf: 1793721600, computed_at: '2026-11-03T16:00:00Z', newest_print_date: '2026-11-02' } }),
  // Terminal data wave 2 (dark kinds `highsLows.yearly`, `themes.rotation`, `confluence.board`, `earnings.expectedMove`,
  // `earnings.callSearch`; MD-1 §4.11): the same rule — each adapter's own data shape, made-up names, figures and words.
  'highsLows.yearly': (p) => {
    const side = p.side || 'both'
    const part = (items) => ({ state: 'ok', items, count: items.length })
    return { as_of: '2026-11-03T15:59:05Z', data: { mode: 'live', why: null, session_date: '2026-11-03', side,
      highs: side === 'lows' ? null : part([{ t: 'AAA', c: 10.5, pct: 9, vr: 1.8, v: 1200000, n: 'Fixture A' }, { t: 'BBB', c: 20.25, pct: 4.5, vr: 1.1, v: 800000, n: 'Fixture B' }]),
      lows: side === 'highs' ? null : part([{ t: 'CCC', c: 5.75, pct: -6.2, vr: 2.4, v: 300000, n: 'Fixture C' }]),
      basis: null, computed_at: '2026-11-03T15:59:30Z', missing: [] } }
  },
  'themes.rotation': (p) => {
    const side = p.side || 'both'
    const into = side === 'out' ? [] : [{ name: 'Fixture Theme A', ticker: 'fixture-a', '1w_return': 4.2, '1w_rank': 82, '1m_return': 1.1, '1m_rank': 41, '3m_return': 9, '3m_rank': 55, momentum_delta: 41 }]
    const out = side === 'in' ? [] : [{ name: 'Fixture Theme B', ticker: 'fixture-b', '1w_return': -3.1, '1w_rank': 20, '1m_return': 2.2, '1m_rank': 48, '3m_return': 1, '3m_rank': 40, momentum_delta: -28 }]
    return { data: { side, rotating_in: into, rotating_out: out, in_count: into.length, out_count: out.length, ranked: 12, threshold: 20,
      generated_at: '2026-11-03T15:50:00+00:00', computed_at: '2026-11-03T15:50:00Z' } }
  },
  'confluence.board': (p) => {
    const row = (sym, dir, status) => ({ sym, band: 'L', dir, status, sector: 'Fixture', dpn: 180000000, dpAvg: 101.4, dpLo: 98.5, dpHi: 104.25, dpLast: 103.1, bigPrint: 40000000, bigPrice: 101, bigDate: '10/29',
      net: dir === 'BULL' ? 12500000 : -8000000, net5: 6000000, bull: 14000000, bear: 1500000, bullPct: 90.3, leapPrem: 5000000, leapShare: 0.41, freshRatio: 0.48,
      top: { cp: dir === 'BULL' ? 'C' : 'P', strike: 120, exp: '1/15/2027', dte: 73, prem: 4200000 }, score: 2.4 })
    const all = [row('AAA', 'BULL', 'BUILDING'), row('CCC', 'BEAR', 'STEADY')]
    const want = { bull: 'BULL', bear: 'BEAR' }[p.direction] || null
    const rows = all.filter(r => !want || r.dir === want)
    return { data: { days: 30, window: 'Sep 22 \u2013 Oct 31, 2026', direction: p.direction || 'all', rows, count: rows.length, counts: { total: 2, bull: 1, bear: 1, building: 1 }, band_meta: {},
      incomplete: false, built_at: '2026-11-03T15:45:00Z', refresh_minutes: 30 } }
  },
  'earnings.expectedMove': (p) => {
    const sym = String(p.symbol || '').toUpperCase()
    return { data: { symbol: sym, report_date: p.report_date || null,
      live: { pct: 8.4, dollar: 10.5, strike: 125, spot: 125.3, call_mid: 5.6, put_mid: 4.9, iv_atm: 0.71, expiry: '2026-11-06', horizon: 'through 2026-11-06', asof: '2026-11-03T15:40:00+00:00', source: 'massive-chain' },
      live_state: 'fresh', live_outcome: { kind: 'ok', reason: null }, read_at: '2026-11-03T15:40:00Z',
      history: [{ sym, report_date: '2026-08-06', captured_at: '2026-08-05T02:00:00+00:00', pct: 6.2, dollar: 7.5, expiry: '2026-08-07', fiscal_year: 2026, fiscal_quarter: 2 }],
      history_since: '2026-08-06', store_read: true } }
  },
  'earnings.callSearch': (p) => ({ as_of: '2026-11-02T05:00:00Z', data: { query: String(p.q || ''), symbol: p.symbol || null, since: p.since || null, total: 2, total_wider: false,
    hits: [{ symbol: 'AAA', year: 2026, quarter: 3, date: '2026-10-29 17:00:00', snippet: 'a synthetic excerpt about <mark>fixture</mark> words \u2026 and nothing else', score: 9.5 },
      { symbol: 'BBB', year: 2026, quarter: 3, date: '2026-10-27 17:00:00', snippet: 'another synthetic <mark>fixture</mark> excerpt', score: 7.25 }],
    expanded: {}, index: { calls: 12, oldest: '2026-08-15', newest: '2026-11-02' } } }),
  // Terminal data wave 3 (dark kinds `levels.gamma`, `flow.topPicks`, `flow.record`, `earnings.reactions`; MD-1 §4.12): the same
  // rule — each adapter's own data shape, made-up names and figures.
  'levels.gamma': (p) => ({ data: { sym: String(p.symbol || '').toUpperCase(), levels: [{ kind: 'callWall', price: 105 }, { kind: 'putWall', price: 95 }, { kind: 'zeroGamma', price: 98.5 }],
    spot: 100, regime: 'choppy', version: 'fixture', asOf: 1793721000, computed_at: '2026-11-03T15:50:00Z', held: 'fresh', chain_source: 'massive', band_pct: 15, kept_minutes: 10, last_good_minutes: 30 } }),
  'flow.topPicks': (p) => {
    const row = (sym, dir, status, o = {}) => ({ id: `${sym}|C|100.0|1/15/2027`, sym, cp: dir === 'BULL' ? 'C' : 'P', strike: 100, exp: '1/15/2027', grade: 'A', dir, dateSaved: '2026-08-10', saved_date: '2026-08-10',
      status, stopped: false, scored: true, prices: 3, entry: 2, latest_price: 3, latest_date: '2026-11-02', peak_price: 4, current_gain_pct: 50, max_gain_pct: 100, days_tracked: 2,
      oi_evaluable: true, oi_confirmed: true, prem: 1500000, hits: 4, cap: 'Large Cap', src: ['massive'], ...o })
    const all = [row('AAA', 'BULL', 'open'), row('BBB', 'BEAR', 'expired', { current_gain_pct: -50, max_gain_pct: -20, latest_price: 1, peak_price: 1.6, oi_confirmed: false }),
      row('CCC', 'BULL', 'open', { scored: false, prices: 1, latest_price: 1.2, peak_price: null, current_gain_pct: null, max_gain_pct: null, days_tracked: null, oi_evaluable: false, oi_confirmed: false })]
    const want = { bullish: 'BULL', bearish: 'BEAR' }[p.direction] || null
    const rows = all.filter(r => (!p.status || p.status === 'all' || r.status === p.status) && (!want || r.dir === want) && (!p.symbol || r.sym === p.symbol))
    return { freshness: 'historical', as_of: '2026-11-02T21:00:00Z', data: { status: p.status || 'all', direction: p.direction || 'any', sort: p.sort || 'gain', symbol: p.symbol || null, rows, count: rows.length,
      counts: { total: 3, open: 2, expired: 1, scored: 2, too_new: 1, never_scored: 0 }, matching_too_new: rows.filter(r => !r.scored).length, unread: 0, min_prices: 2,
      newest_price_date: '2026-11-02', newest_pick_date: '2026-08-10', days_since_newest_price: 1, days_since_newest_pick: 85, no_new_picks: true } }
  },
  'flow.record': () => {
    const bucket = (picks, o = {}) => ({ picks, win_rate_10: picks ? 75 : null, win_rate_25: picks ? 50 : null, win_rate_50: picks ? 25 : null, pct_doubled: picks ? 12.5 : null,
      avg_max_gain: picks ? 41.5 : null, median_max_gain: picks ? 22 : null, oi_confirmed_rate: picks ? 62.5 : null, oi_evaluated: picks, ...o })
    const pick = (sym, gain) => ({ sym, cp: 'C', strike: 100, exp: '1/15/2027', grade: 'A', dateSaved: '2026-08-10', entry: 2, peak_price: 4, max_gain_pct: 100, days_tracked: 2, oi_confirmed: true, current_gain_pct: gain, latest_price: 2 * (1 + gain / 100) })
    return { freshness: 'historical', as_of: '2026-11-02T21:00:00Z', data: { flagged: 10, picks_tracked: 8, too_new: 2, overall: bucket(8),
      by_grade: ['A+', 'A', 'B', 'C', 'D'].map((grade, i) => ({ grade, ...bucket(i < 2 ? 4 : 0) })), recent_winners: [pick('AAA', 50)], recent_picks: [pick('AAA', 50), pick('BBB', -50)],
      generated_at: '2026-11-03T15:58:00+00:00', computed_at: '2026-11-03T15:58:00Z', min_prices: 2, recent_window_days: 45, newest_price_date: '2026-11-02', newest_pick_date: '2026-08-10',
      days_since_newest_price: 1, days_since_newest_pick: 85, no_new_picks: true } }
  },
  'earnings.reactions': (p) => {
    const row = (sym, session, move, o = {}) => ({ sym, name: `Fixture ${sym}`, session, eps_act: 1.25, eps_est: 1, rev_act: 520, rev_est: 500, move, ...o })
    const all = [row('BBB', 'bmo', -7.5, { eps_act: 0.8 }), row('AAA', 'amc', 4.25), row('CCC', 'tbd', null)]
    return { freshness: 'historical', data: { date: p.date || '2026-11-02', day_kind: 'past', scheduled: 5, reporters: all.slice(0, p.limit || 25), count: 3, moves: 'held', moved: 2, up: 1, down: 1, flat: 0, no_move: 1 } }
  },
  // Terminal data wave 4 (dark kinds `earnings.season`, `earnings.callThemes`, `group.drill`; MD-1 §4.13): the same rule — each
  // adapter's own data shape, made-up names and figures.
  'earnings.season': (p) => {
    const row = (sym, session, mc, o = {}) => ({ sym, name: `Fixture ${sym}`, session, mc_b: mc, eps_est: 1, eps_act: null, rev_est: 500, rev_act: null, reported: false, verdict: null,
      priced: { pct: 6.2, dollar: 12.4, captured_at: '2026-11-02T16:35:04-05:00', expiry: '2026-11-06' }, past: { moves: [{ date: '2026-08-04', pct: 3.1 }, { date: '2026-05-05', pct: -2 }], avg_abs: 2.55, n: 2 },
      past_state: 'ok', move: null, move_state: null, ...o })
    const all = { bmo: [row('AAA', 'bmo', 900, { eps_act: 1.5, rev_act: 520, reported: true, verdict: 'beat', move: 3.21, move_state: 'live' }), row('BBB', 'bmo', 50, { priced: null, past: null, past_state: 'not_held' })],
      amc: [row('CCC', 'amc', 300)], tbd: [] }
    const want = p.session === 'bmo' || p.session === 'amc' ? [p.session] : ['bmo', 'amc', 'tbd']
    const sessions = Object.fromEntries(['bmo', 'amc', 'tbd'].map(s => [s, want.includes(s) ? all[s] : []]))
    const count = want.reduce((n, s) => n + all[s].length, 0)
    return { data: { date: p.date || '2026-11-03', today: '2026-11-03', day_kind: 'today', default: !p.date, session: p.session || 'all', sessions, count, shown: count, scheduled: 3,
      counts: { scheduled: 3, reported: 1, priced: 2, priced_withheld: 0, with_past: 2, past_not_held: 1, moved: 1 }, priced_state: 'read', moves_state: 'live',
      calendar_as_of: '2026-11-03T15:50:00Z', built_at: '2026-11-03T15:58:00Z', capture: { hour_et: 16, minute_et: 35 }, range: { from: '2026-10-26', to: '2026-11-13' }, held: 'fresh', no_day: false } }
  },
  'earnings.callThemes': (p) => {
    const row = (phrase, calls, pct, base, o = {}) => ({ phrase, words: phrase.split(' ').length, calls, pct, companies: calls - 2, base_calls: Math.round(base * 4), base_pct: base, base_raw_pct: base,
      rise: Math.round((pct - base) * 10) / 10, ratio: base ? Math.round(pct / base * 10) / 10 : null, related: [], examples: ['AAA', 'BBB'], ...o })
    const lists = { new: [row('fixture phrase', 40, 13.3, 0), row('synthetic words', 22, 7.3, 0.2)], rising: [row('made up theme', 90, 30, 18.5)] }
    const want = p.list === 'new' || p.list === 'rising' ? [p.list] : ['new', 'rising']
    const cut = (name) => (want.includes(name) ? lists[name].slice(0, p.limit || 10) : [])
    return { as_of: '2026-11-02T05:00:00Z', data: { month: p.month || '2026-11', months: ['2026-11', '2026-10'], list: p.list || 'both', calls: 300, companies: 290,
      baseline: { months: ['2026-08', '2026-09', '2026-10'], calls: 410, matched_pct: 87.5 }, floor: { calls: 8, companies: 6 }, new: cut('new'), rising: cut('rising'),
      qualified: { new: 2, rising: 1 }, shown: { new: cut('new').length, rising: cut('rising').length }, built_at: '2026-11-03T11:00:00Z', refreshing: false,
      corpus: { calls: 520, oldest: '2026-08-15', newest: '2026-11-02' }, rules: {} } }
  },
  'group.drill': (p) => {
    const common = { range: p.range || 'ytd', start_day: '2025-12-31', end_day: '2026-11-02', built_at: '2026-11-03T15:55:00Z', held: 'fresh', partial_history: false, kind: p.kind || null }
    if (!p.group) {
      const lists = { sector: [{ name: 'Technology', pct: 15, count: 4 }, { name: 'Energy', pct: -5, count: 1 }], industry: [{ name: 'Semiconductors', pct: 20, count: 2 }, { name: 'Software', pct: 10, count: 2 }],
        theme: [{ name: 'Fixture Theme', pct: 12.5, count: 2 }] }
      const kinds = p.kind ? [p.kind] : ['sector', 'industry', 'theme']
      return { data: { mode: 'groups', ...common, lists: Object.fromEntries(kinds.map(k => [k, lists[k]])), counts: Object.fromEntries(kinds.map(k => [k, lists[k].length])) } }
    }
    const row = (sym, pct, rs, flow) => ({ sym, pct, start_close: 100, end_close: 100 + pct, industry: 'Semiconductors', sector: 'Technology', rs, flow })
    const rows = [row('AAA', 30, 97, { dir: 'BULL', status: 'BUILDING' }), row('BBB', 20, 55, null), row('DDD', 10, null, { dir: 'BEAR', status: 'STEADY' }), row('EEE', 0, 12, null)]
    return { data: { mode: 'group', ...common, name: p.group, found: true, group_pct: 15, rows: rows.slice(0, p.limit || 25), count: 4, shown: Math.min(4, p.limit || 25), known: 4, ranked: 3, on_board: 2,
      sort: p.sort || 'pct', dir: p.dir || 'desc', rs_state: 'held', flow_state: 'held', flow_built_at: '2026-11-03T15:45:00Z' } }
  },
  // Terminal data wave 5 (dark kinds `short.interest`, `short.list`; MD-1 §4.14): the same rule — each adapter's own data
  // shape, made-up names and figures. `as_of` is the settlement date (never the day of the read).
  'short.interest': (p) => {
    const report = (day, short, change, o = {}) => ({ settlement_date: day, short_interest: short, avg_daily_volume: 1000000, days_to_cover: 6, change_shares: change, change_pct: change == null ? null : 50, ...o })
    const reports = [report('2026-10-15', 3000000, 1000000), report('2026-09-30', 2000000, 1000000, { days_to_cover: 4 }), report('2026-09-15', 1000000, null, { days_to_cover: null })]
    const days = [{ date: '2026-10-30', short_volume: 400000, total_volume: 1000000, short_volume_ratio: 40 }, { date: '2026-10-29', short_volume: 300000, total_volume: null, short_volume_ratio: null }]
    const shown = reports.slice(0, p.reports || 12)
    return { freshness: 'historical', as_of: '2026-10-15T04:00:00Z', data: { sym: String(p.symbol || '').toUpperCase(), settlement_date: '2026-10-15', latest: reports[0], publication_estimate: '2026-10-26',
      read_at: '2026-11-03T15:40:00Z', held: 'fresh', interest: { state: 'ok', reason: null, http_status: 200, reports: shown, count: 3, shown: shown.length, cut: false, first_date: '2026-09-15' },
      volume: { state: 'ok', reason: null, http_status: 200, days: days.slice(0, p.days || 10), count: 2, shown: Math.min(2, p.days || 10), window_days: 60 },
      float: { shares: 10000000, pct_float: 30, withheld: false, state: 'ok', source: 'fixture' }, source: 'fixture' } }
  },
  'short.list': (p) => {
    const row = (sym, short, dtc, prev, o = {}) => ({ sym, short_interest: short, avg_daily_volume: 1000000, days_to_cover: dtc, prev_short_interest: prev, change_shares: prev == null ? null : short - prev,
      change_pct: prev == null ? null : Math.round((short - prev) / prev * 1000) / 10, float_shares: 10000000, pct_float: short / 100000, ...o })
    const all = [row('CCC', 900000, 9, null, { float_shares: null, pct_float: null }), row('AAA', 3000000, 6, 2000000), row('BBB', 600000, 1.2, 1000000)]
    const rank = p.rank || 'dtc'
    const ranked = rank === 'up' ? all.filter(r => r.change_pct > 0) : rank === 'down' ? all.filter(r => r.change_pct < 0) : rank === 'float' ? all.filter(r => r.pct_float != null).sort((a, b) => b.pct_float - a.pct_float) : all
    const rows = ranked.slice(0, p.limit || 25)
    return { freshness: 'historical', as_of: '2026-10-15T04:00:00Z', data: { rank, settlement_date: '2026-10-15', previous_settlement_date: '2026-09-30', newer_report_landing: null, newer_report_due: null,
      publication_estimate: '2026-10-26', read_at: '2026-11-03T15:40:00Z', held: 'held', count: 3, universe: 4, ranked: ranked.length, limit: p.limit || 25, shown: rows.length, cut: rows.length < ranked.length, rows,
      floor_shares: rank === 'up' || rank === 'down' ? 500000 : null, float: { state: 'ok', with_float: 2, withheld: 0, source: 'fixture' }, check: null, source: 'fixture' } }
  },
  // Terminal data wave 6 (dark kinds `seasonality.stock`, `seasonality.board`, `options.tideHistory`, `options.oiChange`,
  // `rates.treasury`; MD-1 §4.15): the same rule — each adapter's own data shape, made-up names and figures. `as_of` is the
  // data's own date (the newest bar, session, log file or curve day; never the day of the read).
  'seasonality.stock': (p) => ({ freshness: 'historical', as_of: '2026-10-30T20:00:00Z', data: { ticker: String(p.symbol || '').toUpperCase(), source: 'fixture', months: SEASON_MONTHS(0),
    weekdays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map((label, i) => ({ weekday: i, label, n: 500, avg_pct: (i - 2) * 0.05, median_pct: (i - 2) * 0.04, pct_up: 50 + i })),
    covered_from: '2016-01-04', covered_to: '2026-10-30', full_months: 129, min_years: 5, sessions: 2725, first_bar: '2016-01-04', last_bar: '2026-10-30',
    latest_completed_session: '2026-10-30', pre_vendor_floor: false, read_at: '2026-11-03T15:40:00Z' } }),
  'seasonality.board': () => {
    const fund = (symbol, name, kind, shift) => ({ symbol, name, kind, status: 'ok', months: SEASON_MONTHS(shift), covered_from: '2016-01-04', covered_to: '2026-10-30', full_months: 129 })
    return { freshness: 'historical', as_of: '2026-10-30T20:00:00Z', data: { funds: [fund('AAA', 'Made-up index fund', 'index', 0), fund('BBB', 'Made-up sector one', 'sector', 1), fund('CCC', 'Made-up sector two', 'sector', -1),
      { symbol: 'DDD', name: 'Made-up sector three', kind: 'sector', status: 'pending', reason: 'warming' }],
      this_month: 11, next_month: 12, et_date: '2026-11-03', min_years: 5, source: 'fixture', data_through: '2026-10-30', complete: false, settled: false, built_at: '2026-11-03T15:30:00Z', read_at: '2026-11-03T15:40:00Z' } }
  },
  'options.tideHistory': (p) => {
    const row = (session, call, put, prints) => ({ session, net_call_premium: call, net_put_premium: put, net_premium: call == null || put == null ? null : call - put, prints_counted: prints, prints_unsigned: 10, prints_unreadable: 0,
      data_through: '16:00', stored_at: `${session}T20:30:00Z`, source: 'fixture' })
    const all = [row('2026-10-30', 5000000, 2000000, 2000), row('2026-10-29', 1000000, 3000000, 1500), row('2026-10-28', 4000000, 1000000, 1000)]
    const sessions = all.slice(0, p.rows || 20)
    return { freshness: 'historical', as_of: '2026-10-30T20:00:00Z', data: { scope: p.scope || 'all', sessions, sessions_stored: 3, sessions_asked: p.rows || 20, sessions_left_out: 3 - sessions.length, history_began: '2026-10-28',
      latest_session: '2026-10-30', missing_sessions: [], missing_total: 0, missing_checked_through: '2026-10-30', backfill: false, stored_note: 'fixture', filters: 'fixture', method: 'fixture', label: 'fixture', read_at: '2026-10-30T20:30:00Z' } }
  },
  'options.oiChange': (p) => {
    const all = [{ contract: 'O:AAA261120C00150000', expiration: '2026-11-20', strike: 150, type: 'call', oi: 5000, kind: 'change', prior_oi: 4000, change: 1000, change_pct: 25, volume: 1200 },
      { contract: 'O:AAA261120P00140000', expiration: '2026-11-20', strike: 140, type: 'put', oi: 2500, kind: 'change', prior_oi: 3000, change: -500, change_pct: -17, volume: 600 },
      { contract: 'O:AAA261218C00160000', expiration: '2026-12-18', strike: 160, type: 'call', oi: 300, kind: 'new', prior_oi: null, change: null, change_pct: null, volume: null }]
    const side = p.side || 'any'
    const matched = all.filter(r => side === 'any' || r.type === side)
    const rows = matched.slice(0, p.rows || 15)
    return { freshness: 'historical', as_of: '2026-10-30T04:00:00Z', data: { symbol: String(p.symbol || '').toUpperCase(), side, session: '2026-10-30', prior_session: '2026-10-29', skipped_sessions: [], known: true, has_symbol: true, prior_has_symbol: true,
      rows, matched: matched.length, shown: rows.length, left_out: matched.length - rows.length, max_rows: 50,
      summary: { call: { contracts: 4, oi: 9000, prior_oi: 8000, change: 1000 }, put: { contracts: 3, oi: 6500, prior_oi: 7000, change: -500 }, contracts: 7, unchanged: 5 },
      new: { contracts: 1, oi: 300 }, gone: { contracts: 0, prior_oi: null, expired: 0 }, not_reported: 0, volume_present: true, volume_session: '2026-10-29', built_at: '2026-11-03T15:30:00Z', source: 'fixture',
      coverage: 'fixture', read_at: '2026-11-03T15:40:00Z' } }
  },
  'rates.treasury': () => {
    const mat = (key, label, months, y, d1, m1) => ({ key, label, months, yield: y, was: { d1: y - d1 / 100, w1: null, m1: y - m1 / 100, m3: null, y1: null }, change_bp: { d1, w1: null, m1, m3: null, y1: null } })
    return { freshness: 'historical', as_of: '2026-10-30T04:00:00Z', data: { as_of: '2026-10-30', ref_dates: { d1: '2026-10-29', w1: null, m1: '2026-09-30', m3: null, y1: null },
      maturities: [mat('3m', '3-month', 3, 3.5, 1, -10), mat('2y', '2-year', 24, 3.75, -2, 5), mat('10y', '10-year', 120, 4.25, 3, 12)],
      spreads: [{ key: '10y2y', label: '10-year minus 2-year', long: '10y', short: '2y', value: 0.5, state: 'positive', inverted: false, days_in_state: 40, since: '2026-09-03', days_at_least: false,
        was: { d1: 0.45, w1: null, m1: 0.43, m3: null, y1: null }, change_bp: { d1: 5, w1: null, m1: 7, m3: null, y1: null } },
      { key: '10y3m', label: '10-year minus 3-month', long: '10y', short: '3m', value: 0.75, state: 'positive', inverted: false, days_in_state: 12, since: '2026-10-14', days_at_least: false,
        was: { d1: 0.73, w1: null, m1: 0.53, m3: null, y1: null }, change_bp: { d1: 2, w1: null, m1: 22, m3: null, y1: null } }],
      history: { from: '2025-10-30', to: '2026-10-30', points: 250, years: 1, columns_left_out: true }, rows: 250, read_at: '2026-11-03T15:40:00Z', basis: 'fixture', units: 'fixture', source: 'fixture', check: null } }
  },
  // Terminal data wave 7 (dark kinds `market.regime`, `stock.setups`, `stock.eventsTimeline`, `uct20.list`, `options.ivHistory`,
  // `dilution.watch`; MD-1 §4.16): the same rule — each adapter's own data shape, made-up names and figures. `as_of` is the
  // data's own date (the time the read was computed, the newest bar judged, the newest event, the wire run, the newest
  // logged session, the newest filing; never the day of the read).
  'market.regime': () => ({ freshness: 'periodic', as_of: '2026-11-03T15:30:00Z', data: { regime: 'made_up_regime', label: 'Made-up regime', band: 'YELLOW', confidence: 0.6,
    signals: { pct_above_50ma: 48, pct_above_200ma: 61, new_highs: 40, new_lows: null, distribution_days: 4, market_phase: 'Made-up phase' },
    reasons: ['a made-up reason line'], reasons_left_out: 1, left_out: ['uct_exposure_rating', 'vix'], vocabulary_version: 'fixture', computed_at: '2026-11-03T15:30:00Z' } }),
  'stock.setups': (p) => {
    const all = [{ setup: 'made_up_base', name: 'Made-up base', asof_date: '2026-10-30', confidence: 82, key_level: 105.5, checks_passed: 5, checks_made: 6 },
      { setup: 'made_up_flag', name: 'Made-up flag', asof_date: '2026-10-28', confidence: 64, key_level: null, checks_passed: 3, checks_made: 4 }]
    const rows = all.slice(0, p.rows || 10)
    return { freshness: 'historical', as_of: '2026-10-30T04:00:00Z', data: { symbol: String(p.symbol || '').toUpperCase(), tf: 'D', rows, count: rows.length, confirmed_total: all.length, cut: rows.length < all.length,
      evaluated: 5, window_days: 10, min_confidence: 50, as_of: '2026-10-30', judged_at: '2026-10-30T21:30:00Z', expected_session: '2026-10-30', left_out: ['rationale', 'checks'] } }
  },
  'stock.eventsTimeline': (p) => {
    const all = [{ date: '2026-11-12', kind: 'earnings', title: 'Made-up scheduled report', detail: null, source: 'earnings', print_date: '2026-11-12', print_label: 'Q3', print_state: 'scheduled', offset: 0, stage: 'T' },
      { date: '2026-10-29', kind: 'filing', title: 'Made-up filing', detail: 'Form 8-K', source: 'filing', print_date: '2026-11-12', print_label: 'Q3', print_state: 'scheduled', offset: -10, stage: 'T-10' },
      { date: '2026-08-13', kind: 'earnings', title: 'Made-up earnings report', detail: 'a made-up detail', source: 'earnings', print_date: '2026-08-13', print_label: 'Q2', print_state: 'reported', offset: 0, stage: 'T' }]
    const rows = all.slice(0, p.rows || 20)
    return { status: 'partial', freshness: 'historical', as_of: '2026-10-29T04:00:00Z', data: { symbol: String(p.symbol || '').toUpperCase(), staged: true, reason: null, offset_unit: 'weekdays (fixture)',
      prints: [{ date: '2026-11-12', label: 'Q3', state: 'scheduled' }, { date: '2026-08-13', label: 'Q2', state: 'reported' }], rows, count: rows.length, total: all.length, cut: rows.length < all.length,
      sources: { earnings: 'ok', uct_catalyst: 'empty', filing: 'ok', room_spike: 'not_held' }, as_of: '2026-10-29', left_out: ['thesis', 'url'] } }
  },
  'uct20.list': (p) => {
    const all = [{ rank: 1, symbol: 'AAA', rs: 97, score: 88, ret_1m: 12.5, ret_3m: 40.25, earnings_date: '2026-11-18' },
      { rank: 2, symbol: 'BBB', rs: 95, score: 84, ret_1m: -2, ret_3m: 18, earnings_date: null },
      { rank: 3, symbol: 'CCC', rs: null, score: 80, ret_1m: null, ret_3m: null, earnings_date: null }]
    const rows = all.slice(0, p.rows || 20)
    return { freshness: 'historical', as_of: '2026-11-03T04:00:00Z', data: { rows, count: rows.length, total: all.length, cut: rows.length < all.length, as_of: '2026-11-03', status: 'fresh', held_since: null,
      pending_removed: 1, left_out: ['entry', 'stop', 'target_1', 'target_2', 'portfolio', 'nav', 'price', 'change', 'thesis', 'company_desc'] } }
  },
  'options.ivHistory': (p) => {
    const all = [{ date: '2026-10-30', atm_iv: 0.425, atm_dte: 28, atm_expiration: '2026-11-27', rule: 'closest-30', complete: true },
      { date: '2026-10-29', atm_iv: null, atm_dte: null, atm_expiration: null, rule: 'closest-30', complete: false },
      { date: '2026-10-28', atm_iv: 0.4, atm_dte: 30, atm_expiration: '2026-11-27', rule: 'closest-30', complete: true }]
    const rows = all.slice(0, p.rows || 20)
    return { freshness: 'historical', as_of: '2026-10-30T04:00:00Z', data: { symbol: String(p.symbol || '').toUpperCase(), rows, count: rows.length, total: all.length, cut: rows.length < all.length, as_of: '2026-10-30',
      logging_began: '2026-10-28', covers_from: '2026-10-28', covers_to: '2026-10-30', sessions_logged: 3, sessions_with_iv: 2, missing_sessions: 0, rank: null, rank_note: '3 sessions logged, rank needs 20.',
      rank_min_sessions: 20, partial: false, partial_reasons: [], expected_session: '2026-10-30', source: 'fixture' } }
  },
  'dilution.watch': (p) => {
    const all = [{ date: '2026-10-21', form: '424B5', kind: 'offering', what: 'Made-up prospectus supplement', under: { form: 'S-3', filed: '2025-06-02', shelf: true } },
      { date: '2026-03-10', form: '8-K', kind: 'unregistered', what: 'Made-up unregistered sale', under: null },
      { date: '2025-06-02', form: 'S-3', kind: 'registration', what: 'Made-up shelf registration', under: null }]
    const rows = all.slice(0, p.rows || 15)
    return { freshness: 'historical', as_of: '2026-10-27T04:00:00Z', data: { symbol: String(p.symbol || '').toUpperCase(), state: 'ok', company: 'Made-up Company Inc', fund_like: false,
      window: { years: 3, from: '2023-11-03', to: '2026-11-03', recent_months: 12, recent_from: '2025-11-03' }, coverage: { complete: true, from: '2023-11-03', pages_unread: 0 }, newest_filing: '2026-10-27',
      summary: { live_shelves: 1, pending_shelves: 0, offerings: { m12: 1, y3: 1, latest: '2026-10-21' }, unregistered: { m12: 1, y3: 1, latest: '2026-03-10' }, registrations: { m12: 0, y3: 1, latest: '2025-06-02' } },
      shelves: [{ form: 'S-3', filed: '2025-06-02', effective: '2025-06-20', expires_estimate: '2028-06-20', state: 'live', offerings: 1, latest_offering: '2026-10-21' }],
      rows, count: rows.length, total: all.length, cut: rows.length < all.length, as_of: '2026-10-27', read_at: '2026-11-03T15:40:00Z', last_good: false } }
  },
  // Terminal data wave 8 (dark kinds `stock.corporateActions`, `calendar.ipos`, `calendar.dividends`; MD-1 §4.17): the same
  // rule — each adapter's own data shape, made-up names, tickers, dates and figures. `as_of` is the data's own date (the newest
  // event of the corporate actions record), or null where the data has none (the two forward calendars), with the time UCT
  // read it beside it; never the day of the read.
  'stock.corporateActions': (p) => {
    const splits = [{ date: '2019-05-14', ratio: '3:2', to_factor: 1.5 }].slice(0, p.rows || 12)
    const dividends = [{ date: '2026-08-14', amount: 0.1375 }, { date: '2026-05-15', amount: 0.13 }].slice(0, p.rows || 12)
    return { freshness: 'historical', as_of: '2026-08-14T04:00:00Z', data: { symbol: String(p.symbol || '').toUpperCase(), state: 'ok',
      splits: { rows: splits, count: splits.length, total: 1, cut: splits.length < 1, window_years: 45, as_of: '2019-05-14' },
      dividends: { rows: dividends, count: dividends.length, total: 2, cut: dividends.length < 2, window_years: 5, as_of: '2026-08-14', basis: 'split_adjusted' },
      as_of: '2026-08-14', read_at: '2026-11-03T15:40:00Z', left_out: ['names'] } }
  },
  'calendar.ipos': (p) => {
    const ahead = [{ symbol: 'ZZQA', name: 'Made-up Robotics Inc', date: '2026-11-05', exchange: 'NASDAQ', price_range: '$18.00-$20.00', shares: 12500000, value: 250000000, status: 'expected' },
      { symbol: null, name: 'Made-up Foods Corp', date: '2026-11-10', exchange: null, price_range: null, shares: null, value: null, status: 'expected' }].slice(0, p.rows || 20)
    const earlier = [{ symbol: 'ZZQB', name: 'Made-up Bio Ltd', date: '2026-10-29', exchange: 'NASDAQ', price_range: '$21.00', shares: 8000000, value: 168000000, status: 'priced' }].slice(0, p.rows || 20)
    return { freshness: 'periodic', as_of: null, data: { window: { from: '2026-10-26', to: '2026-11-13' }, split_day: '2026-11-03',
      ahead: { rows: ahead, count: ahead.length, total: 2, cut: ahead.length < 2 }, earlier: { rows: earlier, count: earlier.length, total: 1, cut: earlier.length < 1 },
      total: 3, dropped: 0, as_of: null, read_at: '2026-11-03T15:40:00Z' } }
  },
  'calendar.dividends': (p) => {
    const symbols = Array.isArray(p.symbols) ? p.symbols : []
    const rows = symbols.flatMap(s => [{ symbol: s, type: 'dividend', date: '2026-11-20', amount: 0.26, ratio: null }, { symbol: s, type: 'split', date: '2026-12-15', amount: null, ratio: '4:1' }])
    return { freshness: 'periodic', as_of: null, data: { symbols, stocks: symbols.map(s => ({ symbol: s, state: 'complete', read_at: '2026-11-03T15:40:00Z', events: 2 })),
      rows, count: rows.length, total: rows.length, cut: false, as_of: null, read_at: '2026-11-03T15:40:00Z' } }
  },
  // Terminal data wave 9 (dark kinds `rates.auctions`, `rates.realYields`, `fed.watch`; MD-1 §4.18): the same rule — each
  // adapter's own data shape, made-up securities, dates, rates and words. `as_of` is the data's own date (the newest auction
  // record, the real curve's day), or null where each block carries its own (the Fed watch); never the day of the read.
  'rates.auctions': (p) => {
    const upcoming = [{ security_type: 'Bill', security_term: '13-Week', auction_date: '2026-11-05', issue_date: '2026-11-10', announced_date: '2026-10-30', offering_amount: 81000000000, reopening: false, cusip: null }].slice(0, p.rows || 12)
    const results = [{ security_type: 'Note', security_term: '10-Year', auction_date: '2026-10-29', issue_date: '2026-11-02', maturity_date: '2036-11-15', offering_amount: 42000000000, rate: 9.117, rate_kind: 'high_yield',
      bid_to_cover: 2.58, reopening: false, tips: false, floating_rate: false, cash_management: false, cusip: null,
      bidders: { primary_dealers: { amount: 4200000000, share: 10.0 }, direct: { amount: 8400000000, share: 20.0 }, indirect: { amount: 29400000000, share: 70.0 }, total: 42000000000 } }].slice(0, p.rows || 12)
    return { freshness: 'periodic', as_of: '2026-10-30T04:00:00Z', data: { as_of: '2026-10-30', upcoming_as_of: '2026-10-30', results_through: '2026-10-29', window_days: 45,
      upcoming: { rows: upcoming, count: upcoming.length, total: 1, cut: upcoming.length < 1 }, results: { rows: results, count: results.length, total: 1, cut: results.length < 1 },
      dropped: 0, publisher_cut: { upcoming: false, results: false }, read_at: '2026-11-03T15:40:00Z', basis: 'as_published', source: 'US Treasury Fiscal Data', check: null } }
  },
  'rates.realYields': () => {
    const mat = (key, label, months, y, d1, w1) => ({ key, label, months, yield: y, was: { d1: y == null ? null : y - d1 / 100, w1: y == null ? null : y - w1 / 100 }, change_bp: { d1: y == null ? null : d1, w1: y == null ? null : w1 } })
    const maturities = [mat('5y', '5-year', 60, 1.21, -4, 10), mat('7y', '7-year', 84, 1.43, 2, 6), mat('10y', '10-year', 120, 1.64, 4, 14), mat('20y', '20-year', 240, 2.02, 1, 3), mat('30y', '30-year', 360, null, 0, 0)]
    const be = (key, label, months, nominal, real) => ({ key, label, months, date: '2026-10-30', nominal, real, value: nominal != null && real != null ? Math.round((nominal - real) * 100) / 100 : null })
    return { freshness: 'historical', as_of: '2026-10-30T04:00:00Z', data: { as_of: '2026-10-30', ref_dates: { d1: '2026-10-29', w1: '2026-10-23' }, maturities,
      breakevens: { as_of: '2026-10-30', rows: [be('5y', '5-year', 60, 3.85, 1.21), be('7y', '7-year', 84, 3.99, 1.43), be('10y', '10-year', 120, 4.12, 1.64), be('20y', '20-year', 240, null, 2.02), be('30y', '30-year', 360, 4.61, null)] },
      rows: 40, read_at: '2026-11-03T15:40:00Z', basis: 'end_of_day', source: 'US Treasury daily par real yield curve', check: null } }
  },
  'fed.watch': (p) => {
    const speeches = [{ kind: 'speech', speaker: 'Quillfeather', title: 'Notes on Orchard Credit', where: 'the Invented Lending Forum', published: '2026-10-30T15:00:00Z', url: null }].slice(0, p.rows || 10)
    const headlines = [{ text: 'Fed\'s Quillfeather invented remark on orchards', received_at: '2026-11-03T14:05:00Z', tickers: [] }].slice(0, p.rows || 10)
    return { freshness: 'periodic', as_of: null, data: {
      statement: { state: 'ok', source: 'Federal Reserve Board', read_at: '2026-10-28T19:05:00Z', check: null, date: '2026-10-28', url: null, minutes: null,
        redline: { state: 'ok', previous: { date: '2026-09-16', url: null }, added: 1, removed: 1,
          changes: { rows: [{ text: 'The Committee voted 10-0 on this invented statement.', was: 'The Committee voted 9-1 on this invented statement.', added: 1, removed: 1 }], count: 1, total: 1, cut: false } } },
      speeches: { state: 'ok', source: 'Federal Reserve Board', read_at: '2026-11-03T15:00:00Z', rows: speeches, count: speeches.length, total: 1, cut: false, missing: [], checks: null },
      headlines: { state: 'ok', source: 'news wire', rows: headlines, count: headlines.length, matched: 1, scanned: 3000, cut: false, newest_at: '2026-11-03T14:05:00Z' },
      next_meeting: { state: 'ok', source: 'the economic calendar', date: '2026-12-09', time: '2:00 PM', event: 'FOMC Statement', label: null, days_to_go: 36 },
      rates: { state: 'ok', source: 'Federal Reserve Bank of New York', notice: 'The New York Fed notice for the two rates, invented for this fixture.',
        effective: { value: 9.12, date: '2026-11-02' }, upper: { value: 9.25, date: '2026-11-02' }, lower: { value: 9.0, date: '2026-11-02' } },
      projections: { state: 'ok', source: 'Federal Reserve Board', check: null, date: '2026-09-16', meeting: 'September 15-16', release_url: null, page_url: null,
        medians: [{ label: '2026', value: 9.4 }, { label: '2027', value: 8.9 }, { label: 'Longer run', value: 7.0 }], read_at: '2026-09-16T19:05:00Z' },
      survey: { state: 'ok', source: 'Federal Reserve Bank of New York', check: null, survey: 'October 2026', questions_sent: '2026-10-15', responses_due: '2026-10-20',
        before_meeting: { label: 'Oct. 27-28 2026', date: '2026-10-28' }, path: [{ label: 'Dec. 8-9 2026', date: '2026-12-09', median: 9.13, p25: 8.88, p75: 9.13, respondents: 29 }],
        credit: 'Invented credit line for the New York Fed survey fixture.', file_url: null, read_at: '2026-10-21T12:00:00Z' },
      as_of: null, board_cite: 'Source: Board of Governors of the Federal Reserve System.', left_out: ['statement_text', 'this_week_speakers', 'survey_distributions'] } }
  },
  // Terminal data wave 10 (dark kinds `stock.stats`, `stock.volumeFootprint`, `stock.factorExposure`, `stock.setupHistory`,
  // `company.publicRecords`, `ownership.funds`; MD-1 §4.19): the same rule — each adapter's own data shape, made-up figures,
  // dates, names and words. `as_of` is the data's own date (the newest session's close, a fund's newest report period), or
  // null where each section carries its own read time (the public records); never the day of the read.
  'stock.stats': (p) => {
    const sym = String(p.symbol || '').toUpperCase()
    const ok = (key, label, from, ret, yearly) => ({ key, label, target: from, state: 'ok', from, base_close: 10, return_pct: ret, ...(yearly == null ? {} : { yearly_pct: yearly }) })
    const episodes = [{ id: `${sym}-2025-02-03`, peak: { date: '2025-02-03', close: 52.0 }, trough: { date: '2025-04-08', close: 33.8 }, depth_pct: -35.0, sessions_down: 44,
      recovered: '2025-09-12', sessions_to_recover: 108, ongoing: false, peak_at_history_start: false, below_peak_now_pct: null, check: false }].slice(0, p.rows || 5)
    return { freshness: 'historical', as_of: '2026-10-30T20:00:00Z', data: { symbol: sym, session: '2026-10-30', data_through: '2026-10-30', first: '2020-01-02', sessions: 1720,
      read_at: '2026-11-03T15:40:00Z', source: 'UCT stored daily prices (made-up fixture)', basis: 'daily close, split-adjusted, not dividend-adjusted (price return)', suspect_jump_pct: 40, suspect_jumps: [],
      volatility: { as_of: '2026-10-30', close: 41.25, sessions: 1720, atr: { state: 'ok', period: 14, value: 1.2345, pct: 2.99 },
        realized: [{ state: 'ok', sessions: 20, pct: 38.4 }, { state: 'ok', sessions: 60, pct: 41.2 }], realized_method: 'made-up method words',
        adr: { state: 'ok', sessions: 21, pct: 3.41, dollars: 1.3 },
        range_52w: { state: 'ok', high: 48.5, high_date: '2026-07-14', low: 30.1, low_date: '2026-01-08', from_high_pct: -14.95, from_low_pct: 37.04 },
        volume: { last: 1200000, last_date: '2026-10-30', avg: { 20: 1500000, 50: 1400000 }, rel: 0.8, rel_base_sessions: 30 },
        days_1y: { state: 'ok', from: '2025-10-30', total: 251, up: 130, down: 118, flat: 3, up_pct: 51.8, down_pct: 47.0 } },
      beta: { as_of: '2026-10-30', window: 252, min: 200, capture_min_days: 20,
        spy: { symbol: 'SPY', state: 'ok', returns: 252, from: '2025-10-30', to: '2026-10-30', beta: 1.42, correlation: 0.71, up_capture: 131.5, up_capture_days: 133, down_capture: 118.2, down_capture_days: 119 },
        sector: { state: 'not_mapped', sector: 'Made-up Sector' } },
      returns: { as_of: '2026-10-30', close: 41.25, week_complete: true,
        periods: [ok('1W', '1 week', '2026-10-23', 3.13), ok('1M', '1 month', '2026-09-30', -2.4), ok('3M', '3 months', '2026-07-30', 8.9), ok('6M', '6 months', '2026-04-30', 12.0),
          ok('YTD', 'Year to date', '2025-12-31', 15.5), ok('1Y', '1 year', '2025-10-30', 21.7), ok('3Y', '3 years', '2023-10-30', 60.2, 17.0),
          { key: '5Y', label: '5 years', target: '2021-10-29', state: 'short', needed_from: '2021-10-29', held_from: '2020-01-02' }],
        extremes: { year: { state: 'ok', from: '2025-10-30', best_day: { date: '2026-04-09', return_pct: 9.8, check: false }, worst_day: { date: '2026-03-10', return_pct: -7.1, check: false } },
          all: { state: 'ok', from: '2020-01-02', best_day: { date: '2020-03-24', return_pct: 14.2, check: false }, worst_day: { date: '2020-03-16', return_pct: -12.9, check: false } } } },
      drawdowns: { as_of: '2026-10-30', first: '2020-01-02', min_depth_pct: 20, high: { date: '2026-07-14', close: 48.1, from_high_pct: -14.24 }, total: 1, shown: episodes.length,
        ongoing: 0, recovered: 1, median_depth_pct: -35.0, median_recovery_sessions: 108, deepest: episodes[0] || null, episodes },
      corrections: { index: 'S&P 500', first: '2020-01-02', as_of: '2026-10-30', state: 'ok', index_first: '1990-01-02', index_through: '2026-10-30', built_at: '2026-10-31T00:20:00+00:00',
        definition: 'Made-up definition words.', before_history: 2,
        summary: { count: 3, fell_less: 1, fell_more: 2, median_ratio: 1.6, new_high_first: 1, new_high_judged: 3, after_beat: 2, after_count: 3, median_after_vs_index_pts: 4.2 } },
      stale_for: [], left_out: ['correction_episodes'] } }
  },
  'stock.volumeFootprint': (p) => {
    const pivots = [{ date: '2026-10-27', change_pct: 3.4, volume: 2100000, down_max: 1500000, vs_down_max: 1.4, ma: 40.1, above_ma_pct: 2.1, earnings: false },
      { date: '2026-09-15', change_pct: 2.2, volume: 1800000, down_max: 1600000, vs_down_max: 1.13, ma: 38.0, above_ma_pct: 1.4, earnings: null }].slice(0, p.rows || 5)
    const gaps = [{ date: '2026-10-21', up: true, gap_pct: 4.1, prior_date: '2026-10-20', prior_close: 39.0, open: 40.6, close: 41.0, close_vs_open_pct: 1.0, filled: null,
      sessions_to_fill: null, sessions_since: 7, earnings: true, check: false }].slice(0, p.rows || 5)
    const side = (count, open) => ({ count, open, within_5: { filled: count - open, judged: count, pct: count ? Math.round((count - open) / count * 1000) / 10 : null },
      within_20: { filled: count - open, judged: count, pct: count ? Math.round((count - open) / count * 1000) / 10 : null }, earnings: 1, earnings_known: count })
    return { freshness: 'historical', as_of: '2026-10-30T20:00:00Z', data: { symbol: String(p.symbol || '').toUpperCase(), session: '2026-10-30', data_through: '2026-10-30', first: '2020-01-02',
      sessions: 1720, read_at: '2026-11-03T15:40:00Z', source: 'UCT stored daily prices and volumes (made-up fixture)', basis: 'made-up basis words', suspect_jump_pct: 40,
      earnings: { state: 'not_held', source: 'made-up earnings source' },
      accumulation: { as_of: '2026-10-30', min_move_pct: 0.2, windows: [{ state: 'ok', sessions: 25, from: '2026-09-25', accumulation: 7, distribution: 4, net: 3, not_judged: 0 },
        { state: 'ok', sessions: 50, from: '2026-08-20', accumulation: 12, distribution: 9, net: 3, not_judged: 0 }],
        updown: { state: 'ok', sessions: 50, from: '2026-08-20', up_volume: 41000000, down_volume: 30000000, up_sessions: 27, down_sessions: 22, flat_sessions: 1, no_volume: 0, ratio: 1.37 } },
      pivots: { as_of: '2026-10-30', from: '2025-10-30', full_year: true, held_from: '2020-01-02', lookback: 10, ma: 10, state: 'ok', judged_from: '2025-10-31', count: 2, up_days: 130,
        not_judged: 0, earnings: 0, rows: pivots, last: pivots[0] ? pivots[0].date : null },
      gaps: { as_of: '2026-10-30', first: '2020-01-02', min_gap_pct: 3.0, windows: [5, 20], shown_max: 60, state: 'ok', total: 1, shown: gaps.length, rows: gaps,
        summary: { all: side(1, 1), up: side(1, 1), down: side(0, 0) } },
      stale_for: [], left_out: ['big_days', 'ad_days'] } }
  },
  'stock.factorExposure': (p) => {
    const row = (key, loading, t, clears, extra = {}) => ({ key, loading, se: 0.1, t, clears, correlation: 0.5, vif: 2.1, ...extra })
    return { freshness: 'historical', as_of: '2026-10-30T20:00:00Z', data: { symbol: String(p.symbol || '').toUpperCase(), session: '2026-10-30', data_through: '2026-10-30',
      read_from: '2024-08-01', sessions_read: 564, read_at: '2026-11-03T15:40:00Z', source: 'UCT stored daily prices (made-up fixture)', basis: 'made-up basis words', suspect_jump_pct: 40,
      method: { window: 252, min: 200, t_bar: 2.0, vif_unstable: 5.0, fund_min_closes: 201, fund_full_closes: 505, index: 'S&P 500', annualise_days: 252, max_lag_days: 10 },
      factors: ['market', 'size', 'growth', 'momentum', 'quality', 'lowvol'].map(key => ({ key, name: { market: 'Market', size: 'Size', growth: 'Growth vs value', momentum: 'Momentum', quality: 'Quality', lowvol: 'Low volatility' }[key],
        state: 'ok', funds: key === 'market' ? ['SPY'] : key === 'growth' ? ['IWF', 'IWD'] : [{ size: 'IWM', momentum: 'MTUM', quality: 'QUAL', lowvol: 'USMV' }[key], 'SPY'],
        primary: [], alternative: [], positive: 'made-up positive', negative: 'made-up negative' })),
      common_returns: 520, common_from: '2024-08-02', common_to: '2026-10-30',
      now: { state: 'ok', returns: 252, from: '2025-10-30', to: '2026-10-30', full: true, exact: false,
        loadings: [row('market', 1.31, 12.4, true, { t_vs_one: 2.9, side: 'more' }), row('size', 0.05, 0.4, false), row('growth', 0.88, 3.1, true), row('momentum', 0.71, 2.6, true),
          row('quality', -0.1, -0.6, false), row('lowvol', 0.02, 0.1, false)],
        constant: { daily_pct: 0.021, yearly_pct: 5.3, t: 0.9, clears: false }, r2: 0.61, adj_r2: 0.6, explained_pct: 61.0, own_pct: 39.0,
        volatility: { total_pct: 42.0, factors_pct: 32.8, own_pct: 26.2 }, market_beta_alone: 1.36, max_vif: { key: 'momentum', value: 2.8 }, unstable: false, check: [] },
      reading: { text: 'Made-up reading: it trades like a high-momentum growth stock with more market sensitivity than the S&P 500.', basis: [], uncertain: ['size', 'quality', 'lowvol'], exact: false },
      stale_for: [], left_out: ['then', 'change', 'reading_then', 'fund_checks'] } }
  },
  'stock.setupHistory': (p) => {
    const sig = (date, setup, phase, r5, r20, r60) => ({ date, setup, phase, returns: { 5: r5, 20: r20, 60: r60 } })
    const signals = [sig('2026-10-14', 'made_up_breakout', 'uptrend', 2.1, null, null), sig('2026-06-02', 'made_up_pullback', 'after_low', -1.2, 4.4, 9.8)]
    return { freshness: 'historical', as_of: '2026-10-30T20:00:00Z', data: { symbol: String(p.symbol || '').toUpperCase(), session: '2026-10-30', data_through: '2026-10-30', first: '2020-01-02',
      sessions: 1720, read_at: '2026-11-03T15:40:00Z', source: 'UCT stored daily prices (made-up fixture)', horizons: [5, 20, 60],
      phases: { state: 'ok', index: 'S&P 500', first: '1990-01-02', last: '2026-10-30', episodes: 9, hindsight: 'Made-up hindsight words.' },
      total: 2, shown: 2, signals, per_setup: { made_up_breakout: 1, made_up_pullback: 1 },
      library: [{ id: 'made_up_breakout', name: 'Made-up breakout', words: 'made-up rule words' }, { id: 'made_up_pullback', name: 'Made-up pullback', words: 'made-up rule words' }],
      setups: [{ id: 'made_up_breakout', state: 'ok', signals: 1 }, { id: 'made_up_pullback', state: 'ok', signals: 1 }],
      universe: { state: 'ok', window: { from: '2018-10-27', to: '2026-10-30', first_day: '2018-10-29', years: 8 }, built_at: '2026-11-01T02:00:00+00:00', min_signals: 30, note: 'made-up caveat',
        lines: { 'made_up_breakout|uptrend': { signals: 900, horizons: { 20: { n: 880, below_floor: false, win_rate: 56.0, avg_pct: 1.9, median_pct: 1.1, excess_pct: 0.6 } } },
          'made_up_pullback|after_low': { signals: 12, horizons: { 20: { n: 12, below_floor: true, win_rate: null, avg_pct: null, median_pct: null, excess_pct: null } } } } },
      one_signal_per_run: 'Made-up run words.', fill: 'Made-up fill words.', stale_for: [] } }
  },
  'company.publicRecords': (p) => {
    const credit = { contracts: 'Recipient names come in part from D&B Open Data (Dun & Bradstreet).', trials: 'Data from ClinicalTrials.gov; the titles, statuses, phases, conditions, dates and enrollment are shown as registered, and no text is changed.',
      fda: 'Data provided by the U.S. Food and Drug Administration.', lobbying: 'Senate Office of Public Records cannot vouch for the data or analyses derived from these data after the data have been retrieved from LDA.gov.' }
    const names = [{ name: 'Made-up Dynamics Corp', source: 'sec', source_words: 'the SEC name', until: null }]
    const base = (k, state) => ({ source: `${k} source (made-up)`, source_url: null, credit: credit[k], state, read_at: '2026-11-03T15:40:00Z', searched_for: 'MADE-UP DYNAMICS', names,
      counted: state === 'matched' ? [{ name: 'MADE-UP DYNAMICS CORP', how: 'same', how_words: 'the same name', against: 'Made-up Dynamics Corp', amount: null, prior_amount: null, records: 1 }] : [],
      counted_total: state === 'matched' ? 1 : 0, not_counted_total: 0, dropped: 0, check: null })
    return { freshness: 'periodic', as_of: null, data: { symbol: String(p.symbol || '').toUpperCase(), as_of: null,
      company: { state: 'ok', cik: '0009990001', names, read_at: '2026-11-03T15:30:00Z', source: 'made-up company source' },
      contracts: { ...base('contracts', 'matched'), recent_total: 4200000.0, prior_total: 3100000.0, windows: { recent: ['2025-11-03', '2026-11-03'], prior: ['2024-11-03', '2025-11-02'] },
        recipients_more: false, awards_more: false, awards: [{ award_id: 'MADE1', recipient: 'MADE-UP DYNAMICS CORP', date: '2026-08-14', amount: 1500000.0, agency: 'Department of Made-up Affairs',
          sub_agency: null, description: 'Made-up widgets', description_cut: false, place: null, kind: 'Definitive contract', url: null }], awards_held: 1 },
      trials: { ...base('trials', 'no_match'), active_matched: 0, closed_matched: 0, active_total: 0, active_read: 0, by_phase: {}, by_status: {}, data_processed: '2026-11-02T10:00:05', closed_since: '2025-11-03', active: [], active_held: 0 },
      fda: { source: 'fda source (made-up)', source_url: null, credit: credit.fda, state: 'not_held' },
      lobbying: { ...base('lobbying', 'matched'), quarters: [{ year: 2026, quarter: 3, label: 'Q3 2026', ends: '2026-09-30', due: '2026-10-20', reports_due: false, filings: 2, own: 120000.0,
        own_reports: 1, own_no_figure: 0, firms: 40000.0, firm_reports: 1, firms_no_figure: 0, firm_names: ['MADE-UP FIRM'], issues: [{ issue: 'Made-up issue', filings: 2 }], issues_more: 0 }],
        cut: false, filings_read: 2 } } }
  },
  'ownership.funds': (p) => {
    const holders = [{ name: 'Made-up Total Market Index Fund', family: 'Made-up Trust', shares: 1000000, value: 41000000, pct: 0.42, period: '2026-06-30', prior_shares: 900000,
      prior_value: 36000000, prior_period: '2026-03-31', change_shares: 100000, change_pct: 11.11, state: 'added', url: null },
      { name: 'Made-up Growth Fund', family: 'Made-up Funds', shares: 500000, value: 20500000, pct: 1.9, period: '2026-07-31', prior_shares: null, prior_value: null, prior_period: null,
        change_shares: null, change_pct: null, state: 'new', url: null }].slice(0, p.rows || 10)
    return { freshness: 'periodic', as_of: '2026-07-31T04:00:00Z', data: { symbol: String(p.symbol || '').toUpperCase(), state: 'ok', source: 'SEC Form N-PORT (public; filed 60 days after each quarter-end month)',
      data_set: { quarter: '2026Q3', prior_quarter: '2026Q2', built_at: '2026-11-01T05:10:00+00:00', periods: { from: '2026-06-30', to: '2026-07-31', funds: 2, funds_with_previous: 1 }, prior_missing: null,
        splits: { state: 'ok' } },
      coverage: { matched_value_pct: 91.4, matched_rows_pct: 80.0, pct_units: 'assumed_percent' },
      summary: { funds: 2, shares: 1500000, value: 61500000, value_complete: true, added: 1, cut: 0, unchanged: 0, new: 1, no_prior: 0, not_comparable: 0, sold_out: 0,
        both_now: 1500000, both_prior: 900000, period_from: '2026-06-30', period_to: '2026-07-31', tier: 'fund_ticker', votes: 2 },
      holders, holders_total: 2, holders_limit: 50, sold_out: [], sold_out_total: 0, check: null } }
  },
  // Terminal data wave 11 (dark kinds `groups.rank`, `groups.crowding`, `earnings.seasonBySector`, `estimates.revisionBreadth`,
  // `options.ivRankLeaders`, `ipo.lockups`, `cot.byTrader`; MD-1 §4.20): the same rule — each adapter's own data shape, made-up
  // figures, dates, names and words. `as_of` is the data's own date (the newest session's close, the newest held copy or
  // snapshot, the listings scan's time, the report's Tuesday), or null where each part carries its own (the crowding).
  'groups.rank': (p) => {
    const pt = (position, of, n, median, date, change) => ({ position, of, n, median, date, ...(change === undefined ? {} : { change }) })
    const measure = (now, w4, w13, w52, best, worst) => ({ now, w4, w13, w52, best, worst, weeks_ranked: 50 })
    const g = (name, members, m6) => ({ name, members, rank: { m6, m3: m6 } })
    const groups = [
      g('Made-up Software', 120, measure(pt(1, 3, 118, 14.2, '2026-10-30'), pt(3, 3, 117, 6.1, '2026-10-02', 2), pt(2, 3, 115, 4.0, '2026-07-31', 1), pt(3, 3, 110, -2.0, '2025-10-31', 2),
        pt(1, 3, 118, 14.2, '2026-10-30'), pt(3, 3, 110, -2.0, '2025-10-31'))),
      g('Made-up Energy', 60, measure(pt(2, 3, 58, 3.3, '2026-10-30'), pt(1, 3, 58, 9.0, '2026-10-02', -1), pt(1, 3, 57, 8.0, '2026-07-31', -1), pt(1, 3, 55, 7.0, '2025-10-31', -1),
        pt(1, 3, 55, 7.0, '2025-10-31'), pt(3, 3, 50, -5.0, '2026-03-06'))),
      g('Made-up Utilities', 4, measure(pt(null, 3, 4, null, '2026-10-30'), null, null, null, null, null)),
    ].slice(0, p.rows || 10)
    const mover = (name, change, from, to) => ({ name, change, from: pt(from, 3, 100, 1.0, '2026-10-02', change), to: pt(to, 3, 100, 2.0, '2026-10-30') })
    return { freshness: 'historical', as_of: '2026-10-30T20:00:00Z', data: { kind: p.kind || 'sector', session: '2026-10-30', built_for: '2026-10-30', built_at: '2026-10-31T00:40:00Z',
      rank: { state: 'ok', weeks: 52, min_members: 5, measures: [{ id: 'm6', sessions: 126 }, { id: 'm3', sessions: 63 }], first_week: '2025-10-31' },
      universe: { symbols: 3500, mapped: 3400, not_mapped: 100 }, stale_for: [], left_out: ['weekly_line', 'fundamentals', 'breadth'],
      groups, groups_total: 3, ranked_now: 2,
      movers: { w4: { up: [mover('Made-up Software', 2, 3, 1)], down: [mover('Made-up Energy', -1, 1, 2)], counted: 2 }, w13: { up: [mover('Made-up Software', 1, 2, 1)], down: [], counted: 2 } } } }
  },
  'groups.crowding': (p) => {
    const sum = (n, median) => ({ n, median, q1: null, q3: null })
    const groups = [
      { name: 'Made-up Software', members: 120, positioning: { short: { reported: 118, pct_float: sum(118, 6.4), days_to_cover: sum(118, 2.5), change: sum(110, 3.1),
        top: [{ sym: 'QZSA', pct_float: 31.5, days_to_cover: 6.2 }] }, insider: { members: 120, buyers: { n: 120, count: 9, share: 7.5 }, purchases: 14, value: 4200000, unpriced: 1,
        top: [{ sym: 'QZSB', value: 1500000, date: '2026-10-20', role: 'director' }] }, funds: { held: 118, known: 110, adding: { n: 110, count: 66, share: 60.0 }, net: sum(110, 2.2) } } },
      { name: 'Made-up Utilities', members: 4, positioning: { short: { reported: 4, pct_float: sum(4, null), days_to_cover: sum(4, null), change: sum(4, null), top: [] },
        insider: { members: 4, buyers: { n: 4, count: 0, share: null }, purchases: 0, value: null, unpriced: 0, top: [] }, funds: { held: 4, known: 4, adding: { n: 4, count: 2, share: null }, net: sum(4, null) } } },
    ].slice(0, p.rows || 10)
    return { freshness: 'periodic', as_of: null, data: { kind: p.kind || 'sector', built_for: '2026-10-30', built_at: '2026-10-31T00:40:00Z', session: '2026-10-30',
      parts: { short: { state: 'ok', settlement_date: '2026-10-15', previous_settlement_date: '2026-09-30', covered: 3000, universe: 3400 },
        insider: { state: 'ok', from: '2026-10-01', to: '2026-10-30', complete: true, keep_days: 30, matched: 400, universe: 3400 },
        funds: { state: 'ok', quarter: '2026Q3', prior_quarter: '2026Q2', period_from: '2026-06-30', period_to: '2026-07-31', covered: 2900, known: 2700, universe: 3400 } },
      min_members: 5, top_n: 3, institutions: 'not_held', stale_for: [], left_out: ['institutions', 'rank', 'fundamentals', 'breadth'],
      groups, groups_total: 2, with_figure: 1 } }
  },
  'earnings.seasonBySector': (p) => {
    const m = (n, beat, inl, miss, median) => ({ n, beat, in_line: inl, miss, none: 0, beat_pct: n >= 5 ? Math.round(beat / n * 1000) / 10 : null, in_line_pct: n >= 5 ? Math.round(inl / n * 1000) / 10 : null,
      miss_pct: n >= 5 ? Math.round(miss / n * 1000) / 10 : null, median: n >= 5 ? median : null, median_n: n })
    const fig = (name, reported, eps, rev, move, yearAgo) => ({ ...(name ? { name, on_file: true } : {}), reported, to_report: 2, awaiting: 1, eps, rev,
      move: { n: reported, median: reported >= 5 ? move : null, rose: Math.floor(reported / 2), rose_pct: reported >= 5 ? 50.0 : null, not_settled: 0, not_measured: 0 }, year_ago: yearAgo })
    const ago = (name) => fig(name, 40, m(40, 28, 4, 8, 3.0), m(40, 24, 6, 10, 1.0), 0.5, undefined)
    const sectors = [fig('Made-up Software', 40, m(40, 32, 4, 4, 5.2), m(40, 30, 5, 5, 1.8), 1.4, ago('Made-up Software')),
      fig('Made-up Utilities', 3, m(3, 2, 1, 0, 1.0), m(3, 2, 1, 0, 0.4), 0.2, ago('Made-up Utilities'))]
    const season = p.season || 'current'
    return { freshness: 'periodic', as_of: '2026-11-02T05:00:00Z', data: { season,
      seasons: { current: { label: 'Q3 2026', from: '2026-10-01', to: '2026-12-31', through: '2026-11-02', complete: false },
        previous: { label: 'Q2 2026', from: '2026-07-01', to: '2026-09-30', through: '2026-09-30', complete: true },
        year_ago: { label: 'Q3 2025', from: '2025-10-01', to: '2025-12-31', through: '2025-12-31', complete: true } },
      today: '2026-11-03', built_at: '2026-11-03T15:30:00Z',
      coverage: { universe: 3500, held: 3300, not_held: 200, no_sector: 0, oldest_copy: '2026-10-28', newest_copy: '2026-11-02', copies_old: 0, old_days: 7 },
      total: fig(null, 43, m(43, 34, 5, 4, 5.0), m(43, 32, 6, 5, 1.7), 1.3, season === 'current' ? ago(null) : null), sectors, count: 2,
      in_line_pct: 0.5, in_line_abs: 0.005, min_reporters: 5, season_rule: 'Made-up season rule words.', stale_for: [], left_out: ['reporters', 'upcoming', 'late'] } }
  },
  'estimates.revisionBreadth': (p) => {
    const c = (name, up, down, held, net, raises, cuts) => ({ ...(name ? { name, on_file: true } : {}), members: up + down + held + 1, counted: up + down + held, up, down, held,
      not_counted: { collecting: 1, gap: 0, not_comparable: 0 }, net, raises, cuts })
    return { freshness: 'periodic', as_of: '2026-11-02T05:00:00Z', data: { metric: p.metric || 'eps', window: p.window || 30, asof: '2026-11-02', covers_from: '2026-03-02',
      built_at: '2026-11-03T15:30:00Z', tracked: { n: 52, cap: 600, origins: { sp500: 50, viewed: 2 }, no_sector: 0 }, tolerance_pct: 0.5, slack_days: 4, min_counted: 5, top_n: 3,
      total: c(null, 30, 10, 8, 41.7, [], []),
      sectors: [c('Made-up Software', 20, 4, 4, 57.1, [{ symbol: 'QZRA', pct: 12.5 }], [{ symbol: 'QZRB', pct: -3.0 }]), c('Made-up Utilities', 1, 1, 1, null, [], [])],
      count: 2, left_out: ['symbols'] } }
  },
  'options.ivRankLeaders': (p) => {
    const row = (symbol, rank, pctile, iv, low, high) => ({ symbol, atm_iv: iv, iv_rank: rank, iv_percentile: pctile, rank_word: rank >= 50 ? 'high' : 'low', low, high, sessions: 180, atm_dte: 30, open_interest: 150000 })
    const side = p.side || 'both'
    return { freshness: 'historical', as_of: '2026-10-30T20:00:00Z', data: { side, session: '2026-10-30', built_at: '2026-10-31T00:45:00Z', data_basis: 'end-of-day snapshot',
      logging_began: '2026-03-02', sessions_logged: 170, rankable_sessions: 168, legacy_sessions: [], unread_sessions: [], missing_sessions: [], missing_total: 0,
      counts: { ranked: 4100, below_min: 300, flat: 12, not_in_latest: 40, latest_rows: 4500, latest_no_atm_iv: 60, symbols_logged: 4452 },
      high: side === 'low' ? [] : [row('QZHA', 98, 97, 0.82, 0.35, 0.84)].slice(0, p.rows || 10), low: side === 'high' ? [] : [row('QZLA', 1, 2, 0.15, 0.14, 0.6)].slice(0, p.rows || 10),
      rank_min_sessions: 20, rank_window: 252, max_per_side: 100, next_run: '2026-11-03T20:45-05:00', last_run: { ok: true, at: '2026-10-31T00:45:00Z' }, stale_for: [] } }
  },
  'ipo.lockups': (p) => {
    const row = (symbol, company, listing, expiry, days, pct, reason) => ({ symbol, company, listing_date: listing, listing_source: 'first_bar', estimated_expiry: expiry, days_to_go: days, basis: 'estimated',
      change_since_listing: { pct, first_close: pct === null ? null : 10.0, first_date: pct === null ? null : listing, last_close: pct === null ? null : 12.3, last_date: pct === null ? null : '2026-11-02', reason } })
    return { freshness: 'periodic', as_of: '2026-11-03T14:58:00Z', data: { today: '2026-11-03', window: { from: '2026-10-27', to: '2026-12-03', behind_days: 7, ahead_days: 30 },
      lockup_days: 180, basis: 'estimated', basis_words: 'estimated: 180 days after listing; the prospectus sets the actual date', built_at: '2026-11-03T15:00:00Z',
      listings_as_of: '2026-11-03T14:58:00Z', counts: { listings: 140, with_listing_date: 138, without_listing_date: 2, in_window: 2, by_source: { first_bar: 2, relisting: 0, reference: 0, unknown: 0 } },
      rows: [row('QZIB', null, '2026-04-30', '2026-10-27', -7, null, 'no_closes'), row('QZIA', 'Made-up Robotics Inc', '2026-05-28', '2026-11-24', 21, 23.0, null)].slice(0, p.rows || 10),
      stale_for: [] } }
  },
  'cot.byTrader': (p) => {
    const cls = (long, short, spread) => ({ long, short, spread, traders_long: 40, traders_short: 30, traders_spread: spread === null ? null : 10 })
    if (!p.market) {
      return { freshness: 'periodic', as_of: '2026-10-27T04:00:00Z', data: { market: null, watch: { tff: 'leveraged_funds', disaggregated: 'managed_money' },
        markets: { ES: { report: 'tff', watch: 'leveraged_funds', name: 'Made-up Index Future', date: '2026-10-27', open_interest: 2000000, long: 300000, short: 500000, spread: 10000,
          previous: { date: '2026-10-20', open_interest: 1990000, long: 310000, short: 480000, spread: 9000 } },
        GC: { report: 'disaggregated', watch: 'managed_money', name: 'Made-up Metal Future', date: '2026-10-27', open_interest: 500000, long: 200000, short: 50000, spread: 20000, previous: null } },
        no_record: [], newest: '2026-10-27', credit: 'Source: CFTC Commitments of Traders (Traders in Financial Futures / Disaggregated), as of the Tuesday it covers, published the following Friday.',
        stale_for: [], left_out: ['range'] } }
    }
    const keys = ['dealer', 'asset_manager', 'leveraged_funds', 'other_reportable', 'nonreportable']
    const week = (date, oi, lev) => ({ date, open_interest: oi, traders_total: 500, classes: { dealer: cls(100000, 400000, 20000), asset_manager: cls(900000, 200000, 30000),
      leveraged_funds: lev, other_reportable: cls(150000, 120000, 5000), nonreportable: { long: 80000, short: 90000, spread: null, traders_long: null, traders_short: null, traders_spread: null } } })
    return { freshness: 'periodic', as_of: '2026-10-27T04:00:00Z', data: { market: 'ES', name: 'Made-up Index Future', report: 'tff', report_name: 'Traders in Financial Futures', watch: 'leveraged_funds',
      classes: keys.map(key => ({ key, cftc: `made-up ${key} words`, spread: key !== 'nonreportable', traders: key !== 'nonreportable' })),
      rows: [week('2026-10-20', 1990000, cls(310000, 480000, 9000)), week('2026-10-27', 2000000, cls(300000, 500000, 10000))],
      records: [{ cftc_code: '000000', market_name: 'MADE-UP INDEX - MADE-UP EXCHANGE', match: 'code', first: '2026-10-20', last: '2026-10-27' }],
      concentration: { date: '2026-10-27', gross_4_long: 21.7, gross_4_short: 18.0, gross_8_long: 30.1, gross_8_short: 27.2, net_4_long: 15.0, net_4_short: 12.0, net_8_long: 22.0, net_8_short: 19.0 },
      credit: 'Source: CFTC Commitments of Traders (Traders in Financial Futures / Disaggregated), as of the Tuesday it covers, published the following Friday.',
      stale_for: [], left_out: ['range'] } }
  },
  // Terminal data wave 12 (dark kinds `estimates.history`, `analyst.ratings`, `company.segments`, `stock.failsToDeliver`,
  // `company.deals`, and the existing `ratings`; MD-1 §4.21, §4.4): the same rule — each adapter's own data shape, made-up
  // figures, dates, names and words. `as_of` is the data's own date, or null where each part carries its own read time.
  'ratings': (p) => ({ freshness: 'periodic', as_of: '2026-10-30T20:00:00Z', data: { symbol: String(p.symbol || '').toUpperCase(), composite: 81,
    components: { eps: 88, rs: 76, growth: 69, value: 41, smr: 'B', accdis: 'B-', sponsorship: 58 }, checkup: [{ label: 'Made-up check', status: 'pass', value: 1 }],
    method: 'made-up method words', basis: 'percentile', coverage: null, universe_n: 3700, sector: 'Made-up Sector', group_rs: 70, price_as_of: '2026-10-30', complete: true } }),
  'estimates.history': (p) => {
    const mv = (state, pct) => ({ state, reason: null, pct, from: null, to: null, from_date: null, to_date: null })
    return { freshness: 'periodic', as_of: '2026-11-02T05:00:00Z', data: { symbol: String(p.symbol || '').toUpperCase(), state: 'ok', covers_from: '2026-03-02',
      last_snapshot: '2026-11-02', store_newest: '2026-11-02', snapshot_days: 170, currency: null, tracked: { origin: 'sp500', count: 510, cap: 600 }, windows: [7, 30, 90],
      tolerance_pct: 0.5, slack_days: 4, failed_days: 0, failed_newest: [], left_out: ['points', 'year'],
      periods: [{ period_end: '2026-12-31', n: 170, first_snapshot: '2026-03-02', upcoming: true,
        newest: { snap_date: '2026-11-02', eps_avg: 1.25, eps_low: 1.1, eps_high: 1.4, n_eps: 30, rev_avg: 35000000000, rev_low: null, rev_high: null, n_rev: 28 },
        moves: { eps: { 7: mv('held', 0.1), 30: mv('up', 3.2), 90: mv('up', 8.7) }, revenue: { 7: mv('held', 0), 30: mv('up', 1.5), 90: mv('collecting', null) } } }] } }
  },
  'analyst.ratings': (p) => ({ freshness: 'periodic', as_of: '2026-11-02T14:00:00Z', data: { symbol: String(p.symbol || '').toUpperCase(), covered: true, outage: false,
    consensus: { strongBuy: 5, buy: 20, hold: 6, sell: 1, strongSell: 0, total: 32, label: 'Buy', observed_at: '2026-11-02T14:00:00Z' },
    price_target: { high: 260, low: 120, median: 200, consensus: 205, last_month: { count: 6, avg: 210 }, last_quarter: { count: 15, avg: 198 }, last_year: { count: 40, avg: 180 },
      observed_at: '2026-11-02T14:00:00Z' },
    upside: { target: 'consensus', target_value: 205, close: 180, close_date: '2026-10-30', pct: 13.89, basis: 'stored_close' },
    recent_actions: [{ date: '2026-10-29', company: 'Made-up Securities', action: 'upgrade', from_grade: 'Hold', to_grade: 'Buy' }].slice(0, p.rows || 5),
    actions_total: 1, left_out: ['trend', 'revisions'] } }),
  'company.segments': (p) => ({ freshness: 'periodic', as_of: '2026-01-25T05:00:00Z', data: { symbol: String(p.symbol || '').toUpperCase(), rows: p.rows || 8,
    growth_basis: 'a year earlier, from held periods', left_out: ['earlier_periods'],
    splits: { annual: { state: 'held', read_at: '2026-11-03T15:00:00Z',
      product: { state: 'ok', latest: { date: '2026-01-25', label: 'FY2026', currency: 'USD', total: 130000000000, segments_total: 2, cut: false,
        segments: [{ name: 'Made-up Compute', revenue: 115000000000, share: 88.5, prior: 47000000000, growth_pct: 144.7 }, { name: 'Made-up Graphics', revenue: 15000000000, share: 11.5, prior: null, growth_pct: null }] },
        prior: { date: '2025-01-26', label: 'FY2025' } },
      region: { state: 'none', latest: null, prior: null } },
    quarter: { state: 'not_held' } } } }),
  'stock.failsToDeliver': (p) => ({ freshness: 'historical', as_of: '2026-10-15T04:00:00Z', data: { symbol: String(p.symbol || '').toUpperCase(), state: 'ok',
    window: { from: '2026-05-01', through: '2026-10-15' }, basis: 'made-up basis words', description: 'MADE-UP CO',
    latest: { settle_date: '2026-10-15', quantity: 250000, price: 20, value: 5000000 },
    trend: { previous: { settle_date: '2026-10-14', quantity: 100000, price: 19.5, value: 1950000 }, change: 150000,
      peak: { settle_date: '2026-08-03', quantity: 400000, price: 15, value: 6000000 }, latest_vs_peak_pct: 62.5 },
    days_reported: 2, rows: [{ settle_date: '2026-10-15', quantity: 250000, price: 20, value: 5000000 }, { settle_date: '2026-10-14', quantity: 100000, price: 19.5, value: 1950000 }].slice(0, p.rows || 10),
    files_ingested: 11, mismatched_files: [], newest_file: 'cnsfails202610a' } }),
  'company.deals': (p) => {
    const sym = String(p.symbol || '').toUpperCase()
    return { freshness: 'periodic', as_of: null, data: { symbol: sym,
      deals: { state: 'held', read_at: '2026-11-03T14:00:00Z', search: 'ok', name: 'Made-up Company Inc', total: 1, cut: false, other_companies: 0, from_latest: 0,
        deals: [{ date: '2026-09-15', accepted_at: null, role: 'acquirer', acquirer: { sym, name: 'Made-up Company Inc' }, target: { sym: null, name: 'Made-up Startup Ltd' }, link: 'https://www.sec.gov/made-up' }] },
      index_changes: { state: 'held', read_at: '2026-11-03T14:00:00Z', indexes: { sp500: 'ok', nasdaq100: 'ok', dow: 'ok' }, total: 1, cut: false,
        changes: [{ index: 'dow', index_name: 'Dow 30', date: '2024-11-08', side: 'added', added: { sym, name: 'Made-up Company Inc' }, removed: { sym: 'QZOLD', name: 'Made-up Old Co' }, reason: 'Made-up reason.' }] } } }
  },
  // Terminal data wave 13 (dark kinds `insider.market`, `market.history`, `econ.latest`, `market.liquidity`, `market.oil`,
  // `market.analogs`; MD-1 §4.22): the same rule — each adapter's own data shape (the econ kinds: the econ routes' own row
  // shape, the registry's real series symbols with made-up meta), made-up figures, dates, names and words. Every date is in
  // 2025, so no answer's wording depends on the year of the run. `as_of` is the data's own date, or null where each part
  // carries its own.
  'insider.market': (p) => ({ freshness: 'periodic', as_of: null, data: {
    purchases: { state: 'held', window_days: 7, cap: 50, total: 2, unpriced: 1, newest_filing: '2025-10-30', rows: [
      { symbol: 'QZIA', name: 'Made-up Person One', title: 'director', shares: 2000, price: 15, amount: 30000, date: '2025-10-28', filing_date: '2025-10-30' },
      { symbol: 'QZIB', name: 'Made-up Person Two', title: 'officer: Made-up Title', shares: 500, price: null, amount: null, date: '2025-10-27', filing_date: '2025-10-29' }].slice(0, p.rows || 10) },
    clusters: { state: 'held', as_of: '2025-10-30', read_at: '2025-10-31T06:20:00Z', total: 1, truncated: false, min_insiders: 3, window_business_days: 10, left_out: ['people'],
      coverage: { complete: true, from: '2025-10-14', to: '2025-10-30', listed: 1200, read: 1200 },
      rows: [{ ticker: 'QZIC', company: 'Made-up Robotics Inc', insiders: 3, roles: { ceo: 1, director: 2 }, first_buy: '2025-10-22', last_buy: '2025-10-27', buys: 3, filings: 3,
        shares: 9000, value: 81000, value_complete: true, unpriced_buys: 0, avg_price: 9, close: { value: 9.5, date: '2025-10-30', reason: null }, change_pct: 5.6 }] } } }),
  'market.history': (p) => ({ freshness: 'historical', as_of: '2025-10-31T20:00:00Z', data: { index: p.index || 'SPX', name: p.index === 'NDX' ? 'Nasdaq-100' : 'S&P 500',
    first: '1990-01-02', last: '2025-10-31', closes: 9000, definition: 'Made-up definition words.', leaders_state: 'ok', episodes_total: 2, built_for: '2025-10-31',
    built_at: '2025-11-01T01:20:00Z', stale_for: [], survivorship: 'From stocks that trade today: a made-up survivorship sentence.',
    summary: { since: '1990-01-02', corrections: 20, bear_markets: 5, ongoing: 0, recovered: 25, median_depth_pct: -13.5, median_recovery_sessions: 75 },
    episodes: [{ kind: 'correction', peak: { date: '2025-02-19', close: 6100 }, trough: { date: '2025-04-08', close: 4980 }, depth_pct: -18.36, sessions_down: 33,
      recovered: '2025-06-27', sessions_to_recover: 55, ongoing: false, peak_at_history_start: false, below_peak_now_pct: null,
      rally: [{ months: 1, date: '2025-05-08', return_pct: 12.1 }, { months: 3, date: '2025-07-08', return_pct: 25.2 }],
      leaders: { state: 'ok', trough: '2025-04-08', end: '2025-07-09', index_return_pct: 25.0, priced_both: 3100, top_total: 25, sectors_total: 11,
        top: [{ sym: 'QZLA', sector: 'Made-up Sector', return_pct: 150.5, vs_index_pct: 125.5, check: false }],
        sectors: [{ sector: 'Made-up Sector', median_pct: 30.2, count: 400 }] } }].slice(0, p.rows || 8) } }),
  'econ.latest': () => ({ freshness: 'periodic', as_of: '2025-10-15T12:30:00Z', data: W13_ECON() }),
  'market.liquidity': () => ({ freshness: 'periodic', as_of: '2025-10-16T20:30:00Z', data: W13_LIQ() }),
  'market.oil': () => ({ freshness: 'periodic', as_of: '2025-10-15T14:30:00Z', data: W13_OIL() }),
  'market.analogs': (p) => ({ freshness: 'historical', as_of: '2025-10-31T20:00:00Z', data: { reference_date: '2025-10-31', reference_measures: { breadth_score: 61 },
    held: 3, windows: ['fwd_5d', 'fwd_10d', 'fwd_20d', 'fwd_60d'], built_at: '2025-11-01T14:00:00Z', age_s: 7200, stale_for: [],
    matches: [{ date: '2025-03-04', similarity: 97.3, distance: 0.03, forward_returns: { fwd_5d: 1.2, fwd_10d: -0.4, fwd_20d: 2.5, fwd_60d: 6.1 }, not_yet: [], measures_then: {} },
      { date: '2024-10-07', similarity: 91.0, distance: 0.09, forward_returns: { fwd_5d: -0.8, fwd_10d: 1.1, fwd_20d: 3.0, fwd_60d: 4.4 }, not_yet: [], measures_then: {} },
      { date: '2024-06-14', similarity: 88.5, distance: 0.12, forward_returns: { fwd_5d: 0.5, fwd_10d: 0.9, fwd_20d: -1.0, fwd_60d: 5.0 }, not_yet: [], measures_then: {} }].slice(0, p.rows || 5) } }),
}
// wave 13's econ rows: the econ routes' own shape over the registry's real series symbols, made-up meta and figures (2025)
const W13_T = 1760531400                                                      // 2025-10-15 12:30 UTC, a made-up release time
const W13_COLS = ['t', 'v', 'ps', 'pe', 'pit']
const w13Meta = (symbol, frequency, display, fmt, scale, op = null) => ({ symbol, name: `Made-up ${symbol}`, short_name: symbol, frequency, units: { display, fmt, scale },
  source: { line: 'Source: a made-up agency' }, derivation: op ? { op, inputs: [] } : null })
const w13Next = (date) => ({ state: 'current', latest_period: null, expected_period: null, next_release: { date, time: '08:30', tz: 'America/New_York', precision: 'exact' } })
const w13Row = (symbol, meta, points) => ({ symbol, state: 'ok', meta, points, currentness: w13Next('2031-12-10'), retrieved_at: null, read_at: '2025-10-16T21:00:00Z' })
const w13Monthly = (vals) => vals.map((v, i) => { const m = String(7 + i).padStart(2, '0'); return [W13_T - (vals.length - 1 - i) * 2592000, v, `2025-${m}-01`, `2025-${m}-28`, 0] })
const w13Weekly = (vals, end) => vals.map((v, i) => { const d = new Date(Date.parse(`${end}T00:00:00Z`) - (vals.length - 1 - i) * 604800000).toISOString().slice(0, 10); return [W13_T - (vals.length - 1 - i) * 604800, v, d, d, 0] })
function W13_ECON() {
  const series = ECON_SYMBOLS.map(s => w13Row(s, w13Meta(s, 'M', '%', 'pct1', 1, s.endsWith('MOM') ? 'mom_pct' : s.endsWith('YOY') ? 'yoy_pct' : null), w13Monthly([2.9, 3.1, 3.2])))
  series[series.findIndex(r => r.symbol === 'USNFPCHG')] = w13Row('USNFPCHG', w13Meta('USNFPCHG', 'M', 'persons', 'k_persons', 1000, 'diff'), w13Monthly([150, 210, 180]))
  return { columns: W13_COLS, points_per_series: 3, series, attributions: {}, not_held: [] }
}
function W13_LIQ() {
  const usd = (s, f, scale) => w13Meta(s, f, 'USD', 'usd_compact', scale)
  const fed = w13Weekly(Array.from({ length: 60 }, (_, i) => 6500000 + 2000 * i), '2025-10-15')
  const tga = w13Weekly(Array.from({ length: 60 }, () => 850000), '2025-10-15')
  const rrp = w13Weekly(Array.from({ length: 60 }, () => 50000000000), '2025-10-15')
  const series = LIQ_SYMBOLS.map(s => w13Row(s, w13Meta(s, 'M', '%', 'pct1', 1), w13Monthly([4.0, 4.1, 4.2])))
  const put = (r) => { series[series.findIndex(x => x.symbol === r.symbol)] = r }
  put(w13Row('USFEDBAL', usd('USFEDBAL', 'W', 1000000), fed.slice(-3)))
  put(w13Row('USTGAFED', usd('USTGAFED', 'W', 1000000), tga.slice(-3)))
  put(w13Row('USRRP', usd('USRRP', 'D', 1), rrp.slice(-3)))
  const hist = (s, pts) => ({ symbol: s, columns: W13_COLS, points: pts })
  return { latest: { columns: W13_COLS, points_per_series: 3, series, attributions: {}, not_held: [] },
    histories: { USFEDBAL: hist('USFEDBAL', fed), USTGAFED: hist('USTGAFED', tga), USRRP: hist('USRRP', rrp), USTGA: null, USSOFR: null },
    history_days: { USFEDBAL: 790, USTGAFED: 790, USRRP: 790, USTGA: 70, USSOFR: 70 } }
}
function W13_OIL() {
  const bbl = (s) => w13Meta(s, 'W', 'bbl', 'mbbl', 1000)
  const crude = w13Weekly(Array.from({ length: 60 }, (_, i) => 425000 - 100 * i), '2025-10-10')
  const series = OIL_SYMBOLS.map(s => w13Row(s, bbl(s), w13Weekly([1000, 1100, 1200], '2025-10-10')))
  const put = (r) => { series[series.findIndex(x => x.symbol === r.symbol)] = r }
  put(w13Row('USCRUDEINV', bbl('USCRUDEINV'), crude.slice(-3)))
  put(w13Row('USCRUDEINVCHG', w13Meta('USCRUDEINVCHG', 'W', 'bbl', 'mbbl', 1000, 'diff'), w13Weekly([-1500, 900, -2300], '2025-10-10')))
  put(w13Row('USGASPRICE', w13Meta('USGASPRICE', 'W', 'USD/gal', 'usd3', 1), w13Weekly([3.1, 3.12, 3.15], '2025-10-13')))
  return { latest: { columns: W13_COLS, points_per_series: 3, series, attributions: {}, not_held: [] },
    histories: Object.fromEntries(OIL_SYMBOLS.map(s => [s, s === 'USCRUDEINV' ? { symbol: s, columns: W13_COLS, points: crude } : null])),
    history_days: Object.fromEntries(OIL_SYMBOLS.map(s => [s, s === 'USCRUDEINV' ? 790 : 430])) }
}
/** Wave 6's made-up calendar months: ten years each, except a month nobody counted (February) and a thin one (March). */
function SEASON_MONTHS(shift) {
  return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map((label, i) => {
    if (i === 1) return { month: 2, label, n: 0, avg_pct: null, median_pct: null, pct_up: null, thin: false }
    if (i === 2) return { month: 3, label, n: 3, avg_pct: 2, median_pct: 1.5, pct_up: 67, thin: true }
    return { month: i + 1, label, n: 10, avg_pct: (i - 5) * 0.4 + shift, median_pct: (i - 5) * 0.5 + shift, pct_up: 30 + (i % 5) * 10, thin: false }
  })
}
// SG-1: T13–T18 sit FAR below their 52-week high (the Screener's sign: a distance from a high is NEGATIVE) and meet every
// other condition of the owner's screen — so only a correctly signed "near the high" filter leaves them out
const FAR_FROM_HIGH = [-12, -18, -25, -30, -35, -40]
const UNIVERSE = Array.from({ length: 18 }, (_, i) => ({ ticker: `T${String(i + 1).padStart(2, '0')}`, adr_pct: 2 + i, price: 10 + i * 5, chg_pct: i - 3, rel_volume: 0.5 + i * 0.25, days_to_earnings: i,
  // PKG2: made-up values for the conversational-scan fields — T01–T12 meet the owner's screen, so a refinement's effect is
  // asserted on the canonical read's spec, never on a figure
  chg_pct_1m: 20 + i, chg_pct_3m: 30 + 2 * i, dist_52w_high_pct: i < 12 ? -0.4 * i : FAR_FROM_HIGH[i - 12], vol_ratio: 1.1 + 0.1 * i,
  sector: 'Technology', industry: i % 2 ? 'Semiconductors' : 'Software - Application' }))
/** The engine's own filter semantics over the fixture universe (wire filters {key, op, min, max, value, values}). */
export const rowMatches = (r, f) => (f.op === 'gt' ? r[f.key] > f.min : f.op === 'lt' ? r[f.key] < f.max : f.op === 'gte' ? r[f.key] >= f.min
  : f.op === 'lte' ? r[f.key] <= f.max : f.op === 'between' ? r[f.key] >= f.min && r[f.key] <= f.max : f.op === 'eq' ? r[f.key] === f.value
    : f.op === 'in' ? (f.values || []).includes(r[f.key]) : f.op === 'not_in' ? !(f.values || []).includes(r[f.key]) : true)

/** The board's EFFECTIVE state — every widget's cell, and each chart's symbol, timeframe and merged settings (what the
 *  member sees): equality = nothing changed for the member. (A stored `tf: 'D'` written back where nothing was stored
 *  is the same chart; `exactState` is the byte-level form, for the cases that promise byte-identical storage.) */
export const boardState = (board) => JSON.stringify([...board.state.widgets].sort((a, b) => String(a.id).localeCompare(String(b.id))).map(w => {
  const c = w.type === 'chart' ? board.host.charts.read(w.id) : null
  return { id: w.id, type: w.type, x: w.x, y: w.y, w: w.w, h: w.h, ...(c ? { symbol: c.symbol, tf: c.tf, cs: c.cs } : { opts: w.opts }) }
}))
export const exactState = (board) => JSON.stringify({ widgets: board.state.widgets, groupSyms: board.state.groupSyms })
export const chartsOf = (board) => board.state.widgets.filter(w => w.type === 'chart').sort((a, b) => (a.y - b.y) || (a.x - b.x))

/** Resolve a canonical op's symbolic target ("$charts[0]", "$workspace", "$board", "$indicatorEdits[0]", "new1") from the request context. */
export function resolveTarget(t, body) {
  const f = /^\$([A-Za-z]+)\{([A-Za-z]+)\}$/.exec(String(t || ''))           // "$indicatorDrafts{new}": the entry flagged `new`
  if (f) return (body?.context?.[f[1]] || []).find(e => e[f[2]])?.ref || `missing:${t}`
  const m = /^\$([A-Za-z]+)(?:\[(\d+)\])?$/.exec(String(t || ''))
  if (!m) return t
  const list = body?.context?.[m[1]]
  if (list && !Array.isArray(list) && m[2] == null && list.ref) return list.ref                 // a context OBJECT ("$multiChart", #1030)
  return Array.isArray(list) && list[Number(m[2] || 0)] ? list[Number(m[2] || 0)].ref : `missing:${t}`
}
// an ARG may name a live value from the request context: "$ctx:drawings.0.drawings.0.id" (ids minted at run time)
const resolveArg = (v, body) => (typeof v === 'string' && v.startsWith('$ctx:')
  ? v.slice(5).split('.').reduce((a, k) => a?.[k], body?.context) ?? `missing:${v}`
  : Array.isArray(v) ? v.map(x => resolveArg(x, body)) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolveArg(x, body)])) : v)
export const resolveOps = (ops, body) => ops.map(o => ({ ...o, target: resolveTarget(o.target, body), args: resolveArg(o.args, body) }))

// NLM-1: whether a case runs with NLM-1 on — its own seed when it says (true / false), else CAPREG_NLM1=on|off. Default
// ON, as production is (owner policy 11-04); CAPREG_NLM1=off runs the kill-switch path (v1, master's behaviour)
export const nlm1Of = (seed = {}) => (seed.nlm1 != null ? !!seed.nlm1 : (globalThis.process?.env?.CAPREG_NLM1 || '').trim() !== 'off')
// v2-readiness-2: `stepScript` (planner v2 parity, agentPlannerV2Parity.test.jsx) — the case's model turns are served by the
// scripted STEP-1 server (testing/stepServer.js) instead of the v1 envelope queue, and the config says planner 'v2'.
// Absent (every capability-regression suite), mountCase is exactly as before.
let unpublishListView = null
/** The UCT News library module's API (lib/tradeExchangeNewsLibrary.js) over an in-memory member library — the kind reads it
 *  through `host.newsLibrary` in place of the page's module. Synthetic; ids are the NEWS_LIB rows'. */
function newsLibraryStandIn(seed) {
  let n = 0
  const cols = (seed.collections || []).map(name => ({ id: `k${++n}`, name }))
  const marks = new Map((seed.saved || []).map(id => [id, { event_id: id, note: seed.notes?.[id] || '', collection_ids: (seed.member?.[id] || []).map(nm => cols.find(c => c.name === nm)?.id).filter(Boolean), saved_at_ms: 1 }]))
  const snap = () => ({ status: 'ready', ids: new Set(marks.keys()), collections: cols.map(c => ({ ...c, count: [...marks.values()].filter(m => m.collection_ids.includes(c.id)).length })),
    notes: Object.fromEntries([...marks].map(([id, m]) => [id, m.note])), member: Object.fromEntries([...marks].map(([id, m]) => [id, [...m.collection_ids]])) })
  let cur = snap()
  const ok = (x = {}) => { cur = snap(); return { ok: true, ...x } }
  const no = (error) => ({ ok: false, error })
  return {
    getSnapshot: () => cur, load: async () => { cur = snap(); return cur }, isSaved: (id) => marks.has(id),
    save: async (id) => { if (!marks.has(id)) marks.set(id, { event_id: id, note: '', collection_ids: [], saved_at_ms: 2 }); return ok() },
    remove: async (id) => { const m = marks.get(id); marks.delete(id); return ok({ removed: m ? { ...m, collection_ids: [...m.collection_ids] } : null }) },
    undoRemove: async (r) => { if (r?.event_id) marks.set(r.event_id, { ...r, collection_ids: (r.collection_ids || []).filter(c => cols.some(x => x.id === c)) }); return ok() },
    setNote: async (id, note) => { const m = marks.get(id); if (!m) return no('Save the headline before adding a note.'); m.note = note; return ok() },
    createCollection: async (name) => { if (cols.some(c => c.name.toLowerCase() === name.toLowerCase())) return no(`You already have a collection named “${name}”.`); const c = { id: `k${++n}`, name }; cols.push(c); return ok({ body: c }) },
    renameCollection: async (cid, name) => { const c = cols.find(x => x.id === cid); if (!c) return no('That collection could not be found.'); c.name = name; return ok() },
    deleteCollection: async (cid) => { const i = cols.findIndex(x => x.id === cid); if (i < 0) return no('That collection could not be found.'); cols.splice(i, 1); for (const m of marks.values()) m.collection_ids = m.collection_ids.filter(x => x !== cid); return ok() },
    setMembership: async (cid, id, member) => { const m = marks.get(id); if (!m) return no('Save the headline before adding it to a collection.'); m.collection_ids = member ? [...new Set([...m.collection_ids, cid])] : m.collection_ids.filter(x => x !== cid); return ok() },
    setMembershipSaving: async (cid, id, member) => { if (member && !marks.has(id)) marks.set(id, { event_id: id, note: '', collection_ids: [], saved_at_ms: 2 }); const m = marks.get(id); m.collection_ids = member ? [...new Set([...m.collection_ids, cid])] : m.collection_ids.filter(x => x !== cid); return ok() },
    fetchBookmark: async (id) => ({ ok: true, bookmark: marks.has(id) ? { ...marks.get(id) } : null }),
  }
}

export function mountCase(boardName = 'ONE', { kinds = PROD_KINDS, seed = {}, stepScript = null } = {}) {
  // NLM-1 on (nlm1Of): BOTH switches on for this case (server config routing_v2 + the browser key); off: the browser kill
  // switch set to '0', so NLM-1 stays off whatever an earlier case left cached
  const p = setupPanel()
  const nlm1 = nlm1Of(seed)
  vi.stubEnv('VITE_INDICATOR_TEMPLATES_ENABLED', seed.indicatorTemplates ? '1' : '0')     // the build flag, for this case only
  try { if (nlm1) { localStorage.setItem('uct.agent.routingV2', '1'); _resetAgentConfig() } else localStorage.setItem('uct.agent.routingV2', '0') } catch { /* */ }
  // NLM-1's third key (in-plan rules, nlm1/inplan.js): ON only for a case seeded nlm1Inplan, cleared otherwise
  try { if (seed.nlm1Inplan) localStorage.setItem('uct.agent.nlm1.inplan', '1'); else localStorage.removeItem('uct.agent.nlm1.inplan') } catch { /* */ }
  const srv = stepScript ? installStepServer(p, stepScript, { planner: 'v2' }) : null
  const st = { log: [], replay: null, views: {}, deletedScreens: seed.deletedScreens || [], screenHeads: {}, screens: seed.screens || [{ id: 7, name: 'Momentum Screen', spec: { filters: [{ key: 'adr_pct', op: 'gt', min: 5 }] } }], prefs: { theme: 'dark', default_chart_tf: 'D', alert_sound: 'on', alert_sound_type: 'chime', ...(seed.prefs || {}) }, builderCalls: [], defs: new Map(), ialerts: (seed.indicatorAlerts || []).map(a => ({ user_id: 1, active: true, state: 'armed', created_at: 1, scope: null, ...a })), alerts: (seed.alerts || []).map(a => ({ user_id: 'me', is_active: 1, triggered_at: null, created_at: '2026-11-03T13:00:00Z', alert_type: 'price', drawing_id: null, ...a })) }
  const base = globalThis.fetch
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url); const method = init.method || 'GET'
    const body = init.body ? JSON.parse(init.body) : null
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
    if (u === '/api/agent/turn' || u === '/api/agent/record' || u.startsWith('/api/ticker-search')) return base(url, init)
    p.st.calls.push([method, u, body])
    if (u === '/api/agent/config') { const cfg = srv ? { ...configFor(kinds), planner: 'v2' } : configFor(kinds); return json(nlm1 ? { ...cfg, routing_v2: true } : cfg) }
    // PACKAGE 3: one definition (GET read-back, DELETE = the server's soft delete, PUT = a re-save under the same id —
    // definition.delete's Undo), as api/routers/user_definitions.py answers them
    const one = /^\/api\/user-definitions\/([^/?]+)/.exec(u)
    if (one) {
      const id = decodeURIComponent(one[1])
      if (method === 'GET') return st.defs.has(id) ? json(st.defs.get(id)) : json({ detail: 'not found' }, 404)
      if (method === 'DELETE') { const had = st.defs.delete(id); return had ? json({ ok: true }) : json({ detail: 'not found' }, 404) }
      if (method === 'PUT' && body?.definition) {
        const version = (st.defs.get(id)?.version || body.definition.version || 0) + 1
        st.defs.set(id, { def_id: id, version, rev: 1, definition: { ...body.definition, id, version } })
        return json(st.defs.get(id))
      }
    }
    if (u.startsWith('/api/user-definitions')) return st.defs.size ? json({ definitions: [...st.defs.values()] }) : base(url, init)
    // the drawings SYNC as the server holds it (useTracingsSync: prefs.tracings_doc = { updatedAt, doc }) — the account
    // copy mirrors this tab's store, as it does once the sync has run (host.confirmDrawingsSynced reads it back)
    if (u === '/api/auth/preferences' && method === 'GET') {
      const id = drawingsStore.getActiveTracingId?.() ?? 'default'
      const syms = [...new Set((mounted?.h?.charts?.list?.() || []).map(c => c.symbol))]
      // (+ the boards list itself, as exportTracings() pushes it: host.drawingBoards.confirm reads the boards back by id and name)
      return json({ tracings_doc: { updatedAt: 1, doc: { activeId: id, tracings: drawingsStore.exportTracings().tracings, byTracing: { [id]: Object.fromEntries(syms.map(sy => [sy, drawingsStore.peekDrawings(sy)])) } } } })
    }
    if (u.startsWith('/api/indicator-alerts')) {
      // the router's own shapes (indicator_alerts.py), as agentIndicatorAlerts.test.jsx's fixture
      if (u === '/api/indicator-alerts/catalog') return json({ catalog: IA_CATALOG, refusals: [] })
      if (u === '/api/indicator-alerts' && method === 'GET') return json({ alerts: st.ialerts })
      if (u === '/api/indicator-alerts' && method === 'POST') {
        const row = { id: 100 + st.ialerts.length + 1, user_id: 1, sym: body.sym, indicator: body.indicator, condition: body.condition ?? null, threshold: body.threshold ?? null, tf: body.tf,
          params_json: body.params ?? null, active: true, instance_id: body.instance_id ?? null, scope: body.scope ?? null, state: 'armed', created_at: 1 }
        st.ialerts = [...st.ialerts, row]
        return json({ id: row.id })
      }
      const tg = /^\/api\/indicator-alerts\/(\d+)\/toggle$/.exec(u)
      if (tg && method === 'POST') { const r = st.ialerts.find(x => x.id === Number(tg[1])); if (!r) return json({ detail: 'not found' }, 404); r.active = !r.active; return json(r) }
      const dl = /^\/api\/indicator-alerts\/(\d+)$/.exec(u)
      if (dl && method === 'DELETE') { st.ialerts = st.ialerts.filter(x => x.id !== Number(dl[1])); return json({ ok: true }) }
      return json({}, 404)
    }
    if (u.startsWith('/api/watchlist-alerts')) {
      // the real routes' behaviour (agentAlerts.test.jsx): owner-scoped rows, a POST returns the row, a DELETE removes it
      if (method === 'POST') {
        const row = { id: `new${st.alerts.length + 1}`, user_id: 'me', sym: String(body.sym).toUpperCase(), target_price: body.target_price, direction: body.direction, is_active: 1, triggered_at: null, created_at: '2026-11-04T13:00:00Z', alert_type: body.alert_type || 'price', drawing_id: body.drawing_id || null, anchor_t1: body.anchor_t1 ?? null, anchor_p1: body.anchor_p1 ?? null, anchor_t2: body.anchor_t2 ?? null, anchor_p2: body.anchor_p2 ?? null }
        st.alerts = [row, ...st.alerts]
        return json(row)
      }
      if (method === 'DELETE') { const id = decodeURIComponent(u.split('/').pop()); st.alerts = st.alerts.filter(r => r.id !== id); return json({ ok: true }) }
      return json(st.alerts)
    }
    // the Compare panel's group reads (api/routers/compare.py shapes): one theme, for chartSetup.compareGroup
    if (u.startsWith('/api/compare/groups?')) return json({ groups: u.endsWith('type=theme') ? [{ name: 'AI Chips', count: 3 }] : [] })
    if (u.startsWith('/api/compare/group-members?')) return json(u.includes('name=AI%20Chips') ? { name: 'AI Chips', symbols: ['NVDA', 'AMD', 'AVGO'], total: 3, truncated: false } : { name: '', symbols: [], total: 0, truncated: false })
    if (u === '/api/screener/fields?options=1') return json({ fields: FIELDS, options: FIELD_OPTIONS })
    if (u === '/api/screener/fields' || u.startsWith('/api/screener/fields?')) return json({ fields: FIELDS })
    // Recently deleted (recentlyDeleted.*): the artifact-versions routes as api/routers/artifact_versions.py answers them —
    // seed.deletedScreens are the member's deleted saved screens (tombstones); undelete is compare-and-set on the head and
    // recreates the screen under its old id; a recreated screen's versions answer its new head (the Undo's check)
    if (u.startsWith('/api/artifact-versions/')) {
      const head = (s) => s.head || 2
      const dm = /^\/api\/artifact-versions\/(\w+)\/deleted$/.exec(u)
      if (dm) return json({ kind: dm[1], deleted: dm[1] === 'screen' ? st.deletedScreens.map(s => ({ artifact_id: s.id, label: s.name, head: head(s), deleted_at: 1795000000 })) : [] })
      const um = /^\/api\/artifact-versions\/screen\/(\d+)\/undelete$/.exec(u)
      if (um && method === 'POST') {
        const s = st.deletedScreens.find(x => String(x.id) === um[1])
        if (!s || body.base_version !== head(s)) return json({ detail: { error: 'exists' } }, 409)
        st.deletedScreens = st.deletedScreens.filter(x => x !== s)
        st.screens = [...st.screens, { id: s.id, name: s.name, spec: s.spec || { filters: [] } }]
        st.screenHeads[String(s.id)] = head(s) + 1
        return json({ kind: 'screen', artifact_id: s.id, restored_from: body.version, version: head(s) + 1, recorded: true, artifact: { id: s.id, name: s.name } })
      }
      const hm = /^\/api\/artifact-versions\/screen\/(\d+)$/.exec(u)
      if (hm && st.screenHeads[hm[1]]) return json({ kind: 'screen', artifact_id: Number(hm[1]), head: st.screenHeads[hm[1]], versions: [] })
      return json({ detail: 'Not Found' }, 404)
    }
    // the saved screens behind the real routes' semantics (screener saved-screens: GET list, POST create, PUT rename, DELETE)
    if (u === '/api/screener/saved-screens' && method === 'GET') return json({ saved: st.screens, starters: [] })
    if (u === '/api/screener/saved-screens' && method === 'POST') { const row = { id: 100 + st.screens.length, name: body.name, spec: body.spec }; st.screens = [...st.screens, row]; return json(row) }
    const ssm = /^\/api\/screener\/saved-screens\/([^/]+)$/.exec(u)
    if (ssm && method === 'PUT') { st.screens = st.screens.map(x => (String(x.id) === ssm[1] ? { ...x, ...(body.name ? { name: body.name } : {}), ...(body.spec ? { spec: body.spec } : {}) } : x)); return json(st.screens.find(x => String(x.id) === ssm[1]) || {}) }
    if (ssm && method === 'DELETE') { st.screens = st.screens.filter(x => String(x.id) !== ssm[1]); return json({ ok: true }) }
    if (u === '/api/screener/scan') {
      const ok = rowMatches
      const rows = UNIVERSE.filter(r => (body.filters || []).every(f => ok(r, f)))
      return json({ total: rows.length, rows: rows.slice(0, body.page_size || 25), snapshot_date: '2026-10-07' })
    }
    // every other read answers EMPTY / unavailable: the corpus asserts WHICH canonical read ran, never a figure
    // instrument.resolve as the server answers it (MD-1 §4.7, instruments.py): a symbol typed in capitals resolves; a lowercase
    // one resolves only when §4.7.5 confirms it ('nvda' yes; 'spy', 'gold' no — the neutral ask)
    if (u === '/api/agent/data' && body?.kind === 'instrument.resolve') {
      const results = (body.params?.symbols || []).map(c => { const t = String(c?.text ?? c).replace(/^\$/, ''); return (t === t.toUpperCase() || LOWER_OK.has(t.toUpperCase())) ? { input: c?.text ?? c, class: 'symbol', symbol: t } : { input: c?.text ?? c, class: 'symbol_typed_lowercase', symbol: t.toUpperCase() } })
      // the asset-class route (asset_classes.py) rides along for a plain lowercase asset word, parallel to its class
      const routes = results.map(r => (r.class === 'symbol_typed_lowercase' ? ASSET_ROUTES[String(r.input).replace(/^\$/, '').toLowerCase()] || null : null))
      return json({ contract: 'MD-1.0', kind: body.kind, params_echo: body.params, status: 'ok', notes: [], data: { results, ...(routes.some(Boolean) ? { routes } : {}) } })
    }
    // the SC-1 gateway's screen kinds (served in production): synthetic rows from the fixture universe — the corpus
    // asserts WHICH read ran and what the Agent did with a screen, never a figure
    if (u === '/api/agent/data' && (body?.kind === 'screen.run' || body?.kind === 'screen.count')) {
      // SG-1: the engine's semantics — only rows meeting every wire filter come back (a saved id carries no spec: all rows)
      const rows = UNIVERSE.filter(r => (body.params?.spec?.filters || []).every(f => rowMatches(r, f))).map(r => ({ ...r, symbol: r.ticker, company: r.ticker, chg_pct_1d: r.chg_pct }))
      st.screenRows = rows
      return json({ contract: 'MD-1.0', kind: body.kind, params_echo: body.params, status: 'ok', freshness: 'eod', as_of: '2026-11-03', stale: false, notes: [], coverage: null,
        data: { rows: rows.slice(0, body.params?.limit || 25), total_matches: rows.length, count: rows.length } })
    }
    if (u === '/api/agent/data' && body?.kind === 'bars.daily') {
      const n = Math.min(Number(body.params?.bars) || 252, SYNTH_BARS.length)
      return json({ contract: 'MD-1.0', kind: body.kind, params_echo: body.params, status: 'ok', freshness: 'historical', as_of: SYNTH_BARS.at(-1).t, stale: false, notes: [], coverage: null,
        data: { symbol: String(body.params?.symbol || '').toUpperCase(), bars: SYNTH_BARS.slice(-n) } })
    }
    // PKG2: the dark `history.eventStudy` kind — a SYNTHETIC study (no market value: a fixed made-up table) for a valid request
    if (u === '/api/agent/data' && body?.kind === 'history.eventStudy') {
      const sym = String(body.params?.symbol || '').toUpperCase()
      return json({ contract: 'MD-1.0', kind: body.kind, params_echo: body.params, status: 'ok', freshness: 'historical', as_of: '2026-10-30T20:00:00Z', stale: false, notes: [], coverage: null,
        data: { symbol: sym, request: body.params, study: SYNTH_STUDY(sym), summary: { status: 'ok', events_used: 3, series_label: `${sym} synthetic condition`, price_first: '2025-01-02', price_last: '2026-10-30' },
          coverage: { price_first: '2025-01-02', price_last: '2026-10-30' } } })
    }
    // the asset-class kinds (asset_quotes.py): no licensed source exists, so every read is the honest decline (`refused`)
    if (u === '/api/agent/data' && ['index.quote', 'commodity.quote', 'crypto.quote'].includes(body?.kind)) {
      return json({ contract: 'MD-1.0', kind: body.kind, params_echo: body.params, status: 'refused', freshness: 'unavailable', as_of: null, stale: false, notes: ['no licensed source'], data: null })
    }
    // terminal data waves 1 to 13 (dark): a SYNTHETIC answer in each kind's own data shape (TERMINAL_DATA above; no market value)
    if (u === '/api/agent/data' && TERMINAL_DATA[body?.kind]) {
      return json({ contract: 'MD-1.0', kind: body.kind, params_echo: body.params, status: 'ok', freshness: 'periodic', as_of: null, fetched_at: '2026-11-03T16:00:00Z', delay_s: null,
        stale: false, source: 'fixture', coverage: null, notes: [], provider_calls: 0, ...TERMINAL_DATA[body.kind](body.params || {}) })
    }
    if (u === '/api/agent/data') return json({ contract: 'MD-1.0', kind: body?.kind, params_echo: body?.params, status: 'unavailable', notes: [], data: null })
    return base(url, init)
  }
  // NLM-1: the config cleared above is read again through THIS case's config route (routing_v2: true) before any turn
  if (nlm1) loadAgentConfig()
  const spec = BOARDS[boardName]()
  let mounted = null
  mounted = p.mount(...spec)
  const extra = spec[2] || {}
  if (extra.indicatorAlerts) mounted.h.indicatorAlerts = buildIndicatorAlertSource()
  if (seed.boards) {
    // C1-167..170: the member's Drawing Boards in the REAL drawings store (seed.boards: { names, active, drawings }: names by
    // position, '' = unnamed ("Board N"); `drawings`: { boardIndex: count } horizontal lines on NVDA), written only through
    // the panel's writers by host.drawingBoards; the server copy is the GET above
    localStorage.removeItem('uct-chart-tracings')
    for (const c of mounted.h.charts.list()) drawingsStore.clearAll(c.symbol)
    drawingsStore._reset()
    const ids = [drawingsStore.getActiveTracingId()]
    drawingsStore.renameTracing(ids[0], seed.boards.names[0] || '')
    for (const n of seed.boards.names.slice(1)) ids.push(drawingsStore.createTracing({ name: n }))
    for (const [i, count] of Object.entries(seed.boards.drawings || {})) {
      drawingsStore.setActiveTracing(ids[i])
      for (let k = 0; k < count; k++) drawingsStore.addDrawing('NVDA', { type: 'horizontal', points: [{ price: 20 + k }], color: '#fff', lineWidth: 1 })
    }
    drawingsStore.setActiveTracing(ids[seed.boards.active || 0])
    mounted.h.drawingBoards = buildDrawingBoardSource(drawingsStore, { timeoutMs: 3000, everyMs: 20 })
  }
  if (extra.grid) mounted.h.gridControl = makeGridControl(['NVDA'])
  if (extra.layoutDock) {
    // the Layout Dock's door (pages/charts/LayoutDock.jsx agentRef): the same positional helpers over the
    // `charts_layout_dock` preference (st.prefs, so a case checks the bar with `prefs`); the library is the board's
    st.prefs[DOCK_PREF] = JSON.stringify({ pins: extra.layoutDock, known: mounted.board.state.layouts.entries.map(e => e.id), hidden: false })
    const dock = () => JSON.parse(st.prefs[DOCK_PREF])
    const writeDock = async (next) => { st.prefs = { ...st.prefs, [DOCK_PREF]: JSON.stringify(next) }; return true }
    const door = {
      snapshot: () => { const d = dock(); const entries = mounted.board.state.layouts.entries
        return { ready: true, hidden: d.hidden, pins: d.pins.slice(), names: Object.fromEntries(entries.map(e => [String(e.id), e.name])), library: entries.map(e => ({ id: e.id, name: e.name, scope: e.scope || 'user' })) } },
      pin: (id) => writeDock({ ...dock(), pins: addPin(dock().pins, id) }),
      unpin: (index) => writeDock({ ...dock(), pins: removePin(dock().pins, index) }),
      shift: (from, to) => writeDock({ ...dock(), pins: shiftPin(dock().pins, from, to) }),
      restore: (id, index) => { const p = addPin(dock().pins, id); return writeDock({ ...dock(), pins: shiftPin(p, p.length - 1, index) }) },
    }
    mounted.h.layoutDock = buildLayoutDockSource(() => door)
  }
  unpublishListView?.(); unpublishListView = null
  if (extra.listView) {
    // synthetic column values, only to order the rows; a sort on any other column keeps the saved order
    const VALUES = { rvol: { NVDA: 1, TSLA: 3, AMD: 2 } }
    const view = st.listView = { cfg: {}, selected: 'NVDA' }
    const rows = () => {
      const base = ['NVDA', 'TSLA', 'AMD']
      const s = view.cfg.sort
      const v = s && VALUES[s.key]
      return v ? [...base].sort((a, b) => (s.dir === 'asc' ? v[a] - v[b] : v[b] - v[a])) : base
    }
    const columns = () => (view.cfg.order || DEFAULT_COL_ORDER).filter(k => !view.cfg.hidden?.[k])
    unpublishListView = publishListView({ type: 'watchlist', color: 'N', key: 'user:w1' }, () => ({ name: 'Momentum', rows, cfg: view.cfg, sort: view.cfg.sort || null, columns: columns(),
      fixedColumns: false, persisted: true, selected: view.selected, active: true, saveCols: (cfg) => { view.cfg = cfg }, select: (sym) => { view.selected = sym } }))
    st.listViewNow = () => ({ rows: rows(), columns: columns(), sort: view.cfg.sort || null, selected: view.selected })
    mounted.h.listViews = buildListViewSource({ getWidgets: () => mounted.board.state.widgets })
    writeFlagged(seed.flagged || [])
    mounted.h.flagged = buildFlaggedSource({ request: async (u, init) => {
      p.st.calls.push(['POST', u, JSON.parse(init.body)])
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    } })
    st.flaggedNow = readFlagged
  }
  if (extra.prefs) {
    if (!('chart_templates' in st.prefs)) st.prefs.chart_templates = JSON.stringify([{ name: 'Clean', settings: { ...bareSettings(), background: '#000000' } }])
    if (seed.indicatorTemplates) {
      const cs = mergeChartSettings(JSON.stringify({ ...bareSettings(), indicatorInstances: [{ instanceId: 'inst:macd:t', defId: 'macd', inputs: {} }] }))
      st.prefs.indicator_templates = JSON.stringify(seed.indicatorTemplates.map(name => captureIndicatorTemplate(cs, nativeRegistry, { name }).template))
    }
    mounted.h.prefs = { read: () => ({ ...st.prefs }), write: async (k, v) => { st.prefs = { ...st.prefs, [k]: v }; return true },
      // setPrefMerged's contract: `undefined` from the merge abandons the write
      merge: async (k, fn) => { const next = fn(JSON.parse(st.prefs[k] ?? '[]')); if (next === undefined) return undefined; st.prefs = { ...st.prefs, [k]: JSON.stringify(next) }; return { ok: true } } }
  }
  if (extra.authoring) {
    try { localStorage.setItem(CREATE_INDICATOR_FLAG_KEY, '1') } catch { /* */ }
    // PACKAGE 3: a case may SCRIPT the builder's model (seed.builder: [{match, ops, disposition?, reply?, questions?}], the first
    // `match` regex the member's message meets answers; an op's `formula` / an output's `formula` is parsed by the REAL engine
    // parser into its canonical tree). Absent, the builder answers the EMA 9/20 % request as before.
    const script = Array.isArray(seed.builder) ? seed.builder : null
    const converse = ({ message, state }) => {
      st.builderCalls.push(message)
      const hit = script && script.find(b => new RegExp(b.match, 'i').test(String(message || '')))
      if (hit) {
        const disposition = hit.disposition || 'change'
        return { ok: true, disposition, turn: disposition === 'change' ? 'patch' : disposition, reply: hit.reply || '', envelope: { contract: PATCH, baseRevision: state.revision, assumptions: [], disposition,
          ...(hit.reply ? { reply: hit.reply } : {}), ...(hit.questions ? { questions: hit.questions } : {}), ops: treesOf(hit.ops || []) } }
      }
      return { ok: true, disposition: 'change', turn: 'patch', reply: '', envelope: { contract: PATCH, baseRevision: state.revision, assumptions: [], disposition: 'change',
        ops: [{ op: 'create', name: 'EMA 9/20 % Diff', placement: 'pane', outputs: [{ key: 'diff', label: 'EMA 9/20 % Diff', tree: PCT }] }] } }
    }
    const fakeSave = async (doc, defId, _x, opts) => {
      const id = defId || `u_aaaaaaaaae${String(st.defs.size + 10).padStart(2, '0')}`
      const version = defId ? (opts?.baseVersion || 0) + 1 : 1
      st.defs.set(id, { def_id: id, version, rev: 1, definition: { ...doc, id, version } })
      mutate(USER_DEFINITIONS_KEY)            // the real save door revalidates the member's list (useUserDefinitions.saveUserDefinition)
      return { ok: true, row: { def_id: id, version, rev: 1 } }
    }
    setAuthoringSources({ extra: { converse, readBack: async (id) => st.defs.get(id) || null, store: (sv, o) => storeConversation(sv, { ...o, save: fakeSave }) } })
    // PACKAGE 3: the chart's authoring PREVIEW channel (ChartPane's showAuthoringPreview / clearAuthoringPreview), recorded
    // — a preview is on screen only, never persisted (st.preview: {chart, name} | null)
    st.preview = null
    const charts0 = mounted.h.charts
    mounted.h.charts = { ...charts0, previewHost: (ref) => (charts0.list().some(c => c.ref === ref) ? {
      showAuthoringPreview: (def) => { st.preview = { chart: ref, name: def?.meta?.name || null }; return { ok: true } },
      clearAuthoringPreview: () => { st.preview = null },
    } : null) }
  }
  if (extra.timeNav) {
    // ChartsWorkspace's Time Navigator + Replay Mode, as host.buildChartSource exposes them: a per-chart VIEW read-out,
    // goTo(ref, ms) puts the last bar on or before the date at the right edge, setReplay(iso|null) is ONE shared cutoff;
    // viewDo(ref, op, arg) is the chart's own view control (range bar, Reset view, Alt+Shift+I), read back from the view
    const views = {}
    const viewOf = (ref) => views[ref] || (views[ref] = { firstMs: BAR_DAYS[0], lastMs: BAR_DAYS.at(-1), rightMs: BAR_DAYS.at(-1), fullyLoaded: true,
      activeRange: null, atDefaultView: false, indicatorsHidden: false, priceAuto: false, frame: { fromRight: 120, toRight: -8, activeRange: null, locked: false, lock: null },
      // the Position Calculator (StockChart getDateMeta.positionCalc): closed, its panel empty
      positionCalc: { can: true, open: false, entry: '', stop: '', target: '', direction: 'long' },
      // chartReplay.playback: the Replay / Time Machine bar (StockChart getDateMeta.replay): off, 1×
      replay: { can: true, mode: false, playing: false, speed: 1, index: null, total: BAR_DAYS.length, dateMs: null, firstMs: BAR_DAYS[0], lastMs: BAR_DAYS.at(-1) } })
    st.replay = null
    const charts = mounted.h.charts
    // C1-127: the chart's own Chart Settings door (ChartWidget adapter → ChartPane.openSettings), read back as open
    st.settingsOpen = {}
    // family C (C1-178): the chart's right-click "Ask AI about {sym}" door (ChartWidget openAskAi), recorded as the route it opens
    st.askAi = []
    const withTime = (x) => (x ? { ...x, view: { ...viewOf(x.ref) }, replay: st.replay, canOpenSettings: true, settingsOpen: !!st.settingsOpen[x.ref], canAskAi: true } : x)
    mounted.h.charts = { ...charts, list: () => charts.list().map(withTime), read: (r) => withTime(charts.read(r)),
      goTo: (ref, ms) => { viewOf(ref).rightMs = ms >= BAR_DAYS.at(-1) ? BAR_DAYS.at(-1) : lastOnOrBefore(ms); return true },
      // the chart's own view controls (StockChart.applyRange / restoreView / resetView / setIndicatorsHidden), as getDateMeta reads them back
      viewDo: (ref, op, arg) => {
        const v = viewOf(ref)
        if (op === 'applyRange') Object.assign(v, { activeRange: arg, atDefaultView: false, frame: { fromRight: 252, toRight: -8, activeRange: arg, locked: true, lock: { hLocked: true } } })
        if (op === 'restoreView') Object.assign(v, { activeRange: arg.activeRange, atDefaultView: false, frame: { ...arg } })
        if (op === 'resetView') Object.assign(v, { activeRange: null, atDefaultView: true, frame: { fromRight: 150, toRight: -8, activeRange: null, locked: false, lock: null } })
        if (op === 'setIndicatorsHidden') v.indicatorsHidden = arg
        // the ◀ / ▶ step (stepBar(n): the logical window + n, so right-relative − n) and the price axis menu's Auto-scale
        if (op === 'stepBar') v.frame = { ...v.frame, fromRight: v.frame.fromRight - arg, toRight: v.frame.toRight - arg, activeRange: null }
        if (op === 'autoScale') v.priceAuto = true
        // the + / - zoom (zoomTimeAxis: the width × 0.8 or × 1.25 per press, around the window's centre)
        if (op === 'zoom') { const c = (v.frame.fromRight + v.frame.toRight) / 2, half = ((v.frame.fromRight - v.frame.toRight) * Math.pow(arg.out ? 1.25 : 0.8, arg.steps)) / 2; v.frame = { ...v.frame, fromRight: c + half, toRight: c - half, activeRange: null } }
        // the Position Calculator (StockChart.positionCalc): the tool armed or disarmed, the panel's three prices as strings
        if (op === 'positionCalc') v.positionCalc = { ...v.positionCalc, open: !!arg.open, entry: String(arg.entry ?? ''), stop: String(arg.stop ?? ''), target: String(arg.target ?? ''), direction: arg.direction || v.positionCalc.direction }
        // the Replay bar's own handlers (StockChart replayDo: toggle at 70%, play / pause, step and seek pause it, speed)
        if (op === 'replay') {
          const r = { ...v.replay }, n = r.total, clamp = (i) => Math.max(0, Math.min(n - 1, i))
          if (arg.op === 'enter' && !r.mode) Object.assign(r, { mode: true, playing: false, index: Math.floor(n * 0.7) })
          else if (arg.op === 'restore') Object.assign(r, { mode: true, playing: false, index: clamp(arg.index) })
          else if (r.mode && arg.op === 'exit') Object.assign(r, { mode: false, playing: false, index: null })
          else if (r.mode && arg.op === 'play') r.playing = true
          else if (r.mode && arg.op === 'pause') r.playing = false
          else if (r.mode && arg.op === 'step') Object.assign(r, { playing: false, index: clamp((r.index ?? 0) + arg.n) })
          else if (r.mode && arg.op === 'seek') Object.assign(r, { playing: false, index: clamp(arg.index) })
          else if (r.mode && arg.op === 'seekDate') Object.assign(r, { playing: false, index: Math.max(0, BAR_DAYS.findLastIndex(d => d <= arg.ms + 86399999)) })
          else if (r.mode && arg.op === 'speed') r.speed = arg.speed
          r.dateMs = r.mode && r.index != null ? BAR_DAYS[r.index] : null
          v.replay = r
        }
        return true
      },
      setReplay: (iso) => { st.replay = iso ?? null; return true },
      openSettings: (ref) => { st.settingsOpen[ref] = true; return true },
      askAi: (ref) => { st.askAi.push(`/research/${charts.read(ref)?.symbol}?section=ai`); return true } }
    st.views = views
    // Tools → Custom-Period Sort (ChartsWorkspace runPeriodSort / handleDockPeriodSort), sharing the ONE Replay cutoff above
    const iso = (ymd) => { const s = String(ymd); return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` }
    st.periodSort = { panel: null, marker: null, markerStyle: 'line' }
    const ps = st.periodSort
    let psN = 0
    mounted.h.periodSort = {
      read: () => ({ panel: ps.panel, cutoff: st.replay, marker: ps.marker, markerStyle: ps.markerStyle }),
      run: (a) => {
        ps.panel = { start: a.start, end: a.end, group: a.group || null }
        st.replay = a.replay ? iso(a.end) : null
        ps.marker = a.markStart && a.markStart !== 'off' ? iso(a.start) : null
        if (a.markStart === 'line' || a.markStart === 'candle') ps.markerStyle = a.markStart
        return true
      },
      restore: (was) => { ps.panel = was.panel ? { ...was.panel } : null; st.replay = was.cutoff ?? null; ps.marker = was.marker ?? null; if (was.markerStyle) ps.markerStyle = was.markerStyle; return true },
      dock: () => {
        if (!ps.panel) return null
        const id = `w-periodsort-${++psN}`
        mounted.board.state.widgets = [...mounted.board.state.widgets, { id, type: 'periodsort', color: 'A', x: 0, y: 20, w: 8, h: 10, opts: { ...ps.panel } }]
        ps.panel = null
        return id
      },
      undock: ({ remove, set, panel }) => {
        mounted.board.state.widgets = mounted.board.state.widgets.filter(w => w.id !== remove).map(w => (set?.[w.id] ? { ...w, ...set[w.id] } : w))
        ps.panel = panel ? { ...panel } : null
        return true
      },
      widgets: () => mounted.board.state.widgets,
    }
    // Tools → Compare Symbols (compare.openView): ChartsWorkspace's compare state answering the `uct:compare-open` detail as the
    // workspace (opens a closed panel on the detail's tab) and the open panel (switches its tab) do; the panel's own close
    st.compare = { open: false, tab: null, intent: null }
    const cmp = st.compare
    mounted.h.compare = {
      read: () => ({ here: true, open: cmp.open, tab: cmp.open ? cmp.tab : null, intent: cmp.open ? cmp.intent : null, hasChart: true, scaleLocked: false }),
      open: (d) => { cmp.intent = d; if (!cmp.open) { cmp.open = true; cmp.tab = d?.tab === 'rotation' ? 'rotation' : 'overlay' } else if (d?.tab === 'rotation' || d?.tab === 'overlay') cmp.tab = d.tab; return true },
      close: () => { cmp.open = false; cmp.tab = null; cmp.intent = null; return true },
    }
  }
  if (extra.drawings) {
    for (const c of mounted.h.charts.list()) drawingsStore.clearAll(c.symbol)      // the store is module-level: start empty
    mounted.h.drawings = buildDrawingSource({ list: () => mounted.h.charts.list().map(c => ({ ...c, drawSym: c.symbol })) })      // (a TIMED board's charts carry their view: the loaded history)
    // a case may SEED drawings the Agent cannot draw itself (seed.drawings: { SYM: [drawing] }, e.g. a position for its alerts)
    for (const [sym, list] of Object.entries(seed.drawings || {})) for (const d of list) drawingsStore.addDrawing(sym, d)
  }
  // newsLibrary.*: the News widget's door (the rows it renders) and the member's library, as the library module's own API answers
  // them (seed.newsLibrary: { saved, collections: [names], notes: { id: text }, member: { id: [names] } })
  if (extra.newsLibrary) {
    _resetNewsLibraryForTests()
    const rows = [{ id: 'h1', text: 'SYNTHETIC: AMD guidance raised', tickers: ['AMD'], time: 1 }, { id: 'h2', text: 'SYNTHETIC: Fed minutes due', tickers: [], time: 2 },
      { id: 'h3', text: 'SYNTHETIC: NVDA beats estimates', tickers: ['NVDA'], time: 3 }]
    publishWidgetDoor('n1', () => ({ read: () => ({ search: '', visible: rows, selected: extra.newsSelected || null }) }))
    mounted.h.newsLibrary = newsLibraryStandIn(seed.newsLibrary || {})
    // C3-147: the live feed's pool, as the stream manager holds it (the headline WHOLE: the Notebook capture's source)
    _setNewsFeedForTests(() => rows.map(r => ({ id: r.id, content: r.text, tickers: r.tickers, received_at_ms: r.time })))
  }
  // uctIntelligence.set: each chart's UCT Intelligence gates as StockChart publishes them (ChartPane → ChartWidget agent.uctIntelligence)
  if (extra.uctIntel) {
    const c0 = mounted.h.charts, withUci = (x) => (x ? { ...x, uctIntel: { ...extra.uctIntel } } : x)
    mounted.h.charts = { ...c0, list: () => c0.list().map(withUci), read: (r) => withUci(c0.read(r)) }
  }
  return { p, st, srv, ...mounted }
}

/** The faithful scripted model for one turn's canonical plan (see the header). */
export function faithful(p, plan) {
  const disposition = plan.disposition || 'apply'
  return (body) => {
    const have = new Set((body.capabilities || []).map(c => c.name))
    const missing = plan.ops.map(o => o.action).filter(a => !have.has(a))
    if (!missing.length) return p.env(disposition, resolveOps(plan.ops, body), '')
    if (!body.reroute && body.routing) {
      const groups = [...new Set(missing.map(groupOfAction).filter(Boolean))]
      p.st.envelopes.unshift(faithful(p, plan))           // the reroute's answer
      return { ...p.env('answer', [], ''), need_groups: groups }
    }
    return p.env('answer', [], `«the model was not given: ${missing.join(', ')}»`)
  }
}

export const refusals = () => [...screen.getByTestId('agent-transcript').querySelectorAll('[role="status"]')].filter(e => !e.closest('[data-testid="agent-typing"]') && e.textContent.trim())
export const receiptsNow = () => screen.queryAllByTestId('agent-receipt')
export const proposalsNow = () => screen.queryAllByTestId('agent-proposal').filter(e => e.getAttribute('data-status') === 'pending')

/** The host the deterministic readers see in the panel (setupPanel.mount's decoration: indicators manageable, a label
 *  per chart). A bare fixture host hides every indicator edit phrase from the fast path (it needs canManageIndicators). */
export function panelHost(boardName) {
  const board = makeBoard(...BOARDS[boardName]())
  const base = board.host.charts
  const d = (x) => (x ? { ...x, label: `Chart (${x.symbol})` } : x)
  return { ...board.host, charts: { ...base, list: () => base.list().map(d), read: (r) => d(base.read(r)), canManageIndicators: () => true, canCreateIndicator: () => true, previewHost: () => null, selected: () => null } }
}
