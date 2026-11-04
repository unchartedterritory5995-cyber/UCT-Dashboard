// W2 FOLLOW-UPS to #766 (agent/w2/nl-multiaction-followups) — the REAL panel (AgentPanel + useAgent + registry, routing,
// planner, policy, runtime, receipts and Undo) on the REAL board writer (fixture board). Stand-in: the Agent model
// (/api/agent/turn), scripted per test. No paid model call. Asserts workspace state and receipts, not prose.
//   N1  #766 review nits: structural "chart" Undo match; a withdrawn which-chart question keeps no live choices;
//       ONE coherent message for a partial Undo-all planned first
//   M3  add widgets + change existing ones in ONE request: run in a defined order, ONE grouped Undo, safe partial
//       completion; refused (with the two-step wording) where rollback can't be guaranteed
//   R   multi-op receipts name every chart (symbol + timeframe) and setting; no "already" for new charts
//   C   "change it to weekly" / "add the 20 EMA to that one" right after creating a chart → the chart just created
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { makeBoard } from './__fixtures__/board'
import { mergeChartSettings } from '../components/chart/chartDefaults'
import { touchesCharts } from './useAgent'
import { AuthContext } from '../context/AuthContext'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
import AgentPanel from './AgentPanel'

registerBuiltins()

let envelopes, calls, saveFails
const env = (disposition, ops, reply = '') => ({ disposition, reply, question: null, ops, unsupported_category: null })
beforeEach(() => {
  envelopes = []; calls = []; saveFails = false
  try { localStorage.clear() } catch { /* */ }
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null
    calls.push([init.method || 'GET', String(url), body])
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
    if (url === '/api/agent/turn') {
      const e = envelopes.shift()
      return json({ conversationId: 'ac_1', envelope: typeof e === 'function' ? e(body) : (e || env('answer', [], 'NO SCRIPTED MODEL TURN')), usage: { research_calls: 0, citations: [] } })
    }
    if (url === '/api/agent/record') return json({ conversationId: 'ac_1' })
    const q = /ticker-search\?q=([^&]+)/.exec(String(url))
    if (q) return json({ results: [{ ticker: decodeURIComponent(q[1]).toUpperCase() }] })
    if (String(url).startsWith('/api/live-prices')) return json({})
    return json({ conversations: [] })
  })
})
afterEach(() => { vi.restoreAllMocks(); cleanup() })

const turnBodies = () => calls.filter(c => c[1] === '/api/agent/turn').map(c => c[2])
const transcript = () => screen.getByTestId('agent-transcript').textContent
const receipts = () => screen.queryAllByTestId('agent-receipt')
const summaries = () => screen.queryAllByTestId('agent-receipt-summary').map(n => n.textContent)
const idle = () => waitFor(() => expect(screen.queryByTestId('agent-typing')).toBeNull(), { timeout: 10000 })

function mount(widgets, groupSyms, extra = {}, boardOpts = {}) {
  const board = makeBoard(widgets, groupSyms, boardOpts)
  const base = board.host.charts
  const h = {
    ...board.host,
    charts: { ...base, canManageIndicators: () => true, canCreateIndicator: () => true, previewHost: () => null, selected: () => null },
    persist: async () => (saveFails ? { ok: false, reason: 'not-saved' } : { ok: true }),
    ...extra,
  }
  render(<AuthContext.Provider value={{ user: { id: 1, role: 'admin' } }}><AgentPanel host={h} onClose={() => {}} /></AuthContext.Provider>)
  const box = screen.getByLabelText('Message UCT Agent')
  const say = async (t) => { await idle(); fireEvent.change(box, { target: { value: t } }); fireEvent.keyDown(box, { key: 'Enter' }); await idle(); if (process.env.DUMP) console.log('DUMP>>', t, '=>', transcript().slice(-600)) }
  return { board, h, say }
}
// the board's shape (widgets, cells, links) + each chart's ticker and timeframe — what an Undo must restore
const shape = (board, h) => JSON.stringify(board.state.widgets.map(w => [w.id, w.type, w.x, w.y, w.w, w.h, w.color, h.charts.read(w.id)?.symbol || null, h.charts.read(w.id)?.tf || null, JSON.stringify(w.opts?.settings?.indicatorInstances || null)]))
const chartsOf = (board) => board.state.widgets.filter(w => w.type === 'chart').sort((a, b) => (a.y - b.y) || (a.x - b.x))
const settings = () => ({ settings: mergeChartSettings(null) })
const ref = (b, key) => b.context[key][0].ref
const HALF = () => [[{ id: 'c1', type: 'chart', x: 0, y: 0, w: 12, h: 20, color: 'A', opts: settings() }], { A: 'SPY' }]
const TWO = () => [[
  { id: 'c1', type: 'chart', x: 0, y: 0, w: 12, h: 20, color: 'A', opts: settings() },
  { id: 'c2', type: 'chart', x: 12, y: 0, w: 12, h: 20, color: 'B', opts: settings() },
], { A: 'NVDA', B: 'AMD' }]


describe('probe', () => {
  for (const [first, then] of [['add a QQQ chart', 'change it to weekly'], ['add a QQQ chart', 'add the 50 SMA to that one'], ['add a QQQ chart', 'make that one weekly'],
    ['add a QQQ chart', 'put the RSI on it'], ['add a QQQ chart', 'switch the new one to the 5 minute'], ['add a QQQ chart', 'make the new chart weekly']]) {
    it(first + ' -> ' + then, async () => {
      const { board, h, say } = mount(...HALF())
      await say(first)
      await say(then)
      console.log('W>>', then, '|', turnBodies().length, JSON.stringify(chartsOf(board).map(w => [h.charts.read(w.id).symbol, h.charts.read(w.id).tf, (JSON.stringify(w.opts?.settings?.indicatorInstances || []).match(/defId":"[a-zA-Z]+/g) || []).join(',')])), transcript().slice(-250))
    }, 30000)
  }
})
