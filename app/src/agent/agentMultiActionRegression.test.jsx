// HOTFIX 2026-11-03 — the owner's live multi-action regressions (production 0aeac8cfdb, v1 planner), through the REAL
// panel (AgentPanel + useAgent + registry, routing, planner, policy, runtime, receipts and Undo) and the REAL board
// writer (fixture board). Stand-in: the Agent model (/api/agent/turn), scripted per test. No paid model call.
//   T1  "Create a new chart for NVDA on the daily timeframe, then add a second chart for QQQ." — the receipt names
//       what changed and never says "Already Daily" about charts that did not exist yet
//   T2  "Change the NVDA chart to the weekly timeframe, then undo that change." + conversational Undo phrasings — the
//       receipt's own Undo (doUndo), never a model claim; agent.undo is in the manifest, always routed
//   T3  "Put SPY, QQQ, NVDA, and TSLA on four charts, all the same size." — routed to the grid, read as ONE chart grid
//       (no add + change-existing refusal), and a tab stand-in plan never runs
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { makeBoard } from './__fixtures__/board'
import { mergeChartSettings } from '../components/chart/chartDefaults'
import { selectGroups } from './routing'
import { fastParse } from './fastPath'
import { planCompound } from './compound'
import { multiChartPlan } from './multiChart'
import { manifestFor, getCapability } from './capabilities'
import { AuthContext } from '../context/AuthContext'

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
    if (url === '/api/agent/turn') { const e = envelopes.shift(); return json({ conversationId: 'ac_1', envelope: typeof e === 'function' ? e(body) : e, usage: { research_calls: 0, citations: [] } }) }
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
const symbolsOf = (board, h) => chartsOf(board).map(w => h.charts.read(w.id)?.symbol)
const settings = () => ({ settings: mergeChartSettings(null) })
// one chart on the left half (the rest of the board empty), and one chart filling the board
const HALF = () => [[{ id: 'c1', type: 'chart', x: 0, y: 0, w: 12, h: 20, color: 'A', opts: settings() }], { A: 'NVDA' }]
const FULL = () => [[{ id: 'c1', type: 'chart', x: 0, y: 0, w: 24, h: 20, color: 'A', opts: settings() }], { A: 'NVDA' }]
const ref = (b, key) => b.context[key][0].ref

