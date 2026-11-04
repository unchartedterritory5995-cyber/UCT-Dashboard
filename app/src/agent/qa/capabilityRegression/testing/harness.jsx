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
import { screen } from '@testing-library/react'
import { setupPanel, bareSettings } from '../../../testing/panelHarness'
import { makeBoard } from '../../../__fixtures__/board'
import { buildDrawingSource, buildIndicatorAlertSource } from '../../../host'
import * as drawingsStore from '../../../../components/chart/drawingsStore'
import { groupOfAction } from '../../../routing'
import { configFor, PROD_KINDS } from './registry'

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
  // + the chart's drawings (the real drawings store through host.buildDrawingSource) and the indicator-alert library
  //   (the real hook writers through host.buildIndicatorAlertSource over the fixture /api/indicator-alerts below)
  DRAW: () => [[chart('c1', 0, 0, 24, 20)], { 'N:c1': 'NVDA' }, { drawings: true }],
  IALERTS: () => [[{ id: 'c1', type: 'chart', x: 0, y: 0, w: 24, h: 20, color: 'N', opts: { settings: { indicatorInstances: [
    { instanceId: 'inst:rsi:1', defId: 'rsi', inputs: { period: 14 } }] } } }], { 'N:c1': 'NVDA' }, { indicatorAlerts: true }],
  // four charts on their DEFAULT settings: every chart carries its own EMA 9 / EMA 20 (the same names, ids ovl:0 / ovl:1)
  FOUR_DEFAULT: () => [['c1', 'c2', 'c3', 'c4'].map((id, i) => ({ id, type: 'chart', x: (i % 2) * 12, y: Math.floor(i / 2) * 10, w: 12, h: 10, color: 'N', opts: {} })),
    { 'N:c1': 'SPY', 'N:c2': 'QQQ', 'N:c3': 'NVDA', 'N:c4': 'TSLA' }, { indicatorAlerts: true }],
  FOUR: () => [['c1', 'c2', 'c3', 'c4'].map((id, i) => chart(id, (i % 2) * 12, Math.floor(i / 2) * 10, 12, 10)),
    { 'N:c1': 'SPY', 'N:c2': 'QQQ', 'N:c3': 'NVDA', 'N:c4': 'TSLA' }],
}

// Synthetic screener catalog / universe (never real values)
const FIELDS = [{ key: 'adr_pct', label: 'ADR %', type: 'range', unit: '%' }, { key: 'price', label: 'Price', type: 'range', unit: '$' },
  { key: 'chg_pct', label: 'Change %', type: 'range', unit: '%' }, { key: 'rel_volume', label: 'Rel Volume', type: 'range', unit: 'x' }]
// the indicator-alert catalog as the evaluator serves it (indicator_alert_evaluator.alert_catalog), RSI + the MA cross (train 3)
const OSC = [{ value: 'above', label: 'Above threshold', needs_threshold: true }, { value: 'below', label: 'Below threshold', needs_threshold: true },
  { value: 'cross_above', label: 'Crosses above', needs_threshold: true }, { value: 'cross_below', label: 'Crosses below', needs_threshold: true }]
const XC = [{ value: 'cross_above', label: 'Fast MA crosses above slow MA', needs_threshold: false }, { value: 'cross_below', label: 'Fast MA crosses below slow MA', needs_threshold: false }]
const IA_CATALOG = [
  { indicator: 'rsi', label: 'RSI', conditions: OSC, default_threshold: 70, plots: [{ value: 'rsi', label: 'RSI', conditions: OSC, default_threshold: 70, inputs: { period: 14 }, instance_label: 'RSI (14)' }] },
  { indicator: 'ma_cross', label: 'MA Cross', conditions: XC, default_threshold: null, plots: [{ value: 'ma_cross', label: 'MA Cross', conditions: XC, default_threshold: null,
    inputs: { ma_type: 'ema', fast: 9, slow: 20 }, instance_defs: ['movingAverage'], instance_label: 'EMA(9) vs EMA(20)' }] },
]
const LOWER_OK = new Set(['NVDA', 'TSLA', 'AMD', 'AAPL', 'QQQ'])
const UNIVERSE = Array.from({ length: 12 }, (_, i) => ({ ticker: `T${String(i + 1).padStart(2, '0')}`, adr_pct: 2 + i, price: 10 + i * 5, chg_pct: i - 3, rel_volume: 0.5 + i * 0.25 }))

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
  const m = /^\$([A-Za-z]+)(?:\[(\d+)\])?$/.exec(String(t || ''))
  if (!m) return t
  const list = body?.context?.[m[1]]
  return Array.isArray(list) && list[Number(m[2] || 0)] ? list[Number(m[2] || 0)].ref : `missing:${t}`
}
export const resolveOps = (ops, body) => ops.map(o => ({ ...o, target: resolveTarget(o.target, body), args: o.args }))

