// ⛔ ADD NEVER REPLACES (hotfix 2026-11-13, AUDIT held-out): on a board of charts, with NO question pending, a request to ADD
// charts never re-symbols or removes an existing chart — through the REAL panel (AgentPanel + useAgent + registry, planner,
// rail, runtime) on the REAL board writer. Stand-in: the model (scripted, and scripted DESTRUCTIVE: if a shape reaches it, it
// plans the re-symbol of the existing charts — which must never land).
// Families, generated across tickers, counts and boards:
//   F1 plain add                       "add AAPL and MSFT"
//   F2 just / only add                 "just add AAPL and MSFT", "only add …"
//   F3 "X and Y charts"                "add AAPL and MSFT charts"
//   F4 to my layout / board / grid     "add AAPL and MSFT to my layout"
//   F5 "… too"                         "add AAPL and MSFT too"
//   F6 put / include beside them       "put AAPL and MSFT next to them", "include AAPL and MSFT as well"
//   F7 passive                         "I want AAPL and MSFT added"
//   CONTROL                            "replace the SPY chart with AAPL" — SPY→AAPL, the other chart intact
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { makeBoard } from './__fixtures__/board'
import { mergeChartSettings } from '../components/chart/chartDefaults'
import { AuthContext } from '../context/AuthContext'
import { multiChartPlan } from './multiChart'
import { planOps, collectTargets } from './executor'
import { chartRailRefusal } from './chartRail'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
import AgentPanel from './AgentPanel'

registerBuiltins()

let envelopes, calls
const env = (disposition, ops, reply = '') => ({ disposition, reply, question: null, ops, unsupported_category: null })
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

const idle = () => waitFor(() => expect(screen.queryByTestId('agent-typing')).toBeNull(), { timeout: 10000 })
function mount(widgets, groupSyms) {
  const board = makeBoard(widgets, groupSyms)
  const base = board.host.charts
  const h = { ...board.host, charts: { ...base, canManageIndicators: () => true, canCreateIndicator: () => true, previewHost: () => null, selected: () => null }, persist: async () => ({ ok: true }) }
  render(<AuthContext.Provider value={{ user: { id: 1, role: 'admin' } }}><AgentPanel host={h} onClose={() => {}} /></AuthContext.Provider>)
  const box = screen.getByLabelText('Message UCT Agent')
  const say = async (t) => { await idle(); fireEvent.change(box, { target: { value: t } }); fireEvent.keyDown(box, { key: 'Enter' }); await idle() }
  return { board, h, say }
}
const settings = () => ({ settings: mergeChartSettings(null) })
const chartsOf = (board) => board.state.widgets.filter(w => w.type === 'chart').sort((a, b) => (a.y - b.y) || (a.x - b.x))
const symsOf = (board, h) => chartsOf(board).map(w => h.charts.read(w.id).symbol)
// boards: two charts side by side (production), one chart, three charts in a row
export const BOARDS = {
  'SPY+NVDA': () => [['c1', 'c2'].map((id, i) => ({ id, type: 'chart', x: i * 12, y: 0, w: 12, h: 20, color: 'N', opts: settings() })), { 'N:c1': 'SPY', 'N:c2': 'NVDA' }],
  'QQQ alone': () => [[{ id: 'c1', type: 'chart', x: 0, y: 0, w: 12, h: 20, color: 'N', opts: settings() }], { 'N:c1': 'QQQ' }],
  'SPY+NVDA+AMD': () => [['c1', 'c2', 'c3'].map((id, i) => ({ id, type: 'chart', x: i * 8, y: 0, w: 8, h: 20, color: 'N', opts: settings() })), { 'N:c1': 'SPY', 'N:c2': 'NVDA', 'N:c3': 'AMD' }],
}
const TICKERS = [['AAPL', 'MSFT'], ['TSLA', 'META'], ['AMZN', 'GOOGL', 'NFLX']]
const words = (t) => (t.length === 2 ? `${t[0]} and ${t[1]}` : `${t.slice(0, -1).join(', ')} and ${t[t.length - 1]}`)
export const FAMILIES = {
  'F1 plain add': (t) => `add ${words(t)}`,
  'F1 Add (capitalised)': (t) => `Add ${words(t)}.`,
  'F2 just add': (t) => `just add ${words(t)}`,
  'F2 only add': (t) => `only add ${words(t)}`,
  'F3 X and Y charts': (t) => `add ${words(t)} charts`,
  'F3 N charts for': (t) => `add ${t.length === 2 ? 'two' : 'three'} charts for ${words(t)}`,
  'F4 to my layout': (t) => `add ${words(t)} to my layout`,
  'F4 to my board': (t) => `add ${words(t)} to my board`,
  'F4 to the grid': (t) => `add ${words(t)} to the grid`,
  'F5 too': (t) => `add ${words(t)} too`,
  'F6 put next to them': (t) => `put ${words(t)} next to them`,
  'F6 include as well': (t) => `include ${words(t)} as well`,
  'F7 passive added': (t) => `I want ${words(t)} added`,
}