// ═══ T3 ═══════════════════════════════════════════════════════════════════════════════════════════════
describe('T3 · "on four charts, all the same size"', () => {
  const T3 = 'Put SPY, QQQ, NVDA, and TSLA on four charts, all the same size.'
  it('routing: every multi-chart / equal-size phrasing the owner used routes the grid (equal sizing: the workspace group too)', () => {
    for (const m of [T3, 'put spy, qqq, nvda and tsla on four charts', 'Show 4 charts: SPY, QQQ, NVDA, TSLA', 'make all the charts the same size',
      'make them equal size', 'arrange the charts evenly', 'split the board into four charts',
      'Create four charts in a 2×2 grid: SPY, QQQ, NVDA, and TSLA, all on the daily timeframe.',
      'Create four charts for SPY, QQQ, NVDA and TSLA', 'two more charts with AMD and AVGO', 'tile the charts', 'equally sized charts for SPY and QQQ']) {
      expect(selectGroups(m).selected, m).toContain('chartGrid')
    }
    for (const m of [T3, 'make all the charts the same size', 'make them equal size', 'arrange the charts evenly', 'tile the charts', 'equally sized charts for SPY and QQQ'])
      expect(selectGroups(m).selected, m).toContain('workspace')
    expect(selectGroups('put NVDA and AMD side by side').selected).toContain('chartGrid')
    // agent.undo's own group: named by any Undo word
    for (const m of ['Undo the last change you made to my charts.', 'undo that', 'revert the timeframe change', 'Change the NVDA chart to the weekly timeframe, then undo that change.',
      'hmm could you maybe take back whatever you did to my nvda chart', 'put it back the way it was', 'roll back what you just did'])
      expect(selectGroups(m).selected, m).toContain('undo')
    expect(selectGroups('switch to weekly').selected).not.toContain('undo')
  })
  it('the owner\'s exact words are read deterministically as ONE chart grid (no model call)', () => {
    const board = makeBoard(...HALF())
    const r = multiChartPlan(T3, { host: board.host })
    expect(r?.kind).toBe('ops')
    expect(r.ops).toHaveLength(1)
    expect(r.ops[0]).toMatchObject({ action: 'chartGrid.set', args: { symbols: ['SPY', 'QQQ', 'NVDA', 'TSLA'] } })
  })
  it('the real panel: four equal charts on SPY, QQQ, NVDA, TSLA; one receipt; ONE Undo restores the board', async () => {
    const { board, h, say } = mount(...HALF())
    const before = JSON.stringify(board.state.widgets)
    await say(T3)
    await waitFor(() => expect(chartsOf(board)).toHaveLength(4), { timeout: 8000 })
    expect(symbolsOf(board, h)).toEqual(['SPY', 'QQQ', 'NVDA', 'TSLA'])
    expect(new Set(chartsOf(board).map(w => `${w.w}x${w.h}`)).size).toBe(1)          // all the same size
    expect(turnBodies()).toHaveLength(0)
    expect(transcript()).not.toMatch(/isn.t supported yet|in two steps/)
    await say('undo')
    await waitFor(() => expect(JSON.stringify(board.state.widgets)).toBe(before), { timeout: 8000 })
  }, 30000)
  it('the MODEL\'s shape (adds + tickers + widget.arrange on the board, with room to spare) is ONE grid change — never the add + change-existing refusal', async () => {
    const { board, h, say } = mount(...HALF())
    envelopes.push(b => env('apply', [
      ...[1, 2, 3, 4].map(n => ({ action: 'widget.add', target: ref(b, 'workspace'), args: { type: 'chart', as: `new${n}` } })),
      ...['SPY', 'QQQ', 'NVDA', 'TSLA'].map((s, i) => ({ action: 'chart.setSymbol', target: `new${i + 1}`, args: { symbol: s } })),
      { action: 'widget.arrange', target: ref(b, 'board'), args: { widgets: null, pattern: 'grid' } },
    ]))
    await say('Give me SPY, QQQ, NVDA, TSLA on their own charts and arrange them as a grid')
    await waitFor(() => expect(symbolsOf(board, h)).toEqual(expect.arrayContaining(['SPY', 'QQQ', 'NVDA', 'TSLA'])), { timeout: 8000 })
    expect(transcript()).not.toMatch(/Adding widgets and changing existing ones/)
  }, 30000)
  it('a TAB stand-in plan (live capture: the tickers as tabs of the one chart) never runs — said plainly, the chart untouched', async () => {
    const { h, say } = mount(...FULL())
    envelopes.push(b => env('apply', [
      { action: 'chart.setSymbol', target: b.context.charts[0].ref, args: { symbol: 'SPY' } },
      { action: 'chart.addTab', target: ref(b, 'board'), args: { widget: 'c1', timeframe: null, name: 'QQQ' } },
    ], 'Done'))
    await say('Put SPY and QQQ on two charts please, thank you kindly friend')
    await waitFor(() => expect(transcript()).toMatch(/TABS of one chart/))
    expect(h.charts.read('c1').symbol).toBe('NVDA')
    expect(receipts()).toHaveLength(0)
  }, 30000)
})

// ═══ T1 ═══════════════════════════════════════════════════════════════════════════════════════════════
describe('T1 · "a new chart for NVDA on the daily timeframe, then a second chart for QQQ"', () => {
  it('both charts born on their tickers; the receipt names them and never says "Already Daily" about charts that did not exist', async () => {
    const { board, h, say } = mount(...HALF())
    envelopes.push(b => env('apply', [
      { action: 'widget.add', target: ref(b, 'workspace'), args: { type: 'chart', as: 'new1' } },
      { action: 'chart.setSymbol', target: 'new1', args: { symbol: 'NVDA' } },
      { action: 'chart.setTimeframe', target: 'new1', args: { timeframe: 'D' } },
      { action: 'widget.add', target: ref(b, 'workspace'), args: { type: 'chart', as: 'new2' } },
      { action: 'chart.setSymbol', target: 'new2', args: { symbol: 'QQQ' } },
      { action: 'chart.setTimeframe', target: 'new2', args: { timeframe: 'D' } },
    ]))
    await say('Create a new chart for NVDA on the daily timeframe, then add a second chart for QQQ.')
    await waitFor(() => expect(chartsOf(board)).toHaveLength(3), { timeout: 8000 })
    expect(symbolsOf(board, h).slice(1).sort()).toEqual(['NVDA', 'QQQ'])
    await waitFor(() => expect(receipts()).toHaveLength(1))
    const t = receipts()[0].textContent
    expect(screen.getByTestId('agent-receipt-summary').textContent).toBe('Done — added 2 charts for NVDA and QQQ.')
    expect(t).not.toMatch(/Already Daily/)
    expect(t).toMatch(/NVDA/)
    expect(t).toMatch(/QQQ/)
  }, 30000)
})

