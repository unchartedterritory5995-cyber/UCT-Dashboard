// REAL-MODEL SMOKE TEST — request capture (Context + Breadth release). Runs ONLY with AGENT_SMOKE_OUT set.
//
// Builds the exact /api/agent/turn bodies the panel sends for the six owner-approved smoke questions
// (same manifest, routing and workspace context — a board with a layout trail and a SELECTED chart,
// and the breadth DATES-ONLY context) with no model call, and records whether UCT's instant path
// answers each one in the product. tools/agent_smoke_context_breadth.py sends the bodies to the real
// model under a hard ceiling. No breadth value exists anywhere here: the context carries dates only.
import { it, vi, expect } from 'vitest'
import fs from 'node:fs'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { loadBreadthDates, _resetBreadthDates } from './capabilities/breadth'
import { makeBoard } from './__fixtures__/board'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
import AgentPanel from './AgentPanel'
registerBuiltins()

const OUT = globalThis.process?.env?.AGENT_SMOKE_OUT
// a leading zero-width space defeats every instant phrase (written as a char code: no invisible source)
const ZW = String.fromCharCode(0x200b)

export const SMOKE = [
  { id: 'q1-breadth-value', say: 'What % of US stocks are above their 50-day?' },
  { id: 'q2-breadth-compare', say: 'How does that compare with a month ago?', history: 'q1-breadth-value' },
  { id: 'q3-breadth-page', say: 'Take me to the breadth page.' },
  { id: 'q4-breadth-news', say: "What's breadth today and the latest NVDA news?" },
  { id: 'q5-previous-layout', say: 'Switch back to the previous layout.' },
  { id: 'q6-this-chart-rsi', say: 'Add RSI to this chart.' },
]

const ENTRIES = [{ id: 11, name: 'Main Trading', scope: 'user' }, { id: 12, name: 'Swing Board', scope: 'user' }]

function board() {
  const b = makeBoard([
    { id: 'c1', type: 'chart', x: 0, y: 0, w: 12, h: 20 },
    { id: 'c2', type: 'chart', x: 12, y: 0, w: 12, h: 20 },
  ], { A: 'AAPL', B: 'NVDA' }, { layouts: { entries: ENTRIES, boards: {}, active: 12 } })
  // this tab's layout trail (Context 1A) and the chart the member last clicked (Context 1B)
  const snap = b.host.layouts.snapshot
  b.host.layouts = { ...b.host.layouts, snapshot: () => ({ ...snap(), recent: [{ id: 11, name: 'Main Trading' }] }) }
  const sel = (c) => (c && c.ref === 'c2' ? { ...c, selected: true } : c)
  const { list, read } = b.host.charts
  b.host.charts = { ...b.host.charts, list: () => list().map(sel), read: (id) => sel(read(id)), selected: () => 'c2' }
  b.host.navigate = () => {}
  b.host.charts.canManageIndicators = () => true
  return b
}

it.skipIf(!OUT)('capture the smoke-test requests', async () => {
  const out = []
  let bodies = []
  let priorPlan = false
  _resetBreadthDates()
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } })
    if (url === '/api/agent/breadth/dates') return json({ today_et: '2026-10-11', latest_finalized: { us: '2026-10-09', nyse: '2026-10-09', nasdaq: '2026-10-09' } })
    if (url === '/api/agent/turn') {
      const body = JSON.parse(init.body)
      bodies.push(body)
      // the PRIOR turn of a follow-up is answered with the breadth plan a correct model returns, so the
      // panel carries its routing groups forward exactly as in the product
      const prior = priorPlan && bodies.length === 1
      const ref = body.context?.breadth?.[0]?.ref
      const envelope = prior ? { disposition: 'apply', reply: '', question: null, unsupported_category: null,
        ops: [{ action: 'breadth.show', target: ref, args: { mode: 'value', universe: 'us', metrics: ['pct_above_50sma'], date: null, compare_date: null, start: null, end: null } }] }
        : { disposition: 'answer', reply: 'ok', question: null, ops: [], unsupported_category: null }
      return json({ conversationId: 'c', envelope, usage: {} })
    }
    if (url === '/api/agent/breadth') return json({ status: 'ok', text: 'US · % Above 50-Day: 73.5% on 2026-10-09. (synthetic)', table: null })
    return json({ conversations: [] })
  })
  await loadBreadthDates()
  const { fastParse } = await import('./fastPath')
  for (const q of SMOKE) {
    bodies = []
    const b = board()
    render(<AgentPanel host={b.host} onClose={() => {}} />)
    const box = screen.getByLabelText('Message UCT Agent')
    await waitFor(() => expect(box.disabled).toBe(false))
    const fast = fastParse(q.say, { host: b.host })
    const prior = q.history ? SMOKE.find(x => x.id === q.history) : null
    priorPlan = !!prior
    if (prior) {                                     // the earlier turn, in the SAME panel
      fireEvent.change(box, { target: { value: `${ZW}${prior.say}` } })
      fireEvent.keyDown(box, { key: 'Enter' })
      await screen.findByText(/synthetic/, {}, { timeout: 6000 })
      await waitFor(() => expect(box.disabled).toBe(false), { timeout: 6000 })
    }
    const before = bodies.length
    // the MODEL's reading is what is measured: a leading zero-width space defeats every instant phrase
    fireEvent.change(box, { target: { value: `${ZW}${q.say}` } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(bodies.length).toBeGreaterThan(before), { timeout: 6000 })
    const body = bodies[before]
    body.message = q.say
    out.push({ id: q.id, history: q.history || null, instantInProduct: fast ? { kind: fast.kind, ops: fast.ops || null } : null, body })
    cleanup()
  }
  fs.writeFileSync(OUT, JSON.stringify(out))
}, 120000)