// layer 1 — the instant reader never makes a reuse / re-symbol plan for an add (pure, every family × tickers × board)
describe('ADD NEVER REPLACES · layer 1: the instant reader (multiChartPlan) never reuses an existing chart for an add', () => {
  for (const [bname, mk] of Object.entries(BOARDS)) for (const [fname, f] of Object.entries(FAMILIES)) for (const t of TICKERS) {
    it(`${fname} · ${t.join('/')} · ${bname}`, () => {
      const b = makeBoard(...mk())
      const r = multiChartPlan(f(t), { host: b.host })
      for (const o of r?.ops || []) {
        expect(o.action, f(t)).not.toBe('chart.setSymbol')
        if (o.action === 'chartGrid.set') { expect(o.args.new_charts, f(t)).toBe(true); expect(o.args.replace ?? null, f(t)).toBe(null) }
      }
    })
  }
})

// layer 2 — the RAIL alone: the reuse plan the old gridRequest made (chartGrid.set reusing the board's charts) is refused for
// every family × tickers × board, whatever reader produced it
describe('ADD NEVER REPLACES · layer 2: the rail alone refuses the old reuse plan for every add shape', () => {
  for (const [bname, mk] of Object.entries(BOARDS)) for (const [fname, f] of Object.entries(FAMILIES)) for (const t of TICKERS) {
    it(`${fname} · ${t.join('/')} · ${bname}`, () => {
      const b = makeBoard(...mk())
      const ops = [{ action: 'chartGrid.set', target: 'board', args: { symbols: t, timeframe: null, layout: null, new_charts: null, watchlist: null, replace: null } }]
      const plan = planOps(collectTargets(b.host, ['board']), ops, {}, { surface: 'charts' })
      expect(plan.ok).toBe(true)
      expect(chartRailRefusal(plan, { words: f(t), host: b.host, mode: 'apply' }), f(t)).toBeTruthy()
      // and the model's other destructive reading: a re-symbol of the first chart
      const one = planOps(collectTargets(b.host, ['chart']), [{ action: 'chart.setSymbol', target: 'c1', args: { symbol: t[0] } }], {}, { surface: 'charts' })
      expect(chartRailRefusal(one, { words: f(t), host: b.host, mode: 'apply' }), f(t)).toBeTruthy()
    })
  }
})

// layer 3 — through the panel: every existing chart keeps its ticker, none is removed (every family × two ticker sets × every board)
describe('ADD NEVER REPLACES · layer 3: through the real panel, the existing charts keep their tickers and none is removed', () => {
  for (const [bname, mk] of Object.entries(BOARDS)) for (const [fname, f] of Object.entries(FAMILIES)) for (const t of TICKERS.slice(0, 2)) {
    it(`${fname} · ${t.join('/')} · ${bname}`, async () => {
      const [ws, gs] = mk()
      const { board, h, say } = mount(ws, gs)
      const before = symsOf(board, h)
      envelopes.push(env('apply', chartsOf(board).slice(0, t.length).map((w, i) => ({ action: 'chart.setSymbol', target: w.id, args: { symbol: t[i] } }))))
      await say(f(t))
      const after = symsOf(board, h)
      expect(after.slice(0, before.length), f(t)).toEqual(before)
      expect(after.length, f(t)).toBeGreaterThanOrEqual(before.length)
    }, 30000)
  }
})

