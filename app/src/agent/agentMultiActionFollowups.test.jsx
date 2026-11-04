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

// ═══ N1 · #766 review nits ══════════════════════════════════════════════════════════════════════════════
describe('N1 · #766 review nits', () => {
  it('nit 1: a board write is a CHART change only when it structurally touched a chart widget — never by its receipt wording', () => {
    const before = { raw: [{ id: 'c1', type: 'chart' }, { id: 'n1', type: 'news' }] }
    // a News move whose receipt happens to say "Chart"
    expect(touchesCharts({ kind: 'board', before, patch: { set: { n1: { x: 12 } } }, lines: ['Moved the News next to the Chart'] })).toBe(false)
    expect(touchesCharts({ kind: 'board', before, patch: { set: { c1: { w: 10 } } } })).toBe(true)
    expect(touchesCharts({ kind: 'board', before, patch: { remove: ['c1'] } })).toBe(true)
    expect(touchesCharts({ kind: 'board', before, patch: { grid: { reuse: [] } } })).toBe(true)
    expect(touchesCharts({ kind: 'board', before, patch: { restore: [{ id: 'n1', type: 'news' }] } })).toBe(false)
    expect(touchesCharts({ kind: 'workspace', patch: { add: [{ type: 'chart' }] } })).toBe(true)
    expect(touchesCharts({ kind: 'workspace', patch: { add: [{ type: 'news' }] } })).toBe(false)
    expect(touchesCharts({ kind: 'chart' })).toBe(true)
  })
  it('nit 1 (panel): "undo the change you made to my charts" after a NEWS widget was added (not a chart) undoes nothing', async () => {
    const { board, say } = mount([
      { id: 'c1', type: 'chart', x: 0, y: 0, w: 12, h: 20, color: 'A', opts: settings() },
    ], { A: 'NVDA' })
    envelopes.push(b => env('apply', [{ action: 'widget.add', target: ref(b, 'workspace'), args: { type: 'news', as: null } }]))
    await say('could I also get the news panel up somewhere over there')
    await waitFor(() => expect(receipts()).toHaveLength(1))
    const moved = JSON.stringify(board.state.widgets)
    await say('undo the change you made to my charts')
    await waitFor(() => expect(transcript()).toMatch(/My last change wasn't a chart change/))
    expect(JSON.stringify(board.state.widgets)).toBe(moved)
  }, 30000)
  it('nit 2: "X, then undo it" whose X became a which-chart QUESTION → the question is withdrawn (no live choices), nothing runs', async () => {
    const { h, say } = mount(...TWO())
    envelopes.push(b => env('apply', [
      { action: 'chart.setTimeframe', target: b.context.charts[0].ref, args: { timeframe: 'W' } },
      { action: 'agent.undo', target: ref(b, 'agent'), args: { scope: 'last', about: null } },
    ]))
    await say('flip a chart over to weekly and then take that back again')
    await waitFor(() => expect(transcript()).toMatch(/can’t make it and undo it in one request/))
    const q = screen.queryAllByTestId('agent-question')
    expect(q.length).toBe(1)
    expect(q[0].querySelectorAll('button').length).toBe(0)
    expect(q[0].textContent).toMatch(/Withdrawn/)
    expect(h.charts.read('c1').tf).toBe('D')
    expect(h.charts.read('c2').tf).toBe('D')
  }, 30000)
  it('nit 2 (screen path, no pick): a question raised by the plan screen is withdrawn too — never "the change before the Undo didn’t make a change"', async () => {
    const { say } = mount([
      { id: 'c1', type: 'chart', x: 0, y: 0, w: 8, h: 20, color: 'A', opts: settings() },
      { id: 'c2', type: 'chart', x: 8, y: 0, w: 8, h: 20, color: 'B', opts: settings() },
      { id: 'c3', type: 'chart', x: 16, y: 0, w: 8, h: 20, color: 'C', opts: settings() },
    ], { A: 'NVDA', B: 'AMD', C: 'MU' })
    envelopes.push(b => env('apply', [
      { action: 'indicator.add', target: `ixe:${b.context.charts[0].ref}`, args: { defId: 'rsi', inputs: null } },
      { action: 'agent.undo', target: ref(b, 'agent'), args: { scope: 'last', about: null } },
    ]))
    await say('i would love an rsi study across all of my charts here, though afterwards please just take it right back off')
    await waitFor(() => expect(transcript()).toMatch(/can’t make it and undo it in one request/))
    expect(transcript()).not.toMatch(/didn’t make a change I could take back/)
    for (const q of screen.queryAllByTestId('agent-question')) expect(q.querySelectorAll('button').length).toBe(0)
  }, 30000)
  it('nit 3: a partial Undo-all planned FIRST is ONE message — what was taken back, what is still in place, the rest not made', async () => {
    const { h, say } = mount(...TWO())
    await say('make the left chart weekly, then make the right chart monthly')
    await waitFor(() => expect(h.charts.read('c2').tf).toBe('M'), { timeout: 8000 })
    expect(h.charts.read('c1').tf).toBe('W')
    h.charts.commit('c1', { tf: '60' })                                       // the member edits the NVDA chart by hand
    envelopes.push(b => env('apply', [
      { action: 'agent.undo', target: ref(b, 'agent'), args: { scope: 'all', about: null } },
      { action: 'chart.setType', target: b.context.charts[1].ref, args: { type: 'line' } },
    ]))
    await say('undo everything you did in that last request and then make the amd one a line chart')
    await waitFor(() => expect(transcript()).toMatch(/Took back 1 of the 2 changes from your last request, then stopped \(above\) — the other 1 is still in place, so I didn’t make the rest of your request\./))
    expect(transcript()).not.toMatch(/didn’t go through/)
    expect(h.charts.read('c2').tf).toBe('D')
    expect(h.charts.read('c1').tf).toBe('60')
  }, 30000)
})

// ═══ M3 · add widgets + change existing ones in ONE request ═════════════════════════════════════════════
describe('M3 · add + change existing: run in order, ONE grouped Undo, safe partial completion', () => {
  it('fast path: "add a QQQ chart and change the SPY chart to weekly" — both made (no model call); ONE "undo" restores the board', async () => {
    const { board, h, say } = mount(...HALF())
    const before = shape(board, h)
    await say('add a QQQ chart and change the SPY chart to weekly')
    await waitFor(() => expect(chartsOf(board)).toHaveLength(2), { timeout: 8000 })
    expect(chartsOf(board).map(w => [h.charts.read(w.id).symbol, h.charts.read(w.id).tf])).toEqual([['SPY', 'W'], ['QQQ', 'D']])
    expect(turnBodies()).toHaveLength(0)
    expect(transcript()).not.toMatch(/same request|isn’t supported yet/)
    expect(receipts()).toHaveLength(2)
    expect(summaries().join(' | ')).toMatch(/QQQ/)
    expect(summaries().join(' | ')).toMatch(/Weekly/)
    await say('undo')
    await waitFor(() => expect(shape(board, h)).toBe(before), { timeout: 8000 })
    expect(h.charts.read('c1').tf).toBe('D')
    expect(transcript()).toMatch(/Took back all 2 changes from that request/)
  }, 30000)
  it('model path: add a chart for AAPL + the RSI on my SPY chart — both made; "undo that" takes back BOTH', async () => {
    const { board, h, say } = mount(...HALF())
    const before = JSON.stringify(board.state.widgets)
    envelopes.push(b => env('apply', [
      { action: 'widget.add', target: ref(b, 'workspace'), args: { type: 'chart', as: 'new1' } },
      { action: 'chart.setSymbol', target: 'new1', args: { symbol: 'AAPL' } },
      { action: 'indicator.add', target: b.context.indicatorEdits[0].ref, args: { defId: 'rsi', inputs: null } },
    ]))
    await say('add a chart for AAPL and put the RSI on my SPY chart')
    await waitFor(() => expect(chartsOf(board)).toHaveLength(2), { timeout: 8000 })
    await waitFor(() => expect(JSON.stringify(board.state.widgets.find(w => w.id === 'c1').opts)).toMatch(/"defId":"rsi"/))
    expect(h.charts.read(chartsOf(board)[1].id).symbol).toBe('AAPL')
    await say('undo that')
    await waitFor(() => expect(JSON.stringify(board.state.widgets)).toBe(before), { timeout: 8000 })
  }, 30000)
  it('model path, the change planned FIRST: runs in the member order; a described Undo ("undo the timeframe change") takes back only that part', async () => {
    const { board, h, say } = mount(...HALF())
    envelopes.push(b => env('apply', [
      { action: 'chart.setTimeframe', target: b.context.charts[0].ref, args: { timeframe: 'W' } },
      { action: 'widget.add', target: ref(b, 'workspace'), args: { type: 'chart', as: 'new1' } },
      { action: 'chart.setSymbol', target: 'new1', args: { symbol: 'QQQ' } },
    ]))
    await say('switch my SPY over to the weekly and also open up a QQQ chart for me')
    await waitFor(() => expect(chartsOf(board)).toHaveLength(2), { timeout: 8000 })
    expect(h.charts.read('c1').tf).toBe('W')
    expect(receipts()[0].textContent).toMatch(/Switched timeframe to Weekly/)       // the member's order: the change, then the add
    expect(receipts()[1].textContent).toMatch(/QQQ/)
    await say('revert the timeframe change')
    await waitFor(() => expect(h.charts.read('c1').tf).toBe('D'))
    expect(chartsOf(board)).toHaveLength(2)                                    // the QQQ chart stays
  }, 30000)
  it('safe partial completion: the second part does not land → the first part stays, said exactly; never a success claim', async () => {
    const { board, h, say } = mount(...HALF(), {}, { failAddAt: 1 })
    envelopes.push(b => env('apply', [
      { action: 'chart.setTimeframe', target: b.context.charts[0].ref, args: { timeframe: 'W' } },
      { action: 'widget.add', target: ref(b, 'workspace'), args: { type: 'chart', as: 'new1' } },
      { action: 'chart.setSymbol', target: 'new1', args: { symbol: 'QQQ' } },
    ]))
    await say('switch my SPY over to the weekly and also open up a QQQ chart for me')
    await waitFor(() => expect(transcript()).toMatch(/I made the first part of your request \(above\), then stopped: “added a chart for QQQ” didn’t go through/), { timeout: 15000 })
    expect(transcript()).not.toMatch(/Done in 2 steps/)
    expect(chartsOf(board)).toHaveLength(1)
    expect(h.charts.read('c1').tf).toBe('W')
    await say('undo')
    await waitFor(() => expect(h.charts.read('c1').tf).toBe('D'))
  }, 40000)
  it('the first part does not land → nothing after it starts', async () => {
    const { board, h, say } = mount(...HALF(), {}, { failAddAt: 1 })
    envelopes.push(b => env('apply', [
      { action: 'widget.add', target: ref(b, 'workspace'), args: { type: 'chart', as: 'new1' } },
      { action: 'chart.setSymbol', target: 'new1', args: { symbol: 'QQQ' } },
      { action: 'chart.setTimeframe', target: b.context.charts[0].ref, args: { timeframe: 'W' } },
    ]))
    await say('open up a QQQ chart for me and also switch my SPY over to the weekly')
    await waitFor(() => expect(transcript()).toMatch(/I stopped there: “added a chart for QQQ” didn’t go through \(see above\), so I didn’t start “switched timeframe to Weekly”\. Nothing else was changed\./), { timeout: 15000 })
    expect(chartsOf(board)).toHaveLength(1)
    expect(h.charts.read('c1').tf).toBe('D')
  }, 40000)
  it('KEPT REFUSED — a proposal (approval) cannot hold two steps: nothing runs, the two-step split is suggested', async () => {
    const { board, h, say } = mount(...HALF())
    const before = JSON.stringify(board.state.widgets)
    envelopes.push(b => env('propose', [
      { action: 'widget.add', target: ref(b, 'workspace'), args: { type: 'chart', as: 'new1' } },
      { action: 'chart.setSymbol', target: 'new1', args: { symbol: 'QQQ' } },
      { action: 'chart.setTimeframe', target: b.context.charts[0].ref, args: { timeframe: 'W' } },
    ]))
    await say('open up a QQQ chart for me and also switch my SPY over to the weekly')
    await waitFor(() => expect(transcript()).toMatch(/needs your approval first\. Ask in two steps: the new widgets first, then the change to the ones you already have/))
    expect(JSON.stringify(board.state.widgets)).toBe(before)
    expect(h.charts.read('c1').tf).toBe('D')
    expect(screen.queryAllByTestId('agent-proposal')).toHaveLength(0)
  }, 30000)
  it('KEPT REFUSED — new widgets + a change to the BOARD itself (remove / re-tile / move): nothing runs', async () => {
    const { board, say } = mount(...HALF())
    const before = JSON.stringify(board.state.widgets)
    envelopes.push(b => env('apply', [
      { action: 'widget.add', target: ref(b, 'workspace'), args: { type: 'chart', as: 'new1' } },
      { action: 'chart.setSymbol', target: 'new1', args: { symbol: 'QQQ' } },
      { action: 'widget.remove', target: ref(b, 'board'), args: { widget: 'c1' } },
    ]))
    await say('swap out my spy chart for a fresh qqq one please')
    await waitFor(() => expect(transcript()).toMatch(/I can’t add new widgets and change existing ones in the same request here — ask in two steps/))
    expect(JSON.stringify(board.state.widgets)).toBe(before)
  }, 30000)
})
