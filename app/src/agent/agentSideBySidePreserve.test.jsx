// ⛔ SIDE BY SIDE PRESERVES (OWNER RULING 2026-11-23):
//   "For 'side by side,' preserve the existing chart and add the comparison chart beside it by default. Never silently
//    replace an existing chart. If the request or layout makes the intended behavior ambiguous, clarify."
//
// The generated replace-vs-add CLASS, through the REAL panel (AgentPanel + useAgent + registry, planner, rail, runtime) on the
// REAL board writer, on BOTH routings (v1 and NLM-1 routing v2), with the model stand-in scripted DESTRUCTIVELY (if a request
// reaches it, it plans chart.setSymbol on the existing chart — the replace the ruling forbids) as an `apply` and as a `propose`.
//
//   phrasings   read on the instant path ("put QQQ side by side with SPY", "show SPY and QQQ side by side", …) and planned by
//               the model ("compare QQQ next to SPY", "show QQQ beside this one", …)
//   layouts     single chart (room) · two charts (room) · single chart with NO room (a chart can't be split) · a board that
//               shows NEITHER ticker (the target chart is unclear)
//
// Asserted on the FINAL BOARD, field by field (AUDIT T2 bar a–d):
//   add    every existing chart untouched — id, symbol, timeframe, link colour, opts (indicators, panes, drawings) — and a new
//          chart on the comparison ticker added beside it;
//   ask    a question with choices, and 0 changes to the board.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { makeBoard } from './__fixtures__/board'
import { mergeChartSettings } from '../components/chart/chartDefaults'
import { AuthContext } from '../context/AuthContext'
import { loadAgentConfig, _resetAgentConfig } from './agentClient'
import { multiChartPlan } from './multiChart'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
import AgentPanel from './AgentPanel'

registerBuiltins()

let envelopes, calls
let v2 = false
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
    if (url === '/api/agent/config') return json(v2 ? { conversations: [], routing_v2: true } : { conversations: [] })
    const q = /ticker-search\?q=([^&]+)/.exec(String(url))
    if (q) return json({ results: [{ ticker: decodeURIComponent(q[1]).toUpperCase() }] })
    if (String(url).startsWith('/api/live-prices')) return json({})
    return json({ conversations: [] })
  })
})
afterEach(() => { vi.restoreAllMocks(); cleanup() })

const idle = () => waitFor(() => expect(screen.queryByTestId('agent-typing')).toBeNull(), { timeout: 10000 })
const transcript = () => screen.getByTestId('agent-transcript').textContent
function mount([widgets, groupSyms, opts = {}], { selected = null } = {}) {
  try { localStorage.setItem('uct.agent.routingV2', v2 ? '1' : '0') } catch { /* */ }
  _resetAgentConfig()
  if (v2) loadAgentConfig()
  const board = makeBoard(widgets, groupSyms, opts)
  const base = board.host.charts
  const h = { ...board.host, charts: { ...base, canManageIndicators: () => true, canCreateIndicator: () => true, previewHost: () => null, selected: () => selected }, persist: async () => ({ ok: true }) }
  render(<AuthContext.Provider value={{ user: { id: 1, role: 'admin' } }}><AgentPanel host={h} onClose={() => {}} /></AuthContext.Provider>)
  const box = screen.getByLabelText('Message UCT Agent')
  const say = async (t) => { await idle(); fireEvent.change(box, { target: { value: t } }); fireEvent.keyDown(box, { key: 'Enter' }); await idle() }
  return { board, h, say }
}
const pick = async (name) => {
  await waitFor(() => expect(screen.getAllByRole('button', { name }).length).toBeGreaterThan(0))
  fireEvent.click(screen.getAllByRole('button', { name }).at(-1))
  await idle()
}
const pendingCard = () => screen.queryAllByTestId('agent-proposal').filter(e => e.getAttribute('data-status') === 'pending')

