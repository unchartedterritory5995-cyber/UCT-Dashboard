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
import { buildDrawingSource, buildFlaggedSource, buildIndicatorAlertSource, buildListViewSource } from '../../../host'
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
import * as nativeRegistry from '../../../../components/chart/engine/nativeRegistry'
import { _resetAgentConfig, loadAgentConfig } from '../../../agentClient'

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
  // saved watchlists behind the real routes' semantics (__fixtures__/board.js)
  WATCH: () => [[chart('c1', 0, 0, 24, 20)], { 'N:c1': 'NVDA' }, { watchlists: [{ id: 'w1', name: 'Momentum', symbols: ['NVDA', 'TSLA'] }, { id: 'w2', name: 'Earnings', symbols: ['AAPL'] }] }],
  // PKG2: a half-width chart (room for new charts) + the saved watchlists — a screen's results go to a list and onto new charts
  SCAN: () => [[chart('c1', 0, 0, 12, 20)], { 'N:c1': 'NVDA' }, { watchlists: [{ id: 'w1', name: 'Momentum', symbols: ['NVDA', 'TSLA'] }, { id: 'w2', name: 'Earnings', symbols: ['AAPL'] }] }],
  // + the chart's drawings (the real drawings store through host.buildDrawingSource) and the indicator-alert library
  //   (the real hook writers through host.buildIndicatorAlertSource over the fixture /api/indicator-alerts below)
  DRAW: () => [[chart('c1', 0, 0, 24, 20)], { 'N:c1': 'NVDA' }, { drawings: true }],
  IALERTS: () => [[{ id: 'c1', type: 'chart', x: 0, y: 0, w: 24, h: 20, color: 'N', opts: { settings: { indicatorInstances: [
    { instanceId: 'inst:rsi:1', defId: 'rsi', inputs: { period: 14 } }] } } }], { 'N:c1': 'NVDA' }, { indicatorAlerts: true }],
  // + the TIME NAVIGATOR over the synthetic history (view, go-to-date, Replay Mode) and the chart's drawings
  TIMED: () => [[chart('c1', 0, 0, 24, 20)], { 'N:c1': 'NVDA' }, { timeNav: true, drawings: true }],
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
  FOUR: () => [['c1', 'c2', 'c3', 'c4'].map((id, i) => chart(id, (i % 2) * 12, Math.floor(i / 2) * 10, 12, 10)),
    { 'N:c1': 'SPY', 'N:c2': 'QQQ', 'N:c3': 'NVDA', 'N:c4': 'TSLA' }],
}

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
  const st = { log: [], replay: null, views: {}, screens: seed.screens || [{ id: 7, name: 'Momentum Screen', spec: { filters: [{ key: 'adr_pct', op: 'gt', min: 5 }] } }], prefs: { theme: 'dark', default_chart_tf: 'D', alert_sound: 'on', alert_sound_type: 'chime', ...(seed.prefs || {}) }, builderCalls: [], defs: new Map(), ialerts: (seed.indicatorAlerts || []).map(a => ({ user_id: 1, active: true, state: 'armed', created_at: 1, scope: null, ...a })), alerts: (seed.alerts || []).map(a => ({ user_id: 'me', is_active: 1, triggered_at: null, created_at: '2026-11-03T13:00:00Z', alert_type: 'price', drawing_id: null, ...a })) }
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
      return json({ tracings_doc: { updatedAt: 1, doc: { activeId: id, byTracing: { [id]: Object.fromEntries(syms.map(sy => [sy, drawingsStore.peekDrawings(sy)])) } } } })
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
    if (u === '/api/screener/fields?options=1') return json({ fields: FIELDS, options: FIELD_OPTIONS })
    if (u === '/api/screener/fields' || u.startsWith('/api/screener/fields?')) return json({ fields: FIELDS })
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
      activeRange: null, atDefaultView: false, indicatorsHidden: false, frame: { fromRight: 120, toRight: -8, activeRange: null, locked: false, lock: null } })
    st.replay = null
    const charts = mounted.h.charts
    const withTime = (x) => (x ? { ...x, view: { ...viewOf(x.ref) }, replay: st.replay } : x)
    mounted.h.charts = { ...charts, list: () => charts.list().map(withTime), read: (r) => withTime(charts.read(r)),
      goTo: (ref, ms) => { viewOf(ref).rightMs = ms >= BAR_DAYS.at(-1) ? BAR_DAYS.at(-1) : lastOnOrBefore(ms); return true },
      // the chart's own view controls (StockChart.applyRange / restoreView / resetView / setIndicatorsHidden), as getDateMeta reads them back
      viewDo: (ref, op, arg) => {
        const v = viewOf(ref)
        if (op === 'applyRange') Object.assign(v, { activeRange: arg, atDefaultView: false, frame: { fromRight: 252, toRight: -8, activeRange: arg, locked: true, lock: { hLocked: true } } })
        if (op === 'restoreView') Object.assign(v, { activeRange: arg.activeRange, atDefaultView: false, frame: { ...arg } })
        if (op === 'resetView') Object.assign(v, { activeRange: null, atDefaultView: true, frame: { fromRight: 150, toRight: -8, activeRange: null, locked: false, lock: null } })
        if (op === 'setIndicatorsHidden') v.indicatorsHidden = arg
        return true
      },
      setReplay: (iso) => { st.replay = iso ?? null; return true } }
    st.views = views
  }
  if (extra.drawings) {
    for (const c of mounted.h.charts.list()) drawingsStore.clearAll(c.symbol)      // the store is module-level: start empty
    mounted.h.drawings = buildDrawingSource({ list: () => mounted.h.charts.list().map(c => ({ ...c, drawSym: c.symbol })) })      // (a TIMED board's charts carry their view: the loaded history)
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