describe('CONTROL · an explicit replace of ONE named chart still works', () => {
  it('"replace the SPY chart with AAPL" (model): SPY→AAPL, NVDA intact, 2 panels', async () => {
    const { board, h, say } = mount(...BOARDS['SPY+NVDA']())
    envelopes.push(env('apply', [{ action: 'chart.setSymbol', target: 'c1', args: { symbol: 'AAPL' } }]))
    await say('replace the SPY chart with AAPL')
    expect(symsOf(board, h)).toEqual(['AAPL', 'NVDA'])
  }, 30000)
  it('"change the left chart to AAPL": SPY→AAPL, NVDA intact', async () => {
    const { board, h, say } = mount(...BOARDS['SPY+NVDA']())
    envelopes.push(env('apply', [{ action: 'chart.setSymbol', target: 'c1', args: { symbol: 'AAPL' } }]))
    await say('change the left chart to AAPL')
    expect(symsOf(board, h)).toEqual(['AAPL', 'NVDA'])
  }, 30000)
  it('"swap out the SPY chart for AAPL": SPY→AAPL (replace words), NVDA intact', async () => {
    const { board, h, say } = mount(...BOARDS['SPY+NVDA']())
    envelopes.push(env('apply', [{ action: 'chart.setSymbol', target: 'c1', args: { symbol: 'AAPL' } }]))
    await say('swap out the SPY chart for AAPL')
    expect(symsOf(board, h)).toEqual(['AAPL', 'NVDA'])
  }, 30000)
})

// DIRECT action paths: a model plan that calls each census action ITSELF with replacing args, under additive wording — the rail
// alone refuses every one (nothing written), whichever words of each family the member used
describe('ADD NEVER REPLACES · direct model plans of every census action with replacing args — refused by the rail', () => {
  const LAYOUTS = () => ({ entries: [{ id: 11, name: 'Mine', scope: 'user' }, { id: 12, name: 'Swing', scope: 'user' }],
    boards: { 11: BOARDS['SPY+NVDA']()[0], 12: [{ id: 's1', type: 'chart', x: 0, y: 0, w: 24, h: 20, color: 'A', opts: settings() }] }, active: 11 })
  const PLANS = {
    'chartGrid.set reuse': [{ action: 'chartGrid.set', target: 'board', args: { symbols: ['AAPL', 'MSFT'], timeframe: null, layout: 'grid', new_charts: null, watchlist: null, replace: null } }],
    'chartGrid.set replace=charts': [{ action: 'chartGrid.set', target: 'board', args: { symbols: ['AAPL', 'MSFT'], timeframe: null, layout: null, new_charts: null, watchlist: null, replace: 'charts' } }],
    'chart.setSymbol ×2': [{ action: 'chart.setSymbol', target: 'c1', args: { symbol: 'AAPL' } }, { action: 'chart.setSymbol', target: 'c2', args: { symbol: 'MSFT' } }],
    'widget.remove': [{ action: 'widget.remove', target: 'board', args: { widget: 'c2' } }],
    'layout.open': [{ action: 'layout.open', target: 'layouts', args: { layout: '12' } }],
  }
  const SAYS = ['add AAPL and MSFT to my layout with their own charts', 'just add AAPL and MSFT as new charts please', 'can you include AAPL and MSFT as well', 'put AAPL and MSFT next to them in new charts']
  for (const [pname, ops] of Object.entries(PLANS)) for (const said of SAYS) {
    it(`${pname} · "${said}"`, async () => {
      const [ws, gs] = BOARDS['SPY+NVDA']()
      const board = makeBoard(ws, gs, { layouts: LAYOUTS() })
      const base = board.host.charts
      const h = { ...board.host, charts: { ...base, canManageIndicators: () => true, canCreateIndicator: () => true, previewHost: () => null, selected: () => null }, persist: async () => ({ ok: true }) }
      render(<AuthContext.Provider value={{ user: { id: 1, role: 'admin' } }}><AgentPanel host={h} onClose={() => {}} /></AuthContext.Provider>)
      const box = screen.getByLabelText('Message UCT Agent')
      const before = JSON.stringify(board.state.widgets)
      // whatever the instant path reads, the stand-in model (if reached) plans exactly this replacing op
      envelopes.push(env('apply', ops))
      await idle(); fireEvent.change(box, { target: { value: said } }); fireEvent.keyDown(box, { key: 'Enter' }); await idle()
      // if the model was reached, its plan never landed; if the instant path read it, it only ADDED charts
      const now = board.state.widgets.filter(w => JSON.parse(before).some(b => b.id === w.id))
      expect(JSON.stringify(now), said).toBe(before)
      expect(['c1', 'c2'].map(id => h.charts.read(id)?.symbol)).toEqual(['SPY', 'NVDA'])
      expect(h.layouts.snapshot().active.name).toBe('Mine')
      // the plan reached the (scripted) model and the RAIL refused it — never the instant path standing in
      expect(calls.some(c => c[1] === '/api/agent/turn'), said).toBe(true)
      expect(screen.getByTestId('agent-transcript').textContent).toMatch(/you asked for more charts|didn’t ask to remove|asked to keep/)
    }, 30000)
  }
})
