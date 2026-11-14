// ⛔ KEEP ≠ RE-CREATE (live #1210 follow-up, owner 2026-11-14) — through the REAL panel (AgentPanel + useAgent + registry,
// planner, rail, runtime, receipts and Undo) on the REAL board writer (fixture board). Stand-in: the Agent model, scripted.
//   Board: SPY (left), NVDA (right).
//   Member: "Add AAPL and MSFT to my charts, but keep SPY and NVDA."
//   Agent (model clarify): how should I arrange the four charts? — the member CLICKS "All four in a grid".
//   LIVE (wrong): SIX panels — SPY, NVDA, SPY, NVDA, AAPL, MSFT ("Added four new charts for SPY, NVDA, AAPL and MSFT beside your
//   2 charts, re-tiled evenly"). Expected: FOUR — the two kept panels (same widgets) + AAPL + MSFT.
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
    const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } })
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

export const turnBodies = () => calls.filter(c => c[1] === '/api/agent/turn').map(c => c[2])
const transcript = () => screen.getByTestId('agent-transcript').textContent
const idle = () => waitFor(() => expect(screen.queryByTestId('agent-typing')).toBeNull(), { timeout: 10000 })
const settings = () => ({ settings: mergeChartSettings(null) })
export function mount(widgets, groupSyms) {
  const board = makeBoard(widgets, groupSyms)
  const h = { ...board.host, charts: { ...board.host.charts, canManageIndicators: () => true, canCreateIndicator: () => true, previewHost: () => null, selected: () => null }, persist: async () => ({ ok: true }) }
  render(<AuthContext.Provider value={{ user: { id: 1, role: 'admin' } }}><AgentPanel host={h} onClose={() => {}} /></AuthContext.Provider>)
  const box = screen.getByLabelText('Message UCT Agent')
  const say = async (t) => { await idle(); fireEvent.change(box, { target: { value: t } }); fireEvent.keyDown(box, { key: 'Enter' }); await idle() }
  const click = async (label) => { await idle(); fireEvent.click(screen.getAllByRole('button', { name: label }).at(-1)); await idle() }
  const charts = () => board.state.widgets.filter(w => w.type === 'chart').sort((a, b) => (a.y - b.y) || (a.x - b.x))
  const syms = () => charts().map(w => h.charts.read(w.id).symbol)
  const raw = () => JSON.stringify(board.state.widgets)
  return { board, h, say, click, charts, syms, raw }
}
export const boardOf = (symsIn) => [symsIn.map((_, i) => ({ id: `c${i + 1}`, type: 'chart', x: i * Math.floor(24 / symsIn.length), y: 0, w: Math.floor(24 / symsIn.length), h: 20, color: 'N', opts: settings() })),
  Object.fromEntries(symsIn.map((s, i) => [`N:c${i + 1}`, s]))]

const ASK = 'Add AAPL and MSFT to my charts, but keep SPY and NVDA.'
const Q = 'How would you like the four charts arranged?'
const CHOICES = ['All four in a grid', 'Side by side in one row', 'Two rows of two']
export const arrangeQuestion = () => env('clarify', [], Q, { text: Q, choices: CHOICES })
// the two producers the answer can be planned as (both seen from the planner): a grid of all four as NEW charts, and the four
// charts added + arranged (screenChartGrid turns that into one chartGrid.set)
export const PRODUCERS = {
  'chartGrid.set new_charts': (all, layout = 'grid') => [{ action: 'chartGrid.set', target: 'board', args: { symbols: all, timeframe: null, layout, new_charts: true, watchlist: null, replace: null } }],
  'widget.addCharts + arrange': (all, layout = 'grid') => [{ action: 'widget.addCharts', target: 'workspace', args: { symbols: all, timeframe: null, chart_type: null, exact: null } }, { action: 'widget.arrange', target: 'board', args: { widgets: null, pattern: layout } }],
}

describe('KEEP ≠ RE-CREATE · the owner\'s exact sequence, clicking the offered arrangement', () => {
  for (const [pname, plan] of Object.entries(PRODUCERS)) {
    it(`${pname}: "All four in a grid" → FOUR charts — the kept SPY and NVDA panels themselves, plus AAPL and MSFT`, async () => {
      const { say, click, charts, syms } = mount(...boardOf(['SPY', 'NVDA']))
      envelopes.push(arrangeQuestion())
      await say(ASK)
      expect(transcript()).toContain(Q)
      envelopes.push(env('apply', plan(['SPY', 'NVDA', 'AAPL', 'MSFT'])))
      await click('All four in a grid')
      expect(syms()).toEqual(['SPY', 'NVDA', 'AAPL', 'MSFT'])
      expect(charts()).toHaveLength(4)
      // the kept panels are the SAME widgets, not recreated copies
      expect(charts().filter(w => ['c1', 'c2'].includes(w.id)).map(w => w.id)).toEqual(['c1', 'c2'])
      expect(transcript()).not.toMatch(/Added four new charts for SPY, NVDA, AAPL and MSFT/)
    }, 30000)
  }
})
