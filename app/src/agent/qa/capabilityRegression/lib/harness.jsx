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
import { groupOfAction } from '../../../routing'
import { configFor, PROD_KINDS } from './registry'

const chart = (id, x, y, w, h) => ({ id, type: 'chart', x, y, w, h, color: 'N', opts: { settings: bareSettings() } })
/** Named fixture boards. Charts are bare (the default 9/20/50/200 overlays removed, as a member's removal leaves them). */
export const BOARDS = {
  EMPTY: () => [[], {}],
  ONE: () => [[chart('c1', 0, 0, 24, 20)], { 'N:c1': 'NVDA' }],
  ONE_SPY: () => [[chart('c1', 0, 0, 24, 20)], { 'N:c1': 'SPY' }],
  HALF: () => [[chart('c1', 0, 0, 12, 20)], { 'N:c1': 'NVDA' }],
  TWO: () => [[chart('c1', 0, 0, 12, 20), chart('c2', 12, 0, 12, 20)], { 'N:c1': 'NVDA', 'N:c2': 'AMD' }],
  FOUR: () => [['c1', 'c2', 'c3', 'c4'].map((id, i) => chart(id, (i % 2) * 12, Math.floor(i / 2) * 10, 12, 10)),
    { 'N:c1': 'SPY', 'N:c2': 'QQQ', 'N:c3': 'NVDA', 'N:c4': 'TSLA' }],
}

// Synthetic screener catalog / universe (never real values)
const FIELDS = [{ key: 'adr_pct', label: 'ADR %', type: 'range', unit: '%' }, { key: 'price', label: 'Price', type: 'range', unit: '$' },
  { key: 'chg_pct', label: 'Change %', type: 'range', unit: '%' }, { key: 'rel_volume', label: 'Rel Volume', type: 'range', unit: 'x' }]
const UNIVERSE = Array.from({ length: 12 }, (_, i) => ({ ticker: `T${String(i + 1).padStart(2, '0')}`, adr_pct: 2 + i, price: 10 + i * 5, chg_pct: i - 3, rel_volume: 0.5 + i * 0.25 }))

/** A JSON-able snapshot of the board (widgets + link-group symbols): equality = nothing changed. */
export const boardState = (board) => JSON.stringify({ widgets: board.state.widgets, groupSyms: board.state.groupSyms })
export const chartsOf = (board) => board.state.widgets.filter(w => w.type === 'chart').sort((a, b) => (a.y - b.y) || (a.x - b.x))

/** Resolve a canonical op's symbolic target ("$charts[0]", "$workspace", "$board", "$indicatorEdits[0]", "new1") from the request context. */
export function resolveTarget(t, body) {
  const m = /^\$([A-Za-z]+)(?:\[(\d+)\])?$/.exec(String(t || ''))
  if (!m) return t
  const list = body?.context?.[m[1]]
  return Array.isArray(list) && list[Number(m[2] || 0)] ? list[Number(m[2] || 0)].ref : `missing:${t}`
}
export const resolveOps = (ops, body) => ops.map(o => ({ ...o, target: resolveTarget(o.target, body), args: o.args }))

export function mountCase(boardName = 'ONE', { kinds = PROD_KINDS } = {}) {
  const p = setupPanel()
  const st = { log: [] }
  const base = globalThis.fetch
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url); const method = init.method || 'GET'
    const body = init.body ? JSON.parse(init.body) : null
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
    if (u === '/api/agent/turn' || u === '/api/agent/record' || u.startsWith('/api/ticker-search') || u.startsWith('/api/user-definitions')) return base(url, init)
    p.st.calls.push([method, u, body])
    if (u === '/api/agent/config') return json(configFor(kinds))
    if (u.startsWith('/api/watchlist-alerts')) {
      if (method === 'POST') return json({ id: 'new1', user_id: 'me', sym: body.sym, target_price: body.target_price, direction: body.direction, is_active: 1, triggered_at: null, alert_type: body.alert_type || 'price' })
      if (method === 'DELETE') return json({ ok: true })
      return json([])
    }
    if (u === '/api/screener/fields' || u.startsWith('/api/screener/fields?')) return json({ fields: FIELDS })
    if (u === '/api/screener/saved-screens') return json({ saved: [], starters: [] })
    if (u === '/api/screener/scan') {
      const ok = (r, f) => (f.op === 'gt' ? r[f.key] > f.min : f.op === 'lt' ? r[f.key] < f.max : true)
      const rows = UNIVERSE.filter(r => (body.filters || []).every(f => ok(r, f)))
      return json({ total: rows.length, rows: rows.slice(0, body.page_size || 25), snapshot_date: '2026-10-07' })
    }
    // every other read answers EMPTY / unavailable: the corpus asserts WHICH canonical read ran, never a figure
    if (u === '/api/agent/data') return json({ contract: 'MD-1.0', kind: body?.kind, params_echo: body?.params, status: 'unavailable', notes: [], data: null })
    return base(url, init)
  }
  const mounted = p.mount(...BOARDS[boardName]())
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