export function mountCase(boardName = 'ONE', { kinds = PROD_KINDS, seed = {} } = {}) {
  const p = setupPanel()
  const st = { log: [], ialerts: (seed.indicatorAlerts || []).map(a => ({ user_id: 1, active: true, state: 'armed', created_at: 1, scope: null, ...a })), alerts: (seed.alerts || []).map(a => ({ user_id: 'me', is_active: 1, triggered_at: null, created_at: '2026-11-03T13:00:00Z', alert_type: 'price', drawing_id: null, ...a })) }
  const base = globalThis.fetch
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url); const method = init.method || 'GET'
    const body = init.body ? JSON.parse(init.body) : null
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
    if (u === '/api/agent/turn' || u === '/api/agent/record' || u.startsWith('/api/ticker-search') || u.startsWith('/api/user-definitions')) return base(url, init)
    p.st.calls.push([method, u, body])
    if (u === '/api/agent/config') return json(configFor(kinds))
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
        const row = { id: `new${st.alerts.length + 1}`, user_id: 'me', sym: String(body.sym).toUpperCase(), target_price: body.target_price, direction: body.direction, is_active: 1, triggered_at: null, created_at: '2026-11-04T13:00:00Z', alert_type: body.alert_type || 'price', drawing_id: null }
        st.alerts = [row, ...st.alerts]
        return json(row)
      }
      if (method === 'DELETE') { const id = decodeURIComponent(u.split('/').pop()); st.alerts = st.alerts.filter(r => r.id !== id); return json({ ok: true }) }
      return json(st.alerts)
    }
    if (u === '/api/screener/fields' || u.startsWith('/api/screener/fields?')) return json({ fields: FIELDS })
    if (u === '/api/screener/saved-screens') return json({ saved: [{ id: 7, name: 'Momentum Screen', spec: { filters: [{ key: 'adr_pct', op: 'gt', min: 5 }] } }], starters: [] })
    if (u === '/api/screener/scan') {
      const ok = (r, f) => (f.op === 'gt' ? r[f.key] > f.min : f.op === 'lt' ? r[f.key] < f.max : true)
      const rows = UNIVERSE.filter(r => (body.filters || []).every(f => ok(r, f)))
      return json({ total: rows.length, rows: rows.slice(0, body.page_size || 25), snapshot_date: '2026-10-07' })
    }
    // every other read answers EMPTY / unavailable: the corpus asserts WHICH canonical read ran, never a figure
    // instrument.resolve as the server answers it (MD-1 §4.7, instruments.py): a symbol typed in capitals resolves; a lowercase
    // one resolves only when §4.7.5 confirms it ('nvda' yes; 'spy', 'gold' no — the neutral ask)
    if (u === '/api/agent/data' && body?.kind === 'instrument.resolve') {
      const results = (body.params?.symbols || []).map(c => { const t = String(c?.text ?? c).replace(/^\$/, ''); return (t === t.toUpperCase() || LOWER_OK.has(t.toUpperCase())) ? { input: c?.text ?? c, class: 'symbol', symbol: t } : { input: c?.text ?? c, class: 'symbol_typed_lowercase', symbol: t.toUpperCase() } })
      return json({ contract: 'MD-1.0', kind: body.kind, params_echo: body.params, status: 'ok', notes: [], data: { results } })
    }
    if (u === '/api/agent/data') return json({ contract: 'MD-1.0', kind: body?.kind, params_echo: body?.params, status: 'unavailable', notes: [], data: null })
    return base(url, init)
  }
  const spec = BOARDS[boardName]()
  const mounted = p.mount(...spec)
  const extra = spec[2] || {}
  if (extra.indicatorAlerts) mounted.h.indicatorAlerts = buildIndicatorAlertSource()
  if (extra.drawings) {
    for (const c of mounted.h.charts.list()) drawingsStore.clearAll(c.symbol)      // the store is module-level: start empty
    mounted.h.drawings = buildDrawingSource({ list: () => mounted.h.charts.list().map(c => ({ ...c, drawSym: c.symbol })) })
  }
  return { p, st, ...mounted }
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