// an existing chart with a full look: its own timeframe, an RSI in its own pane, a moving average, drawings, a watermark
const richOpts = (tf) => {
  const s = mergeChartSettings(null)
  return { tf, watermarkPos: 'top-left', drawings: [{ id: 'd1', type: 'trendline', points: [[1, 1], [2, 2]] }],
    settings: { ...s, indicatorInstances: [...(s.indicatorInstances || []), { id: 'rsi-a', defId: 'rsi', inputs: { length: 14 }, pane: 'pane-rsi' }],
      panes: [{ id: 'pane-rsi', height: 0.25 }] } }
}
const chart = (id, x, w, tf) => ({ id, type: 'chart', x, y: 0, w, h: 20, color: 'N', opts: richOpts(tf) })
// layouts: [widgets, groupSyms, makeBoard opts]; A = the chart's ticker, O = another ticker no request names
const LAYOUTS = {
  single: (A) => [[chart('c1', 0, 24, 'W')], { 'N:c1': A }],
  two: (A, O) => [[chart('c1', 0, 12, 'W'), chart('c2', 12, 12, '60')], { 'N:c1': A, 'N:c2': O }],
  // a chart can't be smaller than 13×11 here: the one chart can't be split for a second one (no room)
  full: (A) => [[chart('c1', 0, 24, 'W')], { 'N:c1': A }, { minOf: () => ({ minW: 13, minH: 11 }) }],
  // the board shows NEITHER named ticker: which chart the comparison goes beside is unclear
  neither: (A, O) => [[chart('c1', 0, 24, 'W')], { 'N:c1': O }],
}
const PAIRS = [['SPY', 'QQQ', 'IWM'], ['NVDA', 'AMD', 'MSFT'], ['AAPL', 'TSLA', 'META']]
// phrasings: A = the ticker a chart shows, B = the comparison. `deixis`: the words point at the chart ("this one")
const PHRASINGS = {
  'instant · put B side by side with A': (A, B) => `put ${B} side by side with ${A}`,
  'instant · show A and B side by side': (A, B) => `show ${A} and ${B} side by side`,
  'instant · B and A side by side': (A, B) => `${B} and ${A} side by side`,
  'instant · A and B next to each other': (A, B) => `${A} and ${B} next to each other`,
  'instant · put A and B beside each other': (A, B) => `put ${A} and ${B} beside each other`,
  'model · compare B next to A': (A, B) => `compare ${B} next to ${A}`,
  'model · put B next to the A chart': (A, B) => `put ${B} next to the ${A} chart`,
  'model · show B alongside A': (A, B) => `show ${B} alongside ${A}`,
  'model · show B beside this one (deixis)': (A, B) => `show ${B} beside this one`,
}
const isDeixis = (name) => /deixis/.test(name)
// the ruling, per layout: room → add beside; no room / target unclear → ask (a deictic request names its chart: never unclear)
const expected = (layout, name) => (layout === 'full' ? 'ask' : layout === 'neither' ? (isDeixis(name) ? 'add' : 'ask') : 'add')

const snapshot = (board, h) => board.state.widgets.filter(w => w.type === 'chart').map(w => ({ id: w.id, symbol: h.charts.read(w.id).symbol, tf: h.charts.read(w.id).tf, color: w.color, opts: JSON.stringify(w.opts) }))
function expectPreservedAndAdded(board, h, before, B, said) {
  const now = snapshot(board, h)
  // (a) every existing chart untouched, field by field
  for (const c of before) expect(now.find(x => x.id === c.id), `${said}: ${c.id} kept`).toEqual(c)
  // (b) the comparison chart added beside it
  const added = now.filter(x => !before.some(c => c.id === x.id))
  expect(added.map(x => x.symbol), said).toEqual([B])
}

let n = 0
for (const routing of ['v1', 'v2']) for (const disposition of ['apply', 'propose']) {
  describe(`SIDE BY SIDE PRESERVES · routing ${routing} · model plans ${disposition}`, () => {
    beforeEach(() => { v2 = routing === 'v2' })
    for (const [name, words] of Object.entries(PHRASINGS)) for (const layout of Object.keys(LAYOUTS)) {
      const [A, B, O] = PAIRS[n++ % PAIRS.length]
      const want = expected(layout, name)
      const said = words(A, B)
      it(`${name} · ${layout} → ${want}: "${said}"`, async () => {
        const { board, h, say } = mount(LAYOUTS[layout](A, O), { selected: isDeixis(name) ? 'c1' : null })
        const raw0 = JSON.stringify(board.state)
        const before = snapshot(board, h)
        // the stand-in model replaces the existing chart (the destructive reading), whichever path reaches it
        envelopes.push(env(disposition, [{ action: 'chart.setSymbol', target: 'c1', args: { symbol: B } }]))
        await say(said)
        if (want === 'ask') {
          // (c) asked with choices, 0 changes
          expect(JSON.stringify(board.state), said).toBe(raw0)
          expect(screen.queryAllByTestId('agent-question').length, `${said}: ${transcript()}`).toBeGreaterThan(0)
          expect(screen.getAllByRole('button', { name: 'Cancel' }).length, said).toBeGreaterThan(0)
          expect(pendingCard(), said).toHaveLength(0)
          return
        }
        if (pendingCard().length) await pick('Apply')
        await waitFor(() => expect(board.state.widgets.filter(w => w.type === 'chart').length, `${said}: ${transcript()}`).toBe(before.length + 1), { timeout: 8000 })
        expectPreservedAndAdded(board, h, before, B, said)
      }, 30000)
    }
  })
}