// ═══ T2 / Undo ════════════════════════════════════════════════════════════════════════════════════════
describe('T2 · conversational Undo — the receipt\'s own Undo, never a claim', () => {
  it('agent.undo is a registered planner action in the manifest (executed only by the browser)', () => {
    expect(getCapability('agent.undo')).toBeTruthy()
    expect(manifestFor({ surface: 'charts' }).map(a => a.name)).toContain('agent.undo')
  })
  it('the deterministic Undo words tolerate qualifiers', () => {
    for (const t of ['undo that', 'Undo the last change you made to my charts.', 'undo what you just did', 'please undo your last change', 'can you undo that for me?', 'undo the change you just made', 'roll back the last change'])
      expect(fastParse(t), t).toMatchObject({ kind: 'undo' })
    expect(fastParse('revert the timeframe change')).toEqual({ kind: 'undo', about: 'timeframe' })
    expect(fastParse('undo the timeframe change you just made to my chart')).toEqual({ kind: 'undo', about: 'timeframe' })
    expect(fastParse('undo the 50 ema')).toBeNull()
  })
  for (const phrase of ['undo that', 'Undo the last change you made to my charts.', 'revert the timeframe change']) {
    it(`"${phrase}" after a weekly switch: back to daily, through Undo, no model call`, async () => {
      const { h, say } = mount(...FULL())
      await say('weekly')
      await waitFor(() => expect(h.charts.read('c1').tf).toBe('W'))
      await say(phrase)
      await waitFor(() => expect(h.charts.read('c1').tf).toBe('D'))
      expect(turnBodies()).toHaveLength(0)
    }, 30000)
  }
  it('"Change the NVDA chart to the weekly timeframe, then undo that change." → the change, then its Undo', async () => {
    const { board, h, say } = mount(...FULL())
    expect(planCompound('Change the NVDA chart to the weekly timeframe, then undo that change.', { host: board.host })?.steps?.map(s => s.kind)).toEqual(['fast', 'undo'])
    await say('Change the NVDA chart to the weekly timeframe, then undo that change.')
    await waitFor(() => expect(transcript()).toMatch(/All 2 steps done/), { timeout: 8000 })
    expect(h.charts.read('c1').tf).toBe('D')
    expect(turnBodies()).toHaveLength(0)
  }, 30000)
  it('"switch to weekly, then undo it" — the same', async () => {
    const { h, say } = mount(...FULL())
    await say('switch to weekly, then undo it')
    await waitFor(() => expect(transcript()).toMatch(/All 2 steps done/), { timeout: 8000 })
    expect(h.charts.read('c1').tf).toBe('D')
  }, 30000)
  it('the MODEL plans agent.undo alone → doUndo; its own words are never shown as the outcome', async () => {
    const { h, say } = mount(...FULL())
    await say('weekly')
    await waitFor(() => expect(h.charts.read('c1').tf).toBe('W'))
    envelopes.push(b => env('apply', [{ action: 'agent.undo', target: ref(b, 'agent'), args: { scope: 'last', about: null } }], 'Undid it for you!'))
    await say('hmm could you maybe take back whatever you did to my nvda chart')
    await waitFor(() => expect(h.charts.read('c1').tf).toBe('D'))
    expect(transcript()).not.toMatch(/Undid it for you/)
    expect(turnBodies()[0].capabilities.map(a => a.name)).toContain('agent.undo')
  }, 30000)
  it('the MODEL plans change + agent.undo LAST → the change, then the Undo of exactly that change', async () => {
    const { h, say } = mount(...FULL())
    envelopes.push(b => env('apply', [
      { action: 'chart.setTimeframe', target: b.context.charts[0].ref, args: { timeframe: 'W' } },
      { action: 'agent.undo', target: ref(b, 'agent'), args: { scope: 'last', about: null } },
    ], 'Switched to weekly and reverted it.'))
    await say('change NVDA to weekly then undo it')
    await waitFor(() => expect(receipts().length).toBeGreaterThanOrEqual(2), { timeout: 8000 })
    expect(h.charts.read('c1').tf).toBe('D')
    expect(transcript()).not.toMatch(/reverted it\./)
  }, 30000)
  it('nothing to undo → said plainly; never a claimed Undo', async () => {
    const { say } = mount(...FULL())
    envelopes.push(b => env('apply', [{ action: 'agent.undo', target: ref(b, 'agent'), args: { scope: 'last', about: null } }], 'Done, undone.'))
    await say('could you take back whatever you did to my chart earlier')
    await waitFor(() => expect(transcript()).toMatch(/nothing of mine to undo/))
    expect(transcript()).not.toMatch(/Done, undone/)
  }, 30000)
  it('a planned change that is already in place + agent.undo → nothing undone, said plainly', async () => {
    const { h, say } = mount(...FULL())
    envelopes.push(b => env('apply', [
      { action: 'chart.setTimeframe', target: b.context.charts[0].ref, args: { timeframe: 'D' } },
      { action: 'agent.undo', target: ref(b, 'agent'), args: { scope: 'last', about: null } },
    ]))
    await say('set my nvda chart over to the daily and afterwards revert what you did there')
    await waitFor(() => expect(transcript()).toMatch(/I didn’t undo anything/), { timeout: 8000 })
    expect(h.charts.read('c1').tf).toBe('D')
  }, 30000)
})
