// LAYOUT-CLARIFY CONTINUITY (live production 2026-11-13, owner testing) — through the REAL panel (AgentPanel + useAgent +
// registry, routing, runtime, receipts and Undo) on the REAL board writer (fixture board). Stand-in: the Agent model
// (/api/agent/turn), scripted. No paid model call.
//   Board: two charts, SPY (left) and NVDA (right).
//   Member: "Change my chart layout to a 2-by-2 grid, keeping SPY and NVDA in the layout."
//   Agent (model clarify): which two tickers should I add?
//   Member: "Add AAPL and MSFT as the other two charts"
//   LIVE (wrong): still 2 panels, SPY→AAPL and NVDA→MSFT, "Set up two charts for AAPL and MSFT" — the answer was set aside as a
//   NEW request and the instant path ran it alone (chartGrid.set reusing — re-symbolling — both kept charts).
//   Expected: the answer continues the pending task: 4 panels SPY, NVDA, AAPL, MSFT.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { makeBoard } from './__fixtures__/board'
import { mergeChartSettings } from '../components/chart/chartDefaults'
import { AuthContext } from '../context/AuthContext'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
import AgentPanel from './AgentPanel'

registerBuiltins()

let envelopes, calls
const env = (disposition, ops, reply = '', question = null) => ({ disposition, reply, question, ops, unsupported_category: null })
beforeEach(() => {
  envelopes = []; calls = []
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
const idle = () => waitFor(() => expect(screen.queryByTestId('agent-typing')).toBeNull(), { timeout: 10000 })

function mount(widgets, groupSyms) {
  const board = makeBoard(widgets, groupSyms)
  const base = board.host.charts
  const h = {
    ...board.host,
    charts: { ...base, canManageIndicators: () => true, canCreateIndicator: () => true, previewHost: () => null, selected: () => null },
    persist: async () => ({ ok: true }),
  }
  render(<AuthContext.Provider value={{ user: { id: 1, role: 'admin' } }}><AgentPanel host={h} onClose={() => {}} /></AuthContext.Provider>)
  const box = screen.getByLabelText('Message UCT Agent')
  const say = async (t) => { await idle(); fireEvent.change(box, { target: { value: t } }); fireEvent.keyDown(box, { key: 'Enter' }); await idle() }
  return { board, h, say }
}
const chartsOf = (board) => board.state.widgets.filter(w => w.type === 'chart').sort((a, b) => (a.y - b.y) || (a.x - b.x))
const settings = () => ({ settings: mergeChartSettings(null) })
const syms = (board, h) => chartsOf(board).map(w => h.charts.read(w.id).symbol)
// the production board: SPY on the left, NVDA on the right
const SPY_NVDA = () => [['c1', 'c2'].map((id, i) => ({ id, type: 'chart', x: i * 12, y: 0, w: 12, h: 20, color: 'N', opts: settings() })), { 'N:c1': 'SPY', 'N:c2': 'NVDA' }]

const ASK = 'Change my chart layout to a 2-by-2 grid, keeping SPY and NVDA in the layout.'
const QUESTION = 'Which two tickers should I add to fill the other two charts of the 2×2 grid?'
const REPLY = 'Add AAPL and MSFT as the other two charts'
const clarify = () => env('clarify', [], QUESTION, { text: QUESTION, choices: [] })
// what a correct model plans for the continued task: the 2x2 of the kept charts and the two answered tickers
const fourGrid = () => env('apply', [{ action: 'chartGrid.set', target: 'board', args: { symbols: ['SPY', 'NVDA', 'AAPL', 'MSFT'], timeframe: null, layout: 'grid', new_charts: null, watchlist: null, replace: null } }])

describe('LAYOUT-CLARIFY continuity · a reply to the Agent\'s own question continues the pending task', () => {
  it('production repro: SPY + NVDA kept, AAPL + MSFT added — 4 panels, never SPY→AAPL / NVDA→MSFT', async () => {
    const { board, h, say } = mount(...SPY_NVDA())
    envelopes.push(clarify())
    await say(ASK)
    expect(transcript()).toContain(QUESTION)
    expect(syms(board, h)).toEqual(['SPY', 'NVDA'])
    envelopes.push(fourGrid())
    await say(REPLY)
    // LIVE bug: ['AAPL', 'MSFT'] (both kept charts re-symbolled, still 2 panels)
    expect(syms(board, h)).toEqual(['SPY', 'NVDA', 'AAPL', 'MSFT'])
    // the answer went back to the model, which has the question and the original request in its conversation
    expect(turnBodies()).toHaveLength(2)
    expect(turnBodies()[1].message).toBe(REPLY)
    // never set aside as a new request
    expect(turnBodies()[1].context?.conversation_memory?.question_set_aside).not.toBe(true)
    expect(chartsOf(board)).toHaveLength(4)
    expect(syms(board, h)).toEqual(['SPY', 'NVDA', 'AAPL', 'MSFT'])
    expect(transcript()).not.toMatch(/Set up two charts for AAPL and MSFT/)
  }, 30000)
})