// replace / swap said WITH side by side: which one is meant is ambiguous → asked, 0 changes; each choice does what it says
const REPLACE_WORDS = {
  'replace A with B side by side': (A, B) => `replace ${A} with ${B} side by side`,
  'swap in B side by side with A': (A, B) => `swap in ${B} side by side with ${A}`,
}
for (const routing of ['v1', 'v2']) {
  describe(`SIDE BY SIDE + replace / swap words · routing ${routing}: asked, nothing changed`, () => {
    beforeEach(() => { v2 = routing === 'v2' })
    for (const [name, words] of Object.entries(REPLACE_WORDS)) for (const layout of ['single', 'two']) {
      it(`${name} · ${layout}`, async () => {
        const [A, B, O] = PAIRS[0]
        const { board, h, say } = mount(LAYOUTS[layout](A, O))
        const raw0 = JSON.stringify(board.state)
        envelopes.push(env('apply', [{ action: 'chart.setSymbol', target: 'c1', args: { symbol: B } }]))
        await say(words(A, B))
        expect(JSON.stringify(board.state)).toBe(raw0)
        expect(screen.queryAllByTestId('agent-question').length, transcript()).toBeGreaterThan(0)
        void h
      }, 30000)
    }
  })
}

describe('SIDE BY SIDE · the member\'s pick after the question does exactly what it says', () => {
  beforeEach(() => { v2 = false })
  it('neither ticker shown → "Add …" keeps the chart and adds both beside it', async () => {
    const { board, h, say } = mount(LAYOUTS.neither('NVDA', 'IWM'))
    const before = snapshot(board, h)
    await say('show NVDA and AMD side by side')
    await pick(/^Add /)
    if (pendingCard().length) await pick('Apply')
    await waitFor(() => expect(board.state.widgets.filter(w => w.type === 'chart')).toHaveLength(3), { timeout: 8000 })
    for (const c of before) expect(snapshot(board, h).find(x => x.id === c.id)).toEqual(c)
    expect(snapshot(board, h).map(x => x.symbol).sort()).toEqual(['AMD', 'IWM', 'NVDA'])
  }, 30000)
  it('neither ticker shown → "Put … on your chart" replaces only on that explicit pick (one Undo puts it back)', async () => {
    const { board, h, say } = mount(LAYOUTS.neither('NVDA', 'IWM'))
    const raw0 = JSON.stringify(board.state.widgets)
    await say('show NVDA and AMD side by side')
    await pick(/^Put NVDA and AMD on /)
    if (pendingCard().length) await pick('Apply')
    await waitFor(() => expect(snapshot(board, h).map(x => x.symbol).sort()).toEqual(['AMD', 'NVDA']), { timeout: 8000 })
    await say('undo')
    await waitFor(() => expect(JSON.stringify(board.state.widgets)).toBe(raw0), { timeout: 8000 })
  }, 30000)
  it('no room → asked; Cancel changes nothing', async () => {
    const { board, say } = mount(LAYOUTS.full('SPY'))
    const raw0 = JSON.stringify(board.state)
    await say('put QQQ side by side with SPY')
    expect(transcript()).toMatch(/room/i)
    await pick('Cancel')
    expect(JSON.stringify(board.state)).toBe(raw0)
  }, 30000)
  it('the added chart is undone exactly by one Undo', async () => {
    const { board, say } = mount(LAYOUTS.single('SPY'))
    const raw0 = JSON.stringify(board.state.widgets)
    await say('put QQQ side by side with SPY')
    await waitFor(() => expect(board.state.widgets.filter(w => w.type === 'chart')).toHaveLength(2), { timeout: 8000 })
    await say('undo')
    await waitFor(() => expect(JSON.stringify(board.state.widgets)).toBe(raw0), { timeout: 8000 })
  }, 30000)
})

// the instant reader itself (pure): never a chart.setSymbol, never a reusing grid, for a side-by-side request without replace words
describe('SIDE BY SIDE · the instant reader (multiChartPlan) never re-symbols an existing chart', () => {
  for (const [name, words] of Object.entries(PHRASINGS)) for (const layout of Object.keys(LAYOUTS)) {
    const [A, B, O] = PAIRS[0]
    it(`${name} · ${layout}`, () => {
      const r = multiChartPlan(words(A, B), { host: makeBoard(...LAYOUTS[layout](A, O)).host })
      for (const o of r?.kind === 'ops' ? r.ops : []) {
        expect(o.action).not.toBe('chart.setSymbol')
        if (o.action === 'chartGrid.set') expect(o.args.new_charts).toBe(true)
      }
    })
  }
})
