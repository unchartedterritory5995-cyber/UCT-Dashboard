// LIVE-MODEL FLOW CHECK (owner-approved, 2026-10-11 stabilization) — runs ONLY with AGENT_LIVE_RELAY set.
//
// The REAL AgentPanel, on a fixture board (nothing real to change), sends its own /api/agent/turn and
// /api/agent/record requests — routing, the need_groups reroute, history — to a local relay
// (scratchpad live_relay.py) that mirrors api/routers/uct_agent.py on the real store and the real
// turn.run_turn under a hard dollar ceiling. Everything else (Screener fields / scan, conversations)
// is answered here from fixtures. Writes what the panel did to AGENT_LIVE_FLOW_OUT.
import { it, vi, expect } from 'vitest'
import fs from 'node:fs'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import * as screenerMod from './capabilities/screener'
import { makeBoard } from './__fixtures__/board'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
import AgentPanel from './AgentPanel'
registerBuiltins()

const RELAY = globalThis.process?.env?.AGENT_LIVE_RELAY
const FIELDS = globalThis.process?.env?.AGENT_LIVE_FIELDS
const OUT = globalThis.process?.env?.AGENT_LIVE_FLOW_OUT

// a small fixed universe for the scan fixture (ticker, price, RS rank)
const UNIVERSE = [
  ['NVDA', 182.5, 97], ['AMD', 41.2, 95], ['TSLA', 251.0, 93], ['PLTR', 28.4, 99], ['CRWD', 345.0, 96],
  ['SOFI', 14.8, 94], ['MSFT', 431.0, 80], ['HOOD', 46.1, 98],
].map(([ticker, price, rs]) => ({ ticker, company: ticker, price, chg_pct_1d: 1.2, rs_rank: rs, rs_rating: rs }))
const pass = (row, f) => {
  const v = row[f.field ?? f.key]
  if (v === undefined) return true
  const n = Number(f.value ?? f.min)
  if (f.op === 'gt') return v > n
  if (f.op === 'gte') return v >= n
  if (f.op === 'lt') return v < Number(f.value ?? f.max)
  if (f.op === 'lte') return v <= Number(f.value ?? f.max)
  return true
}

it.skipIf(!RELAY)('live flow: strongest → follow-up, and the trading layout (model path)', async () => {
  const realFetch = globalThis.fetch
  const trace = { turns: [], records: [], scans: [], steps: [] }
  let inflight = 0
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
    if (url === '/api/agent/turn' || url === '/api/agent/record') {
      inflight++
      try {
        const r = await realFetch(`${RELAY}${url}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: init.body })
        const b = await r.json()
        if (url === '/api/agent/turn') trace.turns.push({ status: r.status, reroute: !!JSON.parse(init.body).reroute, envelope: b.envelope || null, detail: b.detail || null })
        else trace.records.push(JSON.parse(init.body))
        return json(b, r.status)
      } finally { inflight-- }
    }
    if (url === '/api/screener/fields') return json(JSON.parse(fs.readFileSync(FIELDS, 'utf8')))
    if (url === '/api/screener/fields?options=1') return json({ options: {} })
    if (url === '/api/screener/saved-screens') return json({ saved: [], starters: [{ id: 'starter_momentum_leaders', name: 'Leaders (RS ≥ 90)', spec: {} }, { id: 'starter_stage2_breakout', name: 'Stage-2 breakouts', spec: {} }, { id: 'starter_52w_breakout', name: '52-Week Breakout on Volume', spec: {} }] })
    if (url === '/api/screener/scan') {
      const body = JSON.parse(init.body)
      trace.scans.push(body)
      const rows = UNIVERSE.filter(r => (body.filters || []).every(f => pass(r, f)))
      return json({ total: rows.length, rows, page: 1 })
    }
    return json({ conversations: [] })
  })
  const settle = async () => {
    const box = screen.getByLabelText('Message UCT Agent')
    let quiet = 0
    for (let i = 0; i < 600 && quiet < 6; i++) {
      await new Promise(r => setTimeout(r, 250))
      quiet = (inflight === 0 && !box.disabled) ? quiet + 1 : 0
    }
  }
  const say = async (text, { forceModel = false } = {}) => {
    const box = screen.getByLabelText('Message UCT Agent')
    await waitFor(() => expect(box.disabled).toBe(false), { timeout: 20000 })
    const before = trace.turns.length
    // the layout request is answered by the instant path in the product; a leading zero-width space
    // sends it to the MODEL instead (the relay strips it), which is the path being checked
    fireEvent.change(box, { target: { value: forceModel ? `​${text}` : text } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await settle()
    trace.steps.push({ text, forceModel, turns: trace.turns.slice(before), panel: document.body.textContent.slice(-1500) })
  }

  // 1 · "Show me my strongest stocks." then the follow-up, in ONE conversation
  const lists = [{ id: 'm1', name: 'Momentum', symbols: ['NVDA', 'AMD', 'TSLA', 'PLTR', 'CRWD', 'SOFI', 'HOOD', 'MSFT'] }, { id: 's1', name: 'Swing', symbols: ['MSFT'] }]
  let board = makeBoard([{ id: 'c1', type: 'chart', x: 0, y: 0, w: 18, h: 20 }, { id: 'wl', type: 'watchlist', x: 18, y: 0, w: 6, h: 20, opts: { watchKey: 'user:m1' } }], { A: 'AAPL' }, { watchlists: lists })
  board.host.charts.canManageIndicators = () => true
  render(<AgentPanel host={board.host} onClose={() => {}} />)
  await screenerMod.loadMeta()
  await say('Show me my strongest stocks.')
  await say('Now only the ones above $50.')
  trace.screenBoard = { widgets: board.state.widgets.map(w => ({ id: w.id, type: w.type, opts: w.opts })) }
  cleanup()

  // 2 · "Switch to my trading layout." — a fresh conversation, the model path
  board = makeBoard([{ id: 'c1', type: 'chart', x: 0, y: 0, w: 18, h: 20 }], { A: 'AAPL' }, {
    watchlists: lists,
    layouts: { entries: [{ id: 1, name: 'Main Trading' }, { id: 2, name: 'Swing Setups' }], boards: { 1: [{ id: 'c9', type: 'chart', x: 0, y: 0, w: 24, h: 20 }], 2: [] }, active: 2 },
  })
  render(<AgentPanel host={board.host} onClose={() => {}} />)
  await say('Switch to my trading layout.', { forceModel: true })
  trace.layoutCalls = board.state.layouts?.calls || []
  trace.activeLayout = board.host.layouts.snapshot().active
  cleanup()

  fs.writeFileSync(OUT, JSON.stringify(trace, null, 2))
}, 600000)
