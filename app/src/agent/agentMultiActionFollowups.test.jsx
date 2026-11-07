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
import { touchesCharts, arrangesBoard, asSubjectWords, isShortAnswer, isNewRequest } from './useAgent'
import { AuthContext } from '../context/AuthContext'
import { NL1_KEY } from './nl1/interpreter'
import { loadAgentConfig, _resetAgentConfig } from './agentClient'
import { selectGroups, routeManifest, wordsSelect } from './routing'
import { fastParse } from './fastPath'
import { multiChartPlan } from './multiChart'
import { bindCreated } from './createdBinding'
import { workspaceKind } from './capabilities/workspace'
import { optsSignature } from './host'
import { buildIndicatorAlertSource } from './host'
import { _resetIndicatorAlertCache } from './capabilities/indicatorAlerts'
import { notDoneLines } from './notDone'
import { parsePriceSentence } from './capabilities/marketDataPhrases'
import { receiptView } from './receiptView'
import { manifestFor, MANIFEST_CONTRACT } from './capabilities'
const FULLM = manifestFor({ surface: 'charts', createIndicator: true })
const LIM = { limit: MANIFEST_CONTRACT.limits.maxCapabilities, budget: MANIFEST_CONTRACT.routingThreshold }

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
import AgentPanel from './AgentPanel'

registerBuiltins()

let envelopes, calls, saveFails
let nl1Config = false
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
    if (url === '/api/agent/config') return nl1Config ? json({ stream: false, nl1: true }) : json({ conversations: [] })
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
    await waitFor(() => expect(transcript()).toMatch(/I made “the change to Chart c1” \(above\), then stopped: “a new chart for QQQ” didn’t go through \(see above\), so it isn’t on your board\. Say “undo” to take back “the change to Chart c1”\./), { timeout: 15000 })
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
    await waitFor(() => expect(transcript()).toMatch(/I stopped there: “a new chart for QQQ” didn’t go through \(see above\), so I didn’t start “the change to Chart c1”\. Nothing else was changed\./), { timeout: 15000 })
    expect(chartsOf(board)).toHaveLength(1)
    expect(h.charts.read('c1').tf).toBe('D')
  }, 40000)
  it('review #771 (2): a part that lands but is NOT SAVED is said exactly so — on screen, not saved; no Undo promised for it', async () => {
    let n = 0
    const { board, h, say } = mount(...HALF(), { epoch: () => 1, persist: async () => (++n === 2 ? { ok: false, reason: 'not-saved' } : { ok: true }) })
    envelopes.push(b => env('apply', [
      { action: 'chart.setTimeframe', target: b.context.charts[0].ref, args: { timeframe: 'W' } },
      { action: 'widget.add', target: ref(b, 'workspace'), args: { type: 'chart', as: 'new1' } },
      { action: 'chart.setSymbol', target: 'new1', args: { symbol: 'QQQ' } },
    ]))
    await say('switch my SPY over to the weekly and also open up a QQQ chart for me')
    await waitFor(() => expect(transcript()).toMatch(/I made “the change to Chart c1” \(above\)\. “a new chart for QQQ” is on your screen but wasn’t saved \(see above\)\. Say “undo” to take back “the change to Chart c1”\./), { timeout: 15000 })
    expect(transcript()).not.toMatch(/isn’t on your board|Done in 2 steps/)
    expect(chartsOf(board)).toHaveLength(2)
    expect(h.charts.read('c1').tf).toBe('W')
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

// ═══ AUDIT (live production checks on edd353fc06) ═══════════════════════════════════════════════════════
describe('AUDIT · live checks on #766', () => {
  const GRID = 'Put SPY, QQQ, NVDA, and TSLA on four charts, all the same size.'
  it('A1: "Undo the change you made to my layout" after a 2×2 grid takes the grid back (a grid IS a layout change)', async () => {
    const { board, h, say } = mount(...HALF())
    const before = shape(board, h)
    await say(GRID)
    await waitFor(() => expect(chartsOf(board)).toHaveLength(4), { timeout: 8000 })
    await say('Undo the change you made to my layout')
    await waitFor(() => expect(shape(board, h)).toBe(before), { timeout: 8000 })
    expect(transcript()).not.toMatch(/wasn't a layout change/)
    expect(turnBodies()).toHaveLength(0)
  }, 30000)
  it('A1: what counts as a layout change is structural — placing / re-tiling / adding / removing widgets, never a setting or a link colour', () => {
    expect(arrangesBoard({ kind: 'board', patch: { grid: { reuse: [] } } })).toBe(true)
    expect(arrangesBoard({ kind: 'board', patch: { set: { c1: { x: 0, w: 12 } } } })).toBe(true)
    expect(arrangesBoard({ kind: 'board', patch: { remove: ['n1'] } })).toBe(true)
    expect(arrangesBoard({ kind: 'workspace', patch: { add: [{ type: 'chart' }] } })).toBe(true)
    expect(arrangesBoard({ kind: 'board', patch: { set: { c1: { color: 'N' } } } })).toBe(false)
    expect(arrangesBoard({ kind: 'board', patch: { set: { c1: { opts: {} } } } })).toBe(false)
    expect(arrangesBoard({ kind: 'chart', patch: { tf: 'W' } })).toBe(false)
  })
  it('A1: a TIMEFRAME change is still not a layout change (review F2 unchanged)', async () => {
    const { h, say } = mount(...HALF())
    await say('weekly')
    await waitFor(() => expect(h.charts.read('c1').tf).toBe('W'))
    await say('undo what you did to my layout')
    await waitFor(() => expect(transcript()).toMatch(/My last change wasn't a layout change/))
    expect(h.charts.read('c1').tf).toBe('W')
  }, 30000)
  it('A2: a board-only change (the grid, adding a chart) is acknowledged on the BOARD\'s own save — it never waits on other preference writes (the new charts\' chart_settings as they load)', async () => {
    const asked = []
    const { board, h, say } = mount(...HALF(), { epoch: () => 1, persist: async (opts) => { asked.push(opts ?? 'default'); return { ok: true } } })
    // (BROWSER-QA-1 #1: the add comes first — on the full 2×2 board there is no empty space for a fifth chart, and the
    // Agent now says so instead of placing it off-screen)
    await say('add a chart for AMD')
    await waitFor(() => expect(receipts()).toHaveLength(1), { timeout: 8000 })
    expect(asked).toEqual([{ settle: [] }])
    await say('make the AMD chart weekly')
    await waitFor(() => expect(receipts()).toHaveLength(2), { timeout: 8000 })
    // a timeframe lives in the layout, so it needs no other write either (agentEarlyReceipt.test: a settings change still waits)
    expect(asked[1]).toEqual({ settle: [] })
    expect(h.charts.read(chartsOf(board).find(w => h.charts.read(w.id).symbol === 'AMD').id).tf).toBe('W')
    await say(GRID)
    await waitFor(() => expect(chartsOf(board)).toHaveLength(4), { timeout: 8000 })
    await waitFor(() => expect(receipts()).toHaveLength(3))
    expect(asked[2]).toEqual({ settle: [] })
  }, 40000)
})

// ═══ AUDIT · one stock's price history routes the data group ═══════════════════════════════════════════
describe('AUDIT · "Show me NVDA\'s recent pullbacks." routes `data` (stock.dailyBars)', () => {
  it('possessive / lower-case tickers and the history words select data; the data group carries stock.dailyBars', () => {
    for (const m of ['Show me NVDA\'s recent pullbacks.', 'show me NVDA’s recent pullbacks', 'how far has NVDA pulled back', 'NVDA drawdowns this year',
      'how far off its high is NVDA', 'nvda pullbacks', 'what was AMD\'s trading range over the last 20 days', 'TSLA price history', 'When does TSLA report earnings next?']) {
      expect(selectGroups(m).selected, m).toContain('data')
    }
    expect(routeManifest(FULLM, 'show me NVDA recent pullbacks', LIM).manifest.length).toBeGreaterThan(0)   // stock.dailyBars registers only while the server serves bars.daily
  })
  it('a question over a UNIVERSE of stocks stays the screener\'s (the history words never add data there)', () => {
    for (const m of ['show me stocks pulling back to the 20 ema', 'find names with a drawdown under 10%', 'scan for pullbacks'])
      expect(selectGroups(m).selected, m).not.toContain('data')
  })
  it('a possessive ticker after a show verb is a chart symbol too', () => {
    expect(selectGroups('show NVDA\'s chart').selected).toContain('charts')
  })
})

// ═══ AUDIT · a partly-possible request does the possible part AND says what wasn't done ═════════════════
describe('AUDIT · "…to weekly and email me a screenshot of it" — the change runs, the rest is said as NOT DONE (fixed sentences)', () => {
  const CASES = [
    ['Change the SPY chart to weekly and email me a screenshot of it.', /Not done: I can’t send email/],
    ['switch SPY to the weekly and set an alert that texts me by SMS when it crosses 600', /Not done: I can’t send text messages \(SMS\)/],
    ['put my SPY chart on the weekly and then place a trade to buy 100 shares', /Not done: I can’t place trades or orders/],
    ['make the SPY chart weekly and print it out for me', /Not done: I can’t print/],
    ['change SPY to weekly and export the chart data to Excel', /Not done: I can’t export to Excel/],
  ]
  for (const [said, line] of CASES) {
    it(said, async () => {
      const { h, say } = mount(...HALF())
      envelopes.push(b => env('apply', [{ action: 'chart.setTimeframe', target: b.context.charts[0].ref, args: { timeframe: 'W' } }]))
      await say(said)
      await waitFor(() => expect(h.charts.read('c1').tf).toBe('W'))
      expect(receipts()).toHaveLength(1)
      await waitFor(() => expect(transcript()).toMatch(line))
      // said AFTER the receipt — the request never reads as complete
      const t = transcript()
      expect(t.indexOf('Not done:')).toBeGreaterThan(t.indexOf('Switched timeframe to Weekly'))
    }, 30000)
  }
  it('review #771 (4): a stray unsupported_category on a fully supported request adds NO line — only the member\'s words decide', async () => {
    const { h, say } = mount(...HALF())
    envelopes.push(b => ({ ...env('apply', [{ action: 'chart.setTimeframe', target: b.context.charts[0].ref, args: { timeframe: 'W' } }]), unsupported_category: 'indicators' }))
    await say('put spy over on the weekly view for me please')
    await waitFor(() => expect(h.charts.read('c1').tf).toBe('W'))
    expect(transcript()).not.toMatch(/Not done/)
  }, 30000)
  it('review #771 (4): "print the 52-week high" and "send alerts to my email" are not unsupported parts', () => {
    expect(notDoneLines('print the 52-week high for NVDA')).toEqual([])
    expect(notDoneLines('change SPY to weekly and send alerts to my email')).toEqual([])
    expect(notDoneLines('make it weekly and print the chart')).toHaveLength(1)
  })
  it('a fully supported request says nothing extra; a part a planned action covers (the email digest) is never "not done"', () => {
    expect(notDoneLines('change SPY to weekly')).toEqual([])
    expect(notDoneLines('email me my Momentum watchlist every morning', { actions: ['settings.setWatchlistDigest'] })).toEqual([])
    expect(notDoneLines('dark pool prints over $10M')).toEqual([])
    expect(notDoneLines('is NVDA near a buy point')).toEqual([])
    expect(notDoneLines('show me the sell-off')).toEqual([])
  })
})

// ═══ C · context across turns: the chart just created ═══════════════════════════════════════════════════
describe('C · "change it to weekly" / "add the RSI to that one" right after creating a chart → the chart just created', () => {
  const newChart = (board) => chartsOf(board).find(w => w.id !== 'c1')
  for (const then of ['change it to weekly', 'make that one weekly', 'make the new chart weekly', 'switch the new one to weekly', 'make the chart you just added weekly']) {
    it(`"add a QQQ chart" → "${then}": the QQQ chart, no question, no model call`, async () => {
      const { board, h, say } = mount(...HALF())
      await say('add a QQQ chart')
      await waitFor(() => expect(chartsOf(board)).toHaveLength(2), { timeout: 8000 })
      await say(then)
      await waitFor(() => expect(h.charts.read(newChart(board).id).tf).toBe('W'))
      expect(h.charts.read('c1').tf).toBe('D')
      expect(screen.queryAllByTestId('agent-question')).toHaveLength(0)
      expect(turnBodies()).toHaveLength(0)
    }, 30000)
  }
  it('"put the RSI on it" after creating a chart → the new chart', async () => {
    const { board, say } = mount(...HALF())
    await say('add a QQQ chart')
    await waitFor(() => expect(chartsOf(board)).toHaveLength(2), { timeout: 8000 })
    await say('put the RSI on it')
    await waitFor(() => expect(JSON.stringify(newChart(board).opts)).toMatch(/"defId":"rsi"/))
    expect(JSON.stringify(board.state.widgets.find(w => w.id === 'c1').opts)).not.toMatch(/"defId":"rsi"/)
  }, 30000)
  it('model path: the model is told the NEW chart is the subject (never the workspace), and its plan on it runs without "which chart?"', async () => {
    const { board, say } = mount(...HALF())
    await say('add a QQQ chart')
    await waitFor(() => expect(chartsOf(board)).toHaveLength(2), { timeout: 8000 })
    envelopes.push(b => {
      const subj = b.context.conversation_memory?.subject_chart
      const ixe = (b.context.indicatorEdits || []).find(e => e.symbol === 'QQQ')?.ref
      return env('apply', subj && ixe ? [{ action: 'indicator.add', target: ixe, args: { defId: 'rsi', inputs: null } }] : [])
    })
    await say('add the RSI study to that one too')
    const body = turnBodies()[0]
    expect(body.context.charts.find(c => c.ref === body.context.conversation_memory.subject_chart)?.symbol).toBe('QQQ')
    await waitFor(() => expect(JSON.stringify(newChart(board).opts)).toMatch(/"defId":"rsi"/))
    expect(screen.queryAllByTestId('agent-question')).toHaveLength(0)
  }, 30000)
  it('"the new one" names exactly ONE chart the last request created — none or several are never guessed', () => {
    expect(asSubjectWords('make the new one weekly', null)).toEqual({ text: 'make the new one weekly', subject: null })
    expect(asSubjectWords('make the new one weekly', ['w1', 'w2'])).toEqual({ text: 'make the new one weekly', subject: null })
    expect(asSubjectWords('make the new one weekly', ['w1'])).toEqual({ text: 'make it weekly', subject: 'w1' })
    expect(asSubjectWords('make that one weekly', null)).toEqual({ text: 'make it weekly', subject: null })
  })
  for (const then of ['make the new one monthly', 'make the chart you just added monthly']) {
    it(`review #771 HIGH: "add a QQQ chart and change the SPY chart to weekly" → "${then}" changes the NEW (QQQ) chart, never SPY`, async () => {
      const { board, h, say } = mount(...HALF())
      await say('add a QQQ chart and change the SPY chart to weekly')
      await waitFor(() => expect(chartsOf(board)).toHaveLength(2), { timeout: 8000 })
      await waitFor(() => expect(h.charts.read('c1').tf).toBe('W'))
      await say(then)
      await waitFor(() => expect(h.charts.read(newChart(board).id).tf).toBe('M'))
      expect(h.charts.read('c1').tf).toBe('W')
    }, 30000)
  }
  it('review #771 HIGH (deferred path): "add a chart for AAPL and put the RSI on my SPY chart" → "make the new one weekly" → the AAPL chart', async () => {
    const { board, h, say } = mount(...HALF())
    envelopes.push(b => env('apply', [
      { action: 'widget.add', target: ref(b, 'workspace'), args: { type: 'chart', as: 'new1' } },
      { action: 'chart.setSymbol', target: 'new1', args: { symbol: 'AAPL' } },
      { action: 'indicator.add', target: b.context.indicatorEdits[0].ref, args: { defId: 'rsi', inputs: null } },
    ]))
    await say('add a chart for AAPL and put the RSI on my SPY chart')
    await waitFor(() => expect(JSON.stringify(board.state.widgets.find(w => w.id === 'c1').opts)).toMatch(/"defId":"rsi"/), { timeout: 8000 })
    await say('make the new one weekly')
    await waitFor(() => expect(h.charts.read(newChart(board).id).tf).toBe('W'))
    expect(h.charts.read('c1').tf).toBe('D')
  }, 30000)
  it('two charts created → "the new one" is asked about, never guessed', async () => {
    const { board, h, say } = mount(...HALF())
    await say('add a chart for QQQ and a chart for AMD')
    await waitFor(() => expect(chartsOf(board)).toHaveLength(3), { timeout: 8000 })
    await say('make the new one weekly')
    expect(chartsOf(board).every(w => h.charts.read(w.id).tf === 'D')).toBe(true)
  }, 30000)
})

// ═══ R · receipts name every chart (symbol + timeframe) and every setting ═══════════════════════════════
describe('R · multi-op receipts name each chart and setting; no "already" for new charts', () => {
  it('pure: a few changes are each said, each named chart with its timeframe; more than four point at Details (which list them all)', () => {
    const charts = [{ label: 'Left chart (NVDA)', symbol: 'NVDA', tf: 'W' }, { label: 'Right chart (AMD)', symbol: 'AMD', tf: 'D' }]
    const v = receiptView(['Left chart (NVDA): Switched timeframe to Weekly', 'Right chart (AMD): Added RSI (14)'], { charts })
    expect(v.summary).toBe('Left chart (NVDA · Weekly): Switched timeframe to Weekly; right chart (AMD · Daily): Added RSI (14).')
    expect(v.details).toBe('Left chart (NVDA): Switched timeframe to Weekly · Right chart (AMD): Added RSI (14)')
    const many = receiptView(['a', 'b', 'c', 'd', 'e'])
    expect(many.summary).toMatch(/\(and 4 more changes — see Details\)/)
    expect(many.details).toBe('a · b · c · d · e')
    // new charts: their timeframe too
    expect(receiptView(['Added 2 Charts', 'New chart 1: Changed symbol to NVDA', 'New chart 2: Changed symbol to QQQ'],
      { charts: [{ symbol: 'NVDA', tf: 'D', isNew: true }, { symbol: 'QQQ', tf: 'W', isNew: true }] }).summary).toBe('Done — added 2 charts for NVDA (Daily) and QQQ (Weekly).')
    expect(receiptView(['Added a Chart', 'New chart 1: Changed symbol to QQQ'], { charts: [{ symbol: 'QQQ', tf: '5', isNew: true }] }).summary).toMatch(/^Done — added a 5-minute chart for QQQ\.$|^Done — added a 5 min/)
  })
  it('panel: two charts changed in one request → one receipt naming both charts with their timeframes', async () => {
    const { h, say } = mount(...TWO())
    envelopes.push(b => env('apply', [
      { action: 'chart.setTimeframe', target: b.context.charts[0].ref, args: { timeframe: 'W' } },
      { action: 'chart.setTimeframe', target: b.context.charts[1].ref, args: { timeframe: 'M' } },
    ]))
    await say('switch NVDA over to weekly and AMD over to monthly please')
    await waitFor(() => expect(h.charts.read('c2').tf).toBe('M'))
    const s = summaries().join(' | ')
    expect(s).toMatch(/NVDA · Weekly/)
    expect(s).toMatch(/AMD · Monthly/)
    expect(s).not.toMatch(/more change/)
  }, 30000)
  it('panel: an add + change request names the existing chart it changed (symbol + timeframe) and the new chart\'s ticker and timeframe; no "already" line', async () => {
    const { say } = mount(...HALF())
    await say('add a QQQ chart and change the SPY chart to weekly')
    await waitFor(() => expect(receipts()).toHaveLength(2), { timeout: 8000 })
    const s = summaries().join(' | ')
    expect(s).toMatch(/added a daily chart for QQQ/)
    expect(s).toMatch(/SPY · Weekly/)
    expect(transcript()).not.toMatch(/[Aa]lready/)
  }, 30000)
  it('panel: new charts created on a timeframe never report "already <timeframe>"', async () => {
    const { say } = mount(...HALF())
    envelopes.push(b => env('apply', [
      { action: 'widget.add', target: ref(b, 'workspace'), args: { type: 'chart', as: 'new1' } },
      { action: 'chart.setSymbol', target: 'new1', args: { symbol: 'NVDA' } },
      { action: 'chart.setTimeframe', target: 'new1', args: { timeframe: 'D' } },
    ]))
    await say('open a new daily chart for NVDA')
    await waitFor(() => expect(receipts()).toHaveLength(1), { timeout: 8000 })
    expect(transcript()).not.toMatch(/[Aa]lready/)
    expect(summaries()[0]).toMatch(/daily chart(?: for|:) NVDA/)
  }, 30000)
})

// ═══ CG · the regression corpus's known gaps owned here (#769) ══════════════════════════════════════════
describe('CG · corpus gaps — routing reads the owner\'s words', () => {
  it('CG-1 "four equal panels" and CG-2 "2×2" (the multiplication sign) route the chart grid', () => {
    for (const m of ['Show SPY, QQQ, NVDA and TSLA in four equal panels.', 'Make a 2×2 chart layout with SPY, QQQ, NVDA and TSLA.', 'SPY QQQ NVDA TSLA in 4 cells'])
      expect(selectGroups(m).selected, m).toContain('chartGrid')
  })
  it('CG-2: the deterministic grid reader reads "2×2" as "2x2"', () => {
    const board = makeBoard(...HALF())
    expect(multiChartPlan('Make a 2×2 chart layout with SPY, QQQ, NVDA and TSLA.', { host: board.host })?.ops?.[0]).toMatchObject({ action: 'chartGrid.set', args: { symbols: ['SPY', 'QQQ', 'NVDA', 'TSLA'] } })
  })
  it('CG-4 a spelled-out indicator routes indicators; CG-5 "what\'s the setup here" routes chartSetup', () => {
    expect(selectGroups('add the relative strength index').selected).toContain('indicators')
    expect(wordsSelect('chartSetup', "what's the setup here")).toBe(true)
    expect(wordsSelect('chartSetup', 'whats the setup on this chart')).toBe(true)
  })
  it('CG-6/7/7b: one stock\'s history names the DATA group by its own words; "drawdowns" is never a drawing', () => {
    for (const m of ["show me NVDA's recent pullbacks", 'nvda pullbacks', 'how far has NVDA pulled back', 'NVDA drawdowns this year', 'NVDA distance from the 52-week high'])
      expect(wordsSelect('data', m), m).toBe(true)
    expect(wordsSelect('drawings', 'NVDA drawdowns this year')).toBe(false)
    expect(wordsSelect('drawings', 'draw a line at 500')).toBe(true)
  })
  it('CG-9: "put my layout back" is an Undo (words and routing)', () => {
    expect(fastParse('put my layout back')).toEqual({ kind: 'undo', about: 'layout' })
    expect(fastParse('put the charts back the way they were')).toEqual({ kind: 'undo', about: 'chart' })
    expect(selectGroups('put my layout back').selected).toContain('undo')
  })
  it('CG-9 (panel): "put my layout back" after a 2×2 grid restores the board', async () => {
    const { board, h, say } = mount(...HALF())
    const before = shape(board, h)
    await say('Put SPY, QQQ, NVDA, and TSLA on four charts, all the same size.')
    await waitFor(() => expect(chartsOf(board)).toHaveLength(4), { timeout: 8000 })
    await say('put my layout back')
    await waitFor(() => expect(shape(board, h)).toBe(before), { timeout: 8000 })
    expect(turnBodies()).toHaveLength(0)
  }, 30000)
  it('breadth: "hows breadth today" (no apostrophe) is read deterministically, like "how\'s breadth today"', () => {
    for (const t of ['hows breadth today', "how's breadth today", 'how’s breadth today'])
      expect(fastParse(t)?.ops?.[0]?.action, t).toBe('breadth.show')
  })
})

describe('OWNER RULING · a plain "undo" after a multi-change request takes back the WHOLE request', () => {
  it('"add RSI and switch to weekly" (two steps) → "undo" → both taken back; a described Undo still takes one', async () => {
    const { board, h, say } = mount(...HALF())
    const before = shape(board, h)
    envelopes.push(b => env('apply', [
      { action: 'chart.setTimeframe', target: b.context.charts[0].ref, args: { timeframe: 'W' } },
      { action: 'indicator.add', target: b.context.indicatorEdits[0].ref, args: { defId: 'rsi', inputs: null } },
    ]))
    await say('put the rsi study on and flip it over to the weekly view for me')
    await waitFor(() => expect(JSON.stringify(board.state.widgets[0].opts)).toMatch(/"defId":"rsi"/), { timeout: 8000 })
    expect(h.charts.read('c1').tf).toBe('W')
    await say('undo')
    await waitFor(() => expect(shape(board, h)).toBe(before), { timeout: 8000 })
    expect(transcript()).toMatch(/Took back all 2 changes from that request/)
  }, 30000)
})

describe('CG-3 · a COUNT of charts with no tickers: new charts, then ONE even re-tile — one grouped Undo', () => {
  it('routing: the count names the workspace group (widget.add + widget.arrange)', () => {
    for (const m of ['Put four charts on my screen.', 'Create four charts.', 'Make a 2×2 chart layout.'])
      expect(selectGroups(m).selected, m).toContain('workspace')
  })
  for (const order of ['adds-first', 'arrange-first']) {
    it(`model plan (${order}): 3 adds + widget.arrange(grid) → four equal charts; "undo" restores the board`, async () => {
      const { board, h, say } = mount(...HALF())
      const before = shape(board, h)
      envelopes.push(b => {
        const adds = [1, 2, 3].map(n => ({ action: 'widget.add', target: ref(b, 'workspace'), args: { type: 'chart', as: `new${n}` } }))
        const arrange = { action: 'widget.arrange', target: ref(b, 'board'), args: { widgets: null, pattern: 'grid' } }
        return env('apply', order === 'adds-first' ? [...adds, arrange] : [arrange, ...adds])
      })
      await say('Put four charts on my screen.')
      await waitFor(() => expect(chartsOf(board)).toHaveLength(4), { timeout: 10000 })
      await waitFor(() => expect(new Set(chartsOf(board).map(w => `${w.w}x${w.h}`)).size).toBe(1), { timeout: 10000 })
      expect(transcript()).not.toMatch(/same request/)
      await say('undo')
      await waitFor(() => expect(shape(board, h)).toBe(before), { timeout: 10000 })
    }, 40000)
  }
  it('KEPT REFUSED: new charts + re-tiling only SOME widgets (a board change the adds depend on)', async () => {
    const { board, h, say } = mount(...HALF())
    const before = shape(board, h)
    envelopes.push(b => env('apply', [
      { action: 'widget.add', target: ref(b, 'workspace'), args: { type: 'chart', as: 'new1' } },
      { action: 'widget.arrange', target: ref(b, 'board'), args: { widgets: ['c1'], pattern: 'grid' } },
    ]))
    await say('add a chart and tidy the first one up')
    await waitFor(() => expect(transcript()).toMatch(/ask in two steps|didn't change anything/))
    expect(shape(board, h)).toBe(before)
  }, 30000)
})

// ═══ AUDIT · indicator alerts on a board of several charts (live 2026-11-04, train 3) ═══════════════════
describe('AUDIT · indicatorAlert.create is ONE chart\'s — resolved by named symbol, the selection, a clarify choice', () => {
  const CROSS = [{ value: 'cross_above', label: 'Fast MA crosses above slow MA', needs_threshold: false }, { value: 'cross_below', label: 'Fast MA crosses below slow MA', needs_threshold: false }]
  const OSC = [{ value: 'above', label: 'Above threshold', needs_threshold: true }, { value: 'below', label: 'Below threshold', needs_threshold: true }]
  const CATALOG = [
    { indicator: 'rsi', label: 'RSI', conditions: OSC, default_threshold: 70, plots: [{ value: 'rsi', label: 'RSI', conditions: OSC, default_threshold: 70, inputs: { period: 14 } }] },
    { indicator: 'ma_cross', label: 'MA Cross', conditions: CROSS, default_threshold: null, plots: [{ value: 'ma_cross', label: 'MA Cross', conditions: CROSS, default_threshold: null, inputs: { ma_type: 'ema', fast: 9, slow: 20 }, instance_defs: ['movingAverage'] }] },
  ]
  let alertPosts, rows
  const withRsi = () => ({ settings: { ...mergeChartSettings(null), indicatorInstances: [...(mergeChartSettings(null).indicatorInstances || []), { instanceId: 'inst:rsi:1', defId: 'rsi', inputs: { period: 14 }, hidden: false }] } })
  // three charts, every one carrying the default EMA 9 / EMA 20 (the SAME instance ids "ovl:0" / "ovl:1") and the same RSI id
  const SIX = () => [[
    { id: 'c1', type: 'chart', x: 0, y: 0, w: 8, h: 20, color: 'A', opts: withRsi() },
    { id: 'c2', type: 'chart', x: 8, y: 0, w: 8, h: 20, color: 'B', opts: withRsi() },
    { id: 'c3', type: 'chart', x: 16, y: 0, w: 8, h: 20, color: 'C', opts: withRsi() },
  ], { A: 'NVDA', B: 'TSLA', C: 'TSLA' }]
  beforeEach(() => {
    alertPosts = []; rows = []
    _resetIndicatorAlertCache()
    const inner = globalThis.fetch
    globalThis.fetch = vi.fn(async (url, init = {}) => {
      const u = String(url), m = (init.method || 'GET').toUpperCase()
      const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } })
      if (u === '/api/indicator-alerts/catalog') return json({ catalog: CATALOG, refusals: [] })
      if (u === '/api/indicator-alerts' && m === 'GET') return json({ alerts: rows })
      if (u === '/api/indicator-alerts' && m === 'POST') {
        const body = JSON.parse(init.body)
        alertPosts.push(body)
        const row = { id: 100 + rows.length, sym: body.sym, indicator: body.indicator, condition: body.condition ?? null, threshold: body.threshold ?? null, tf: body.tf, active: true, instance_id: body.instance_id ?? null, params_json: body.params ? JSON.stringify(body.params) : null }
        rows.push(row)
        return json({ id: row.id })
      }
      return inner(url, init)
    })
  })
  function mountSel(selected) {
    const r = mount(...SIX(), { indicatorAlerts: buildIndicatorAlertSource() })
    r.h.charts.selected = () => selected
    return r
  }
  const lib = (b) => b.context.indicatorAlertLibrary[0].ref
  const cross = (b, instance, crossWith, chart = null) => ({ action: 'indicatorAlert.create', target: lib(b), args: { instance, plot: null, condition: 'cross_above', threshold: null, crossWith, chart } })
  async function approve(say) {
    await waitFor(() => expect(screen.queryAllByTestId('agent-proposal').length).toBeGreaterThan(0), { timeout: 8000 })
    await say('do it')
    await waitFor(() => expect(alertPosts.length).toBe(1), { timeout: 8000 })
  }
  it('by a NAMED symbol: "…on the NVDA chart" → the NVDA chart\'s EMA 9 × EMA 20, no "which chart?"', async () => {
    const { say } = mountSel(null)
    envelopes.push(b => env('propose', [cross(b, 'ovl:0', 'ovl:1')], 'Alert you when the 9 EMA crosses above the 20 EMA on NVDA.'))
    await say('Alert me when the 9 EMA crosses above the 20 EMA on the NVDA chart.')
    expect(transcript()).not.toMatch(/on \d+ charts with different symbols/)
    await approve(say)
    expect(alertPosts[0]).toMatchObject({ sym: 'NVDA', indicator: 'ma_cross', condition: 'cross_above' })
  }, 40000)
  it('"this chart" with a chart SELECTED (human refs "ema_9" / "ema_20") → that chart', async () => {
    const { say } = mountSel('c3')
    envelopes.push(b => env('propose', [cross(b, 'ema_9', 'ema_20')], 'Alert you when the 9 EMA crosses above the 20 EMA on the TSLA daily chart.'))
    await say('alert me when the 9 ema crosses above the 20 on this chart')
    expect(transcript()).not.toMatch(/on \d+ charts with different symbols/)
    await approve(say)
    expect(alertPosts[0]).toMatchObject({ sym: 'TSLA', indicator: 'ma_cross' })
  }, 40000)
  it('the MODEL names the chart (`chart` = its context ref) → that chart', async () => {
    const { say } = mountSel(null)
    envelopes.push(b => env('propose', [cross(b, 'ovl:0', 'ovl:1', b.context.charts.find(c => c.symbol === 'NVDA').ref)]))
    await say('set up a cross alert on the 9 and 20 for my first chart please')
    await approve(say)
    expect(alertPosts[0]).toMatchObject({ sym: 'NVDA' })
  }, 40000)
  it('review #771 delta M2: a named symbol that IS the selected chart\'s still resolves to it', async () => {
    const { say } = mountSel('c1')                                                   // NVDA selected
    envelopes.push(b => env('propose', [{ action: 'indicatorAlert.create', target: lib(b), args: { instance: 'inst:rsi:1', plot: null, condition: 'above', threshold: 70, crossWith: null, chart: null } }]))
    await say("alert me when NVDA's RSI goes above 70 — no wait, I mean on the chart in the middle")
    await approve(say)
    expect(alertPosts[0]).toMatchObject({ sym: 'NVDA' })
  }, 40000)
  it('review #771 delta M2: the named symbol wins over a selection on ANOTHER symbol', async () => {
    const { say } = mountSel('c2')                                                   // a TSLA chart selected, the member names NVDA
    envelopes.push(b => env('propose', [{ action: 'indicatorAlert.create', target: lib(b), args: { instance: 'inst:rsi:1', plot: null, condition: 'above', threshold: 70, crossWith: null, chart: null } }]))
    await say("alert me when NVDA's RSI goes above 70")
    await approve(say)
    expect(alertPosts[0]).toMatchObject({ sym: 'NVDA' })
  }, 40000)
  it('via the model\'s CLARIFY: the clicked choice keeps the question\'s groups (indicatorAlerts) and picks that chart', async () => {
    const { say } = mountSel(null)
    envelopes.push(() => ({ ...env('clarify', [], ''), question: { text: 'Which TSLA chart?', choices: [{ label: 'Chart c2' }, { label: 'Chart c3' }] } }))
    envelopes.push(b => env('propose', [cross(b, 'ovl:0', 'ovl:1')]))
    await say('Alert me when the 9 EMA crosses above the 20 EMA on the TSLA chart.')
    await waitFor(() => expect(screen.queryAllByTestId('agent-question')).toHaveLength(1))
    fireEvent.click(screen.getByRole('button', { name: 'Chart c3' }))
    await idle()
    expect(turnBodies()).toHaveLength(2)
    expect(turnBodies()[1].capabilities.map(c => c.name)).toContain('indicatorAlert.create')   // the question's groups rode along
    expect(transcript()).not.toMatch(/on \d+ charts with different symbols/)
    await approve(say)
    expect(alertPosts[0]).toMatchObject({ sym: 'TSLA', indicator: 'ma_cross' })
  }, 40000)
  it('an RSI threshold alert resolves the same way (named symbol)', async () => {
    const { say } = mountSel(null)
    envelopes.push(b => env('propose', [{ action: 'indicatorAlert.create', target: lib(b), args: { instance: 'inst:rsi:1', plot: null, condition: 'above', threshold: 70, crossWith: null, chart: null } }]))
    await say('let me know when RSI on NVDA goes above 70')
    await approve(say)
    expect(alertPosts[0]).toMatchObject({ sym: 'NVDA', indicator: 'rsi', condition: 'above', threshold: 70 })
  }, 40000)
  it('still ambiguous (two TSLA charts, nothing selected or chosen) → asked, and the refusal REPLACES the proposal\'s reply', async () => {
    const { say } = mountSel(null)
    envelopes.push(b => env('propose', [cross(b, 'ovl:0', 'ovl:1')], 'Alert you when the 9 EMA crosses above the 20 EMA on the TSLA daily chart.'))
    await say('Alert me when the 9 EMA crosses above the 20 EMA on the TSLA chart.')
    await waitFor(() => expect(transcript()).toMatch(/I didn't change anything/))
    expect(transcript()).not.toMatch(/Alert you when the 9 EMA crosses above the 20 EMA on the TSLA daily chart/)
    expect(alertPosts).toHaveLength(0)
  }, 40000)
})

describe('CG-10..16 · corpus gaps (#769): never the opposite action, never a quote for English words; routing', () => {
  it('CG-15: "trade places with the left and right charts" is never a quote (PLACES / LEFT / CHARTS)', () => {
    expect(parsePriceSentence('trade places with the left and right charts')).toBeNull()
    expect(parsePriceSentence('swap the left and right charts')).toBeNull()
    // CG-22 (corpus #774): an everyday word typed in lower case is never a ticker; a $-prefixed or capitalised one still is
    expect(parsePriceSentence('move the 200 line up to 210')).toBeNull()
    expect(parsePriceSentence('what is NVDA trading at')?.candidates?.map(c => c.text)).toEqual(['NVDA'])
    expect(selectGroups('trade places with the left and right charts').selected).toContain('boardEdit')
  })
  it('CG-11/12/13/14/16 route their capability groups', () => {
    expect(selectGroups('how much is NVDA right now').selected).toContain('data')
    expect(wordsSelect('alerts', 'tell me about TSM the company')).toBe(false)
    expect(selectGroups('tell me about TSM the company').selected).toContain('data')
    expect(selectGroups('tell me when NVDA crosses 150').selected).toContain('alerts')
    expect(selectGroups('how does NVDA stack up against AMD').selected).toContain('data')
    expect(selectGroups('get rid of the AMD chart').selected).toContain('workspace')
    expect(selectGroups('give me new charts for AAPL and MSFT').selected).toContain('workspace')
  })
  it('CG-10 (panel): "unhide the 50 sma" SHOWS a hidden SMA 50 — never hides it', async () => {
    const hiddenSma = () => {
      const s = mergeChartSettings(null)
      return { settings: { ...s, indicatorInstances: (s.indicatorInstances || []).map(i => (i.defId === 'movingAverage' && Number(i.inputs?.period) === 50 ? { ...i, hidden: true } : i)) } }
    }
    const { board, say } = mount([{ id: 'c1', type: 'chart', x: 0, y: 0, w: 24, h: 20, color: 'A', opts: hiddenSma() }], { A: 'SPY' })
    const sma50 = () => (board.state.widgets[0].opts.settings.indicatorInstances || []).find(i => i.defId === 'movingAverage' && Number(i.inputs?.period) === 50)
    expect(sma50()?.hidden).toBe(true)
    await say('unhide the 50 sma')
    await waitFor(() => expect(sma50()?.hidden).toBeFalsy(), { timeout: 8000 })
    expect(turnBodies()).toHaveLength(0)
  }, 30000)
})

describe('CG-12/18..21 · routing collisions (#774): each everyday phrasing is named only by its owner', () => {
  it('a name or a widget never pulls in another group by one of its words', () => {
    expect(wordsSelect('data', 'tell me about AAPL')).toBe(true)
    expect(wordsSelect('indicators', 'run my Momentum screen')).toBe(false)
    expect(wordsSelect('indicators', 'add the momentum indicator')).toBe(true)
    expect(wordsSelect('indicators', 'what percent of stocks are above the 50 day')).toBe(false)
    expect(wordsSelect('indicators', 'add a 200 day moving average')).toBe(true)
    expect(wordsSelect('charts', 'open my Swing layout')).toBe(false)
    expect(wordsSelect('charts', 'show swing labels')).toBe(true)
    expect(wordsSelect('data', 'add a news widget')).toBe(false)
    expect(wordsSelect('data', 'NVDA news')).toBe(true)
  })
})

describe('review #771 delta · a clarify carries ONLY its own groups, only into a short answer', () => {
  const clarify = () => ({ ...env('clarify', [], ''), question: { text: 'Which part should look cleaner?', choices: [{ label: 'The left chart' }, { label: 'The whole board' }] } })
  for (const [next, action] of [['add the RSI to my chart', 'indicators'], ['open my Swing layout', 'layouts'], ['draw a line at 150', 'drawings'], ['add a news widget', 'workspace']]) {
    it(`"make it look cleaner" (clarify) → "${next}" is routed FRESH: never "too many parts", its own actions sent`, async () => {
      const { say } = mount(...TWO())
      envelopes.push(clarify)
      await say('make it look cleaner')
      await waitFor(() => expect(screen.queryAllByTestId('agent-question')).toHaveLength(1))
      envelopes.push(env('answer', [], 'ok'))
      await say(next)
      expect(transcript()).not.toMatch(/too many parts of UCT/)
      const body = turnBodies()[1]
      // (an instant-path reading needs no model turn at all — then nothing was carried by construction)
      if (body?.routing) expect(body.routing.selected, next).toContain(action)            // the message's OWN group is sent
    }, 30000)
  }
  it('isShortAnswer: a choice, a short reply with no action of its own — and nothing else', () => {
    expect(isShortAnswer('Chart c3', [{ label: 'Chart c3' }])).toBe(true)
    expect(isShortAnswer('the left one')).toBe(true)
    expect(isShortAnswer('TSLA')).toBe(true)
    expect(isShortAnswer('add the RSI to my chart')).toBe(false)
    expect(isShortAnswer('open my Swing layout')).toBe(false)
    expect(isShortAnswer('anything at all', [], true)).toBe(true)
  })
})

describe('CG-23/24 · corpus gaps (#774)', () => {
  it('CG-23: a chart\'s look ("make the up candles blue and the down candles orange") is never a quote', () => {
    for (const t of ['make the up candles blue and the down candles orange', 'blue up candles, orange down candles', 'Make the up candles blue and the down candles orange.'])
      expect(parsePriceSentence(t), t).toBeNull()
    expect(parsePriceSentence('nvda up today')?.candidates?.map(c => c.text)).toEqual(['nvda'])
  })
  it('CG-24: "are there any volatility indicators" routes the definitions search', () => {
    expect(wordsSelect('definitions', 'are there any volatility indicators')).toBe(true)
    expect(wordsSelect('definitions', 'which momentum indicators do you have')).toBe(true)
  })
})

describe('nl-gaps-2 review notes', () => {
  it('an everyday word is DROPPED as a candidate, never the whole read: "price of nvda and set" still prices NVDA', () => {
    expect(parsePriceSentence('price of nvda and set')?.candidates?.map(c => c.text)).toEqual(['nvda'])
    expect(parsePriceSentence('move the 200 line up to 210')).toBeNull()
  })
  it('CG-24\'s search words never claim a question about the chart\'s OWN indicators, or a removal', () => {
    for (const [m, own] of [['which indicators are on my chart', 'indicators'], ['remove any indicators', 'indicators'], ['what indicators are on this chart', 'indicators']]) {
      expect(wordsSelect('definitions', m), m).toBe(false)
      expect(selectGroups(m).selected, m).toContain(own)
    }
    expect(wordsSelect('definitions', 'are there any volatility indicators')).toBe(true)
    expect(wordsSelect('definitions', 'what indicators do you have')).toBe(true)
    expect(wordsSelect('definitions', 'find me a volatility indicator')).toBe(true)                   // master's search words still search
  })
})

describe('nl-gaps-3 · CG-25..27 (#774): app settings vs the chart', () => {
  it('CG-25: the APP theme routes settings; a CHART theme / candle colours route the chart', () => {
    for (const m of ['use the light theme', 'switch to the dark theme', 'change the app theme', 'use the UCT theme']) {
      expect(wordsSelect('settings', m), m).toBe(true)
      expect(wordsSelect('charts', m), m).toBe(false)
    }
    expect(wordsSelect('charts', 'apply the Sunset chart theme')).toBe(true)
    expect(wordsSelect('charts', 'make the candle colours green and red')).toBe(true)
  })
  it('CG-26: a default for NEW charts routes settings', () => {
    for (const m of ['new charts should open on the weekly', 'open charts on the daily by default', 'always open charts on the 5 minute', 'set my default timeframe to weekly'])
      expect(wordsSelect('settings', m), m).toBe(true)
    expect(wordsSelect('charts', 'restore the chart defaults')).toBe(true)
  })
  it('CG-27: "turn off alert sounds" routes settings', () => {
    expect(wordsSelect('settings', 'turn off alert sounds')).toBe(true)
  })
  it('an everyday word the sentence leaned on is never a ticker without a clear quote frame', () => {
    expect(parsePriceSentence('add a horizontal level at 200')).toBeNull()
    expect(parsePriceSentence('close the Swing tab')).toBeNull()
    expect(parsePriceSentence('price of nvda and set')?.candidates?.map(c => c.text)).toEqual(['nvda'])
  })
})

describe('nl-gaps-4 · CG-28 (#774): the words traders use for a chart\'s indicators', () => {
  it('studies / oscillators / averages / MAs / overlays / lines "on here" route the indicators group', () => {
    for (const m of ['which studies do I have on here', 'what studies are on this chart', 'remove my oscillators', 'hide the averages',
      'which MAs are on here', 'what overlays are on this chart', 'which lines are on here', 'what do I have on here'])
      expect(wordsSelect('indicators', m), m).toBe(true)
  })
  it('the same words never claim an unrelated message', () => {
    expect(wordsSelect('indicators', 'read me the case study on NVDA')).toBe(false)
    expect(wordsSelect('drawings', 'which lines are on here')).toBe(true)                      // drawn levels ride too: the model decides
    expect(wordsSelect('drawings', 'remove my annotations')).toBe(true)
    expect(wordsSelect('indicatorSetup', 'move the RSI into its own pane')).toBe(true)
  })
})

describe('nl-gaps-5 · LT-5 / LT-6: a new request typed while a question is open is a NEW request, never merged', () => {
  const octQ = () => ({ ...env('clarify', [], ''), question: { text: 'Which October low do you mean — Oct 10 or Oct 24?', choices: [{ label: 'Oct 10' }, { label: 'Oct 24' }] } })
  it('LT-6: "trendline on nvda from 2031-01-01 to today" after an unanswered question → the question is withdrawn, the model is told it was set aside', async () => {
    const { say } = mount(...HALF())
    envelopes.push(octQ)
    await say('draw a trendline on nvda from the october lows')
    await waitFor(() => expect(screen.queryAllByTestId('agent-question')).toHaveLength(1))
    envelopes.push(env('answer', [], 'That date is in the future, so I can’t anchor a trendline there.'))
    await say('trendline on nvda from 2031-01-01 to today')
    const body = turnBodies()[1]
    expect(body.context.conversation_memory?.question_set_aside).toBe(true)
    const q = screen.queryAllByTestId('agent-question')[0]
    expect(q.querySelectorAll('button').length).toBe(0)                                      // withdrawn — no live choices
    expect(q.textContent).toMatch(/Withdrawn/)
  }, 30000)
  it('LT-5: a short answer ("the close") still answers the open question — nothing is set aside', async () => {
    const { say } = mount(...HALF())
    envelopes.push(() => ({ ...env('clarify', [], ''), question: { text: 'Anchor the AVWAP at which price — open, close, high or low?', choices: [{ label: 'Open' }, { label: 'Close' }, { label: 'High' }, { label: 'Low' }] } }))
    await say('avwap on nvda from last friday')
    await waitFor(() => expect(screen.queryAllByTestId('agent-question')).toHaveLength(1))
    envelopes.push(env('answer', [], 'ok'))
    await say('the close')
    expect(turnBodies()[1]?.context?.conversation_memory?.question_set_aside).toBeUndefined()   // (the instant path may read it — then no model turn at all)
    expect(screen.queryAllByTestId('agent-question')[0].querySelectorAll('button').length).toBe(4)
  }, 30000)
  it('a LOCAL "which chart?" question is set aside by a new request — the held plan never runs, the new one does', async () => {
    const { board, h, say } = mount([
      { id: 'c1', type: 'chart', x: 0, y: 0, w: 8, h: 20, color: 'A', opts: settings() },
      { id: 'c2', type: 'chart', x: 8, y: 0, w: 8, h: 20, color: 'B', opts: settings() },
    ], { A: 'NVDA', B: 'AMD' })
    await say('make it weekly')
    await waitFor(() => expect(screen.queryAllByTestId('agent-question')).toHaveLength(1))
    await say('add a QQQ chart')
    await waitFor(() => expect(chartsOf(board)).toHaveLength(3), { timeout: 8000 })
    expect(h.charts.read('c1').tf).toBe('D')
    expect(h.charts.read('c2').tf).toBe('D')
    expect(screen.queryAllByTestId('agent-question')[0].querySelectorAll('button').length).toBe(0)
  }, 30000)
})

describe('nl-gaps-5 · routing gaps', () => {
  it('"what\'s on the calendar this week" routes the earnings calendar; "averages for the S&P" routes breadth', () => {
    expect(selectGroups("what's on the calendar this week").selected).toContain('calendar')
    expect(wordsSelect('calendar', 'who reports tomorrow')).toBe(true)
    expect(wordsSelect('breadth', 'averages for the S&P')).toBe(true)
  })
})

describe('nl-gaps-5 · CG-29..36 (#774 21ec4fb410)', () => {
  it('CG-33: Replay Mode is named by its own words', () => {
    for (const m of ['replay NVDA from march 3', 'start a bar replay', 'show me the chart as of oct 1', 'hide what came after the breakout', 'step through the bars', 'exit replay', 'stop replay'])
      expect(wordsSelect('chartSetup', m), m).toBe(true)
  })
  it('CG-29..32: time-anchored drawing phrasings route the drawing tools', () => {
    for (const m of ['connect the two lows with a trend line', 'draw a line from sep 2 to oct 28', 'fib retracement sep 2 100 to oct 28 180', 'write breakout on the chart at 150', 'anchor a vwap to oct 1'])
      expect(wordsSelect('drawingTools', m), m).toBe(true)
  })
  it('CG-35: on /charts the earnings calendar is a screen (calendar.* exist only on the Calendar page)', () => {
    expect(wordsSelect('screener', "what's on the calendar this week")).toBe(true)
    expect(wordsSelect('screener', 'who reports this week')).toBe(true)
    expect(wordsSelect('calendar', "what's on the calendar this week")).toBe(true)          // the Calendar page's own actions, where they exist
  })
  it('CG-36: the MARKET\'s moving averages are breadth\'s, never the chart\'s indicators', () => {
    expect(wordsSelect('breadth', 'how are the moving averages looking for the market')).toBe(true)
    expect(wordsSelect('indicators', 'how are the moving averages looking for the market')).toBe(false)
    expect(wordsSelect('indicators', 'add the 50 day moving average')).toBe(true)
  })
})

describe('review gaps-5 · a reply sets the question aside ONLY when it is a complete request of its own', () => {
  const octQ = { text: 'Which October low do you mean — Oct 10 or Oct 24?', choices: [{ label: 'Oct 10' }, { label: 'Oct 24' }] }
  const chartQ = { text: 'Which chart?', choices: [{ label: 'Left chart (SPY)' }, { label: 'Right chart (TSLA)' }] }
  const maQ = { text: 'Which average — the 20 day or the 50 day?', choices: [{ label: '20 day' }, { label: '50 day' }] }
  it('answers (never set aside): positions, symbols, timeframes, lengths, "instead / go with", a bare word', () => {
    expect(isNewRequest('the one on the left please, thanks a lot', chartQ)).toBe(false)
    expect(isNewRequest('make it the daily one', chartQ)).toBe(false)
    expect(isNewRequest('the left one, the SPY chart, not the TSLA one', chartQ)).toBe(false)
    expect(isNewRequest('go with the 20 day instead of the 50 please', maQ)).toBe(false)
    expect(isNewRequest('close', { text: 'Anchor at which price?', choices: [] })).toBe(false)
    expect(isNewRequest('the close', { text: 'Anchor at which price — open, close, high or low?', choices: [] })).toBe(false)
  })
  it('new requests (set aside): an action with its own object the question never named', () => {
    expect(isNewRequest('trendline nvda 2031-01-01 to today', octQ)).toBe(true)
    expect(isNewRequest('trendline on nvda from 2031-01-01 to today', octQ)).toBe(true)
    expect(isNewRequest('add a QQQ chart', chartQ)).toBe(true)
    expect(isNewRequest('add the RSI to my chart', { text: 'Which part should look cleaner?', choices: [{ label: 'The left chart' }, { label: 'The whole board' }] })).toBe(true)
  })
  it('panel: "make it the daily one" answers the open question — never set aside, the original request carried', async () => {
    const { say } = mount(...TWO())
    envelopes.push(() => ({ ...env('clarify', [], ''), question: { text: 'Which chart should switch?', choices: [{ label: 'Chart c1' }, { label: 'Chart c2' }] } }))
    await say('switch one of my charts over please')
    await waitFor(() => expect(screen.queryAllByTestId('agent-question')).toHaveLength(1))
    envelopes.push(env('answer', [], 'ok'))
    await say('make it the daily one')
    expect(turnBodies()[1]?.context?.conversation_memory?.question_set_aside).toBeUndefined()   // (the instant path may read it — then no model turn at all)
    expect(screen.queryAllByTestId('agent-question')[0].textContent).not.toMatch(/Withdrawn/)
  }, 30000)
  it('the market-averages trigger never takes ONE symbol\'s averages', () => {
    for (const m of ['moving average on the SPY chart', 'what are the moving averages on SPY', 'show the 50 day moving average of SPY'])
      expect(wordsSelect('breadth', m), m).toBe(false)
    expect(wordsSelect('breadth', 'averages for the S&P')).toBe(true)
  })
})

describe('gaps-5 delta nits', () => {
  it('a reply with an action and its OWN new object is a new request even when the QUESTION names the same ticker', () => {
    expect(isNewRequest('draw a trendline on NVDA from 2031-01-01 to today', { text: 'Which NVDA October low do you mean?', choices: [{ label: 'Oct 10' }, { label: 'Oct 24' }] })).toBe(true)
    expect(isNewRequest('set an alert on AMD at 150', { text: 'Which chart should get the RSI alert?', choices: [{ label: 'Chart (NVDA)' }, { label: 'Chart (AMD)' }] })).toBe(true)
    expect(isNewRequest('add the 50 day moving average to AMD', { text: 'Which chart should get the RSI alert?', choices: [{ label: 'Chart (NVDA)' }, { label: 'Chart (AMD)' }] })).toBe(true)
    // a pronoun + a value / date with no ticker, indicator or tool of its own answers a question with no choices
    expect(isNewRequest('set it at 70', { text: 'At what RSI level should the alert fire?', choices: [] })).toBe(false)
    expect(isNewRequest('draw it from 2026-10-10', { text: 'From which date should the trendline start?', choices: [] })).toBe(false)
    // …and naming only what was offered still answers
    expect(isNewRequest('put it on AMD', { text: 'Which chart should get the RSI alert?', choices: [{ label: 'Chart (NVDA)' }, { label: 'Chart (AMD)' }] })).toBe(false)
  })
  it('"as of <date>" is replay only beside replay / chart / bar words — a price or market question keeps its own groups', () => {
    expect(wordsSelect('chartSetup', 'what was NVDA trading at as of oct 3')).toBe(false)
    expect(wordsSelect('chartSetup', 'what does the market look like as of last friday')).toBe(false)
    expect(wordsSelect('chartSetup', 'show me the chart as of oct 1')).toBe(true)
  })
  it('a CHART\'s moving averages keep indicators even on an index chart', () => {
    expect(wordsSelect('indicators', 'what are the moving averages on the nasdaq chart')).toBe(true)
    expect(wordsSelect('indicators', 'hide the moving averages on my SPX chart')).toBe(true)
    expect(wordsSelect('indicators', 'how are the moving averages looking for the market')).toBe(false)
  })
})

// ═══ LIVE TRAIN 4 (production 993ef96a2a) ════════════════════════════════════════════════════════════════
describe('live train 4 · "four charts, all the same size" on a board of SIX charts — asked, never 10 charts', () => {
  const OWNER = 'Put SPY, QQQ, NVDA, and TSLA on four charts, all the same size.'
  const SIX = () => [[0, 1, 2, 3, 4, 5].map(i => ({ id: `c${i}`, type: 'chart', x: (i % 3) * 8, y: Math.floor(i / 3) * 10, w: 8, h: 10, color: 'ABCDEF'[i], opts: { ...settings(), ...(i === 0 ? { tf: 'W' } : {}) } })),
    { A: 'SPY', B: 'QQQ', C: 'NVDA', D: 'TSLA', E: 'NVDA', F: 'QQQ' }]
  it('the deterministic reader asks: replace the 6 charts or add 4 more — nothing changes until the member picks', async () => {
    const { board, say } = mount(...SIX())
    await say(OWNER)
    expect(chartsOf(board)).toHaveLength(6)
    const q = screen.queryAllByTestId('agent-question')
    expect(q).toHaveLength(1)
    expect(q[0].textContent).toMatch(/You have 6 charts here\. Replace them with these 4 \(SPY, QQQ, NVDA, TSLA\), or add 4 more beside them\?/)
    expect(turnBodies()).toHaveLength(0)
  }, 30000)
  it('"Add 4 more charts" → 10 charts (the owner\'s pick, said)', async () => {
    const { board, say } = mount(...SIX())
    await say(OWNER)
    fireEvent.click(screen.getByRole('button', { name: 'Add 4 more charts' }))
    await idle()
    await waitFor(() => expect(chartsOf(board)).toHaveLength(10), { timeout: 8000 })
  }, 30000)
  it('"Replace my 6 charts with these 4" → a CARD (it removes charts); approved → 4 equal charts, the ones already showing a ticker kept on it, other widgets stay', async () => {
    const [ws, groups] = SIX()
    const { board, h, say } = mount([...ws.map(w => ({ ...w, y: w.y ? 8 : 0, h: 8 })), { id: 'wl', type: 'watchlist', x: 0, y: 16, w: 24, h: 4, color: 'A', opts: {} }], groups)
    await say(OWNER)
    fireEvent.click(screen.getByRole('button', { name: 'Replace my 6 charts with these 4' }))
    await idle()
    if (process.env.DUMP) console.log('CLICK>>', transcript().slice(-500))
    await waitFor(() => expect(screen.queryAllByTestId('agent-proposal').length).toBeGreaterThan(0))
    expect(chartsOf(board)).toHaveLength(6)                                                     // nothing removed before approval
    await say('do it')
    await waitFor(() => expect(chartsOf(board)).toHaveLength(4), { timeout: 8000 })
    expect(chartsOf(board).map(w => h.charts.read(w.id).symbol).sort()).toEqual(['NVDA', 'QQQ', 'SPY', 'TSLA'])
    expect(new Set(chartsOf(board).map(w => `${w.w}x${w.h}`)).size).toBe(1)
    expect(board.state.widgets.some(w => w.id === 'wl')).toBe(true)                               // the watchlist stays
    expect(board.state.widgets.some(w => w.id === 'c0')).toBe(true)                               // the SPY chart reused (its ticker kept)
  }, 40000)
  it('"add four charts for …" / "new charts for …" still ADD (no question)', async () => {
    const { board, say } = mount(...SIX())
    await say('add four new charts for SPY, QQQ, NVDA and TSLA, all the same size')
    await waitFor(() => expect(chartsOf(board)).toHaveLength(10), { timeout: 8000 })
    expect(screen.queryAllByTestId('agent-question')).toHaveLength(0)
  }, 30000)
  it('a board with as many charts as tickers (or fewer) is reused, as on train 3 — no question', async () => {
    const { board, h, say } = mount(...HALF())
    await say(OWNER)
    await waitFor(() => expect(chartsOf(board)).toHaveLength(4), { timeout: 8000 })
    expect(chartsOf(board).map(w => h.charts.read(w.id).symbol)).toEqual(['SPY', 'QQQ', 'NVDA', 'TSLA'])
  }, 30000)
})

describe('live train 4 · a workspace conflict at save: the receipt says on screen, NOT saved — never done', () => {
  it('a revision conflict (another window changed the workspace) → "On your screen but NOT saved", the reload note, no Undo', async () => {
    const { board, say } = mount(...HALF(), { epoch: () => 1, persist: async () => ({ ok: false, conflict: true, reason: 'conflict' }) })
    await say('Put SPY, QQQ, NVDA, and TSLA on four charts, all the same size.')
    await waitFor(() => expect(chartsOf(board)).toHaveLength(4), { timeout: 8000 })
    await waitFor(() => expect(summaries()[0]).toMatch(/^On your screen but NOT saved: set up four charts/))
    expect(receipts()[0].textContent).toMatch(/changed in another window or device/)
    expect(receipts()[0].getAttribute('data-undoable')).toBeNull()
  }, 30000)
})

describe('live train 4 · NO receipt claims a change the save did not confirm (owner rule)', () => {
  it('a single change whose save fails: "On your screen but NOT saved", no Undo offered', async () => {
    const { h, say } = mount(...HALF(), { epoch: () => 1, persist: async () => ({ ok: false, reason: 'not-saved' }) })
    await say('weekly')
    await waitFor(() => expect(h.charts.read('c1').tf).toBe('W'))
    await waitFor(() => expect(summaries()[0]).toMatch(/^On your screen but NOT saved: switched timeframe to Weekly/))
    expect(receipts()[0].getAttribute('data-undoable')).toBeNull()
  }, 30000)
  it('an Undo whose save fails: said as on screen, NOT saved — never "undone" as if final', async () => {
    let fail = false
    const { h, say } = mount(...HALF(), { epoch: () => 1, persist: async () => (fail ? { ok: false, reason: 'not-saved' } : { ok: true }) })
    await say('weekly')
    await waitFor(() => expect(h.charts.read('c1').tf).toBe('W'))
    fail = true
    await say('undo')
    await waitFor(() => expect(h.charts.read('c1').tf).toBe('D'))
    await waitFor(() => expect(summaries().slice(-1)[0]).toMatch(/^On your screen but NOT saved: undid/))
  }, 30000)
  it('stale state (the board changed in another window before the write): nothing is written, said plainly', async () => {
    const { h, say } = mount(...HALF(), { epoch: () => 1, boardInSync: async () => ({ ok: false, reason: 'your workspace was changed in another window or device' }) })
    await say('weekly')
    await waitFor(() => expect(transcript()).toMatch(/I didn't change anything: your workspace was changed in another window or device/))
    expect(h.charts.read('c1').tf).toBe('D')
    expect(receipts()).toHaveLength(0)
  }, 30000)
  it('a grouped add + change whose SECOND part is not saved: the first part is said, the second "on your screen but wasn’t saved", never "Done in 2 steps"', async () => {
    let n = 0
    const { say } = mount(...HALF(), { epoch: () => 1, persist: async () => (++n === 2 ? { ok: false, reason: 'conflict' } : { ok: true }) })
    await say('add a QQQ chart and change the SPY chart to weekly')
    await waitFor(() => expect(transcript()).toMatch(/is on your screen but wasn’t saved/), { timeout: 8000 })
    expect(transcript()).not.toMatch(/Done in 2 steps/)
  }, 30000)
})

describe('review t4 · the replace-or-add question on EVERY path (model, NL-1) — reworded requests never make 10 charts', () => {
  const SIX = () => [[0, 1, 2, 3, 4, 5].map(i => ({ id: `c${i}`, type: 'chart', x: (i % 3) * 8, y: Math.floor(i / 3) * 10, w: 8, h: 10, color: 'ABCDEF'[i], opts: settings() })),
    { A: 'SPY', B: 'QQQ', C: 'NVDA', D: 'TSLA', E: 'NVDA', F: 'QQQ' }]
  const boardRef = (b) => (b.context?.board || b.context?.boards || [])[0]?.ref || 'board'
  for (const [said, plan] of [
    ["I'd like SPY, QQQ, NVDA and TSLA on four charts, all the same size, thanks", (b) => [{ action: 'chartGrid.set', target: boardRef(b), args: { symbols: ['SPY', 'QQQ', 'NVDA', 'TSLA'], timeframe: null, layout: 'grid', new_charts: true, watchlist: null, replace: null } }]],
    ['could you put SPY QQQ NVDA TSLA on equal charts for me please', (b) => [
      ...[1, 2, 3, 4].map(n => ({ action: 'widget.add', target: ref(b, 'workspace'), args: { type: 'chart', as: `n${n}` } })),
      ...['SPY', 'QQQ', 'NVDA', 'TSLA'].map((s, i) => ({ action: 'chart.setSymbol', target: `n${i + 1}`, args: { symbol: s } })),
      { action: 'widget.arrange', target: boardRef(b), args: { widgets: null, pattern: 'grid' } }]],
  ]) {
    it(`model path: "${said}" → the question, no charts added`, async () => {
      const { board, say } = mount(...SIX())
      envelopes.push(b => env('apply', plan(b)))
      await say(said)
      expect(turnBodies().length).toBeLessThanOrEqual(1)                                       // the instant reader may take it first
      expect(chartsOf(board)).toHaveLength(6)
      expect(screen.queryAllByTestId('agent-question')[0]?.textContent || '').toMatch(/You have 6 charts here\. Replace them with these 4/)
    }, 30000)
  }
  it('NL-1 path: the same question (the check is not inside the legacy-only branch)', async () => {
    try { localStorage.setItem(NL1_KEY, '1') } catch { /* */ }
    nl1Config = true
    _resetAgentConfig(); await loadAgentConfig()
    try {
      const { board, say } = mount(...SIX())
      envelopes.push(b => ({ ...env('apply', [{ action: 'chartGrid.set', target: Object.values(b.context || {}).flat().find(e => e?.ref && /board/i.test(String(e.label || e.ref)))?.ref || 'board', args: { symbols: ['SPY', 'QQQ', 'NVDA', 'TSLA'], timeframe: null, layout: 'grid', new_charts: true, watchlist: null, replace: null } }]), correction: null }))
      await say("I'd like SPY, QQQ, NVDA and TSLA on four charts, all the same size, thanks")
      expect(chartsOf(board)).toHaveLength(6)
      expect(screen.queryAllByTestId('agent-question')[0]?.textContent || '').toMatch(/You have 6 charts here/)
    } finally { nl1Config = false; try { localStorage.removeItem(NL1_KEY) } catch { /* */ }; _resetAgentConfig() }
  }, 30000)
  it('the replace CARD names each chart to remove by ticker + timeframe and says "will remove"; the receipt says "removed"', async () => {
    const { board, say } = mount(...SIX())
    await say('Put SPY, QQQ, NVDA, and TSLA on four charts, all the same size.')
    fireEvent.click(screen.getByRole('button', { name: 'Replace my 6 charts with these 4' }))
    await idle()
    await waitFor(() => expect(screen.queryAllByTestId('agent-proposal').length).toBeGreaterThan(0))
    const card = screen.queryAllByTestId('agent-proposal')[0].textContent
    expect(card).toMatch(/replacing your charts: will remove the NVDA chart \(Daily\) and the QQQ chart \(Daily\)/)
    expect(card).not.toMatch(/: removed /)
    await say('do it')
    await waitFor(() => expect(chartsOf(board)).toHaveLength(4), { timeout: 8000 })
    expect(transcript()).toMatch(/replacing your charts: removed the NVDA chart \(Daily\) and the QQQ chart \(Daily\)/)
  }, 40000)
})

describe('review t4 M5 · "…charts, each with an RSI" — the per-chart steps survive the replace-or-add question', () => {
  const SIX = () => [[0, 1, 2, 3, 4, 5].map(i => ({ id: `c${i}`, type: 'chart', x: (i % 3) * 8, y: Math.floor(i / 3) * 10, w: 8, h: 10, color: 'ABCDEF'[i], opts: settings() })),
    { A: 'SPY', B: 'QQQ', C: 'NVDA', D: 'TSLA', E: 'NVDA', F: 'QQQ' }]
  const plan = (b) => [
    ...[1, 2, 3, 4].map(n => ({ action: 'widget.add', target: ref(b, 'workspace'), args: { type: 'chart', as: `n${n}` } })),
    ...['SPY', 'QQQ', 'NVDA', 'TSLA'].map((s, i) => ({ action: 'chart.setSymbol', target: `n${i + 1}`, args: { symbol: s } })),
    ...[1, 2, 3, 4].map(n => ({ action: 'indicator.add', target: `n${n}`, args: { defId: 'rsi', inputs: null } })),
  ]
  const rsiOn = (w) => (w.opts?.settings?.indicatorInstances || []).some(i => i.defId === 'rsi' && !i.deleted)
  it('"Add 4 more charts" → 10 charts, the 4 new ones each with its RSI', async () => {
    const { board, h, say } = mount(...SIX())
    envelopes.push(b => env('apply', plan(b)))
    await say('I would like SPY, QQQ, NVDA and TSLA on equal charts, each with an RSI, thanks')
    await waitFor(() => expect(screen.queryAllByTestId('agent-question')).toHaveLength(1))
    fireEvent.click(screen.getByRole('button', { name: 'Add 4 more charts' }))
    await idle()
    await waitFor(() => expect(chartsOf(board)).toHaveLength(10), { timeout: 10000 })
    const fresh = chartsOf(board).filter(w => !/^c\d$/.test(w.id))
    await waitFor(() => expect(fresh.map(w => board.state.widgets.find(x => x.id === w.id)).every(rsiOn)).toBe(true), { timeout: 10000 })
    expect(chartsOf(board).filter(w => /^c\d$/.test(w.id)).some(rsiOn)).toBe(false)               // the existing charts untouched
    expect(fresh.map(w => h.charts.read(w.id).symbol).sort()).toEqual(['NVDA', 'QQQ', 'SPY', 'TSLA'])
  }, 45000)
  it('"Replace my 6 charts with these 4" → the card; approved → 4 charts, each with its RSI', async () => {
    const { board, say } = mount(...SIX())
    envelopes.push(b => env('apply', plan(b)))
    await say('I would like SPY, QQQ, NVDA and TSLA on equal charts, each with an RSI, thanks')
    fireEvent.click(screen.getByRole('button', { name: 'Replace my 6 charts with these 4' }))
    await idle()
    await waitFor(() => expect(screen.queryAllByTestId('agent-proposal').length).toBeGreaterThan(0))
    await say('do it')
    await waitFor(() => expect(chartsOf(board)).toHaveLength(4), { timeout: 10000 })
    await waitFor(() => expect(chartsOf(board).every(rsiOn)).toBe(true), { timeout: 10000 })
  }, 45000)
})

// ═══ CG-37 · binding v2: plan structure + the create step's result reference ═══════════════════════════════════
describe('CG-37 binding v2 · an UNTARGETED change after a create goes on the created chart; explicit targets never moved', () => {
  const ONE = () => [[{ id: 'c1', type: 'chart', x: 0, y: 0, w: 12, h: 20, color: 'A', opts: settings() }], { A: 'NVDA' }]
  const TWO2 = () => [[
    { id: 'c1', type: 'chart', x: 0, y: 0, w: 8, h: 20, color: 'A', opts: settings() },
    { id: 'c2', type: 'chart', x: 8, y: 0, w: 8, h: 20, color: 'B', opts: settings() },
  ], { A: 'NVDA', B: 'AMD' }]
  const raw = (board, id) => JSON.stringify(board.state.widgets.find(w => w.id === id))
  const fresh = (board, olds) => chartsOf(board).find(w => !olds.includes(w.id))
  const smas = (w) => (w?.opts?.settings?.indicatorInstances || []).filter(i => i.defId === 'movingAverage' && Number(i.inputs?.period) === 50 && i.inputs?.maType === 'sma' && !i.deleted).length
  for (const [said, check] of [
    ['open TSLA on a new chart and switch it to the weekly', (h, w) => { expect(h.charts.read(w.id).symbol).toBe('TSLA'); expect(h.charts.read(w.id).tf).toBe('W') }],
    ['add a chart for META and make it a line chart', (h, w) => { expect(h.charts.read(w.id).symbol).toBe('META'); expect(w.opts.settings?.chartType).toBe('line') }],
    ['add a chart for AMD and put the 50 SMA on it', (h, w) => { expect(h.charts.read(w.id).symbol).toBe('AMD'); expect(smas(w)).toBeGreaterThanOrEqual(1) }],
  ]) {
    it(`deterministic: "${said}" → the NEW chart; the existing chart byte-identical`, async () => {
      const { board, h, say } = mount(...ONE())
      const before = raw(board, 'c1')
      await say(said)
      await waitFor(() => expect(chartsOf(board)).toHaveLength(2), { timeout: 8000 })
      await waitFor(() => check(h, fresh(board, ['c1'])), { timeout: 8000 })
      expect(raw(board, 'c1')).toBe(before)
    }, 30000)
  }
  it('H1: a model plan aimed EXPLICITLY at the existing chart is never re-targeted', () => {
    const board = makeBoard(...ONE())
    const ops = [
      { action: 'widget.add', target: 'workspace', args: { type: 'chart', as: 'new1' } },
      { action: 'chart.setSymbol', target: 'new1', args: { symbol: 'TSLA' } },
      { action: 'chart.setTimeframe', target: 'c1', args: { timeframe: 'W' } },
    ]
    expect(bindCreated(ops, 'open TSLA in its own chart and switch it to the weekly', board.host)).toBeNull()
  })
  it('model plan with an UNRESOLVABLE target after the create → bound to the new chart (model path, NL-1 off)', async () => {
    const { board, h, say } = mount(...ONE())
    const before = raw(board, 'c1')
    envelopes.push(b => env('apply', [
      { action: 'widget.add', target: ref(b, 'workspace'), args: { type: 'chart', as: 'new1' } },
      { action: 'chart.setSymbol', target: 'new1', args: { symbol: 'TSLA' } },
      { action: 'chart.setTimeframe', target: 'zz_unknown', args: { timeframe: 'W' } },
    ]))
    await say('could you open up TSLA in its own chart and then flip it over to the weekly view')
    await waitFor(() => expect(chartsOf(board)).toHaveLength(2), { timeout: 8000 })
    await waitFor(() => expect(h.charts.read(fresh(board, ['c1']).id).tf).toBe('W'))
    expect(raw(board, 'c1')).toBe(before)
  }, 30000)
  it('NL-1 on: the same unresolvable-target plan is bound to the new chart', async () => {
    try { localStorage.setItem(NL1_KEY, '1') } catch { /* */ }
    nl1Config = true
    _resetAgentConfig(); await loadAgentConfig()
    try {
      const { board, h, say } = mount(...ONE())
      const before = raw(board, 'c1')
      envelopes.push(b => ({ ...env('apply', [
        { action: 'widget.add', target: (Object.values(b.context || {}).flat().find(e => /workspace/i.test(String(e?.label || e?.ref)))?.ref) || 'workspace', args: { type: 'chart', as: 'new1' } },
        { action: 'chart.setSymbol', target: 'new1', args: { symbol: 'META' } },
        { action: 'chart.setType', target: 'zz_unknown', args: { type: 'line' } },
      ]), correction: null }))
      await say('could you open up META in its own chart and then make it a line chart for me')
      await waitFor(() => expect(chartsOf(board)).toHaveLength(2), { timeout: 8000 })
      expect(raw(board, 'c1')).toBe(before)
      expect(h.charts.read(fresh(board, ['c1']).id).symbol).toBe('META')
    } finally { nl1Config = false; try { localStorage.removeItem(NL1_KEY) } catch { /* */ }; _resetAgentConfig() }
  }, 30000)
  // the reviewer's adversarial cases: untouched charts byte-identical, or asked
  it('"…and set my other chart to daily": the existing chart is named — the new chart is never the target', () => {
    const board = makeBoard(...ONE())
    const ops = [{ action: 'widget.addCharts', args: { symbols: ['TSLA'], timeframe: null, chart_type: null, exact: null } }, { action: 'chart.setTimeframe', args: { timeframe: 'D' } }]
    expect(bindCreated(ops, 'open a chart for TSLA and set my other chart to daily', board.host)).toBeNull()
  })
  it('"open a chart for TSLA that is weekly and switch my main chart to weekly": not re-bound', () => {
    const board = makeBoard(...ONE())
    const ops = [{ action: 'widget.addCharts', args: { symbols: ['TSLA'], timeframe: 'W', chart_type: null, exact: null } }, { action: 'chart.setTimeframe', args: { timeframe: 'W' } }]
    expect(bindCreated(ops, 'open a chart for TSLA that is weekly and switch my main chart to weekly', board.host)).toBeNull()
  })
  it('"make this chart weekly" (no create): never touched by the binder', () => {
    const board = makeBoard(...ONE())
    expect(bindCreated([{ action: 'chart.setTimeframe', args: { timeframe: 'W' } }], 'make this chart weekly', board.host)).toBeNull()
  })
  it('"add another NVDA chart and make the NVDA chart that was already there weekly": the ticker is on both → asked, nothing changes', async () => {
    const { board, say } = mount(...ONE())
    const before = JSON.stringify(board.state.widgets)
    envelopes.push(env('answer', [], 'NO SCRIPTED MODEL TURN'))
    await say('add another NVDA chart and make the NVDA chart that was already there weekly')
    const b = bindCreated([{ action: 'widget.addCharts', args: { symbols: ['NVDA'], timeframe: null, chart_type: null, exact: null } }, { action: 'chart.setTimeframe', args: { timeframe: 'W' } }], 'add another NVDA chart and make the NVDA chart that was already there weekly', makeBoard(...ONE()).host)
    expect(b?.ask || b === null).toBeTruthy()
    expect(b?.ops).toBeUndefined()
    expect(JSON.stringify(board.state.widgets.filter(w => w.id === 'c1'))).toBe(JSON.stringify(JSON.parse(before).filter(w => w.id === 'c1')))
  }, 30000)
  it('M4: "Open TSLA on a new chart and also make it weekly" → asked (the change is set apart from the create)', async () => {
    const { board, say } = mount(...ONE())
    const before = JSON.stringify(board.state.widgets)
    await say('Open TSLA on a new chart and also make it weekly')
    await waitFor(() => expect(transcript()).toMatch(/Should that change go on the new chart, or on a chart you already have/))
    expect(JSON.stringify(board.state.widgets)).toBe(before)
  }, 30000)
  it('two charts on the board, the change untargeted after the create: the new chart; both others byte-identical', async () => {
    const { board, h, say } = mount(...TWO2())
    const b1 = raw(board, 'c1'), b2 = raw(board, 'c2')
    await say('add a chart for META and make it a line chart')
    await waitFor(() => expect(chartsOf(board)).toHaveLength(3), { timeout: 8000 })
    await waitFor(() => expect(fresh(board, ['c1', 'c2']).opts.settings?.chartType).toBe('line'))
    expect(raw(board, 'c1')).toBe(b1)
    expect(raw(board, 'c2')).toBe(b2)
    expect(h.charts.read(fresh(board, ['c1', 'c2']).id).symbol).toBe('META')
  }, 30000)
  it('grouped Undo restores the exact prior state; a failed create stops the rest (never on the existing chart)', async () => {
    const { board, h, say } = mount(...ONE())
    const before = shape(board, h)
    await say('open TSLA on a new chart and switch it to the weekly')
    await waitFor(() => expect(chartsOf(board)).toHaveLength(2), { timeout: 8000 })
    await say('undo')
    await waitFor(() => expect(shape(board, h)).toBe(before), { timeout: 8000 })
    cleanup()
    const r = mount(...ONE(), {}, { failAddAt: 1 })
    const before2 = raw(r.board, 'c1')
    await r.say('open TSLA on a new chart and switch it to the weekly')
    await waitFor(() => expect(transcript()).toMatch(/didn't take effect|didn’t go through/), { timeout: 15000 })
    expect(raw(r.board, 'c1')).toBe(before2)
    expect(chartsOf(r.board)).toHaveLength(1)
  }, 45000)
})

// ═══ NLM1-G1 / G2 (agent/w2/undo-binding-gaps) ═══════════════════════════════════════════════════════════════
describe('NLM1-G1 · the creation\'s Undo after its later changes were undone exactly', () => {
  it('create → add an EMA → change timeframe → undo ×3: every Undo goes through, the board is exactly as before', async () => {
    const { board, h, say } = mount([{ id: 'c1', type: 'chart', x: 0, y: 0, w: 12, h: 20, color: 'A', opts: settings() }], { A: 'NVDA' })
    const before = shape(board, h)
    const raw0 = JSON.stringify(board.state.widgets)
    await say('add a chart for AMD')
    await waitFor(() => expect(chartsOf(board)).toHaveLength(2), { timeout: 8000 })
    const amd = () => chartsOf(board).find(w => w.id !== 'c1')
    const sig = () => JSON.stringify(amd().opts)
    const afterCreate = sig()
    await say('put the 50 EMA on it')
    await waitFor(() => expect(JSON.stringify(amd().opts)).toMatch(/"period":50/))
    await say('make it weekly')
    await waitFor(() => expect(h.charts.read(amd().id).tf).toBe('W'))
    await say('undo')
    await waitFor(() => expect(h.charts.read(amd().id).tf).toBe('D'))
    await say('undo')
    await waitFor(() => expect(JSON.stringify(amd().opts)).not.toMatch(/"period":50,"maType":"ema"/))
    if (process.env.DUMP) console.log('G1>>', afterCreate, '\n   >>', sig())
    await say('undo')
    await waitFor(() => expect(chartsOf(board)).toHaveLength(1), { timeout: 8000 })
    expect(transcript()).not.toMatch(/has changed since I made that change/)
    expect(shape(board, h)).toBe(before)
    expect(JSON.stringify(board.state.widgets)).toBe(raw0)
  }, 40000)
})

describe('NLM1-G1 · a REAL later edit still blocks the creation\'s Undo', () => {
  it('create → the member changes the new chart by hand → "undo" refuses, nothing removed', async () => {
    const { board, h, say } = mount([{ id: 'c1', type: 'chart', x: 0, y: 0, w: 12, h: 20, color: 'A', opts: settings() }], { A: 'NVDA' })
    await say('add a chart for AMD')
    await waitFor(() => expect(chartsOf(board)).toHaveLength(2), { timeout: 8000 })
    const amd = chartsOf(board).find(w => w.id !== 'c1')
    h.charts.commit(amd.id, { tf: 'W' })
    await say('undo')
    await waitFor(() => expect(transcript()).toMatch(/has changed since I made that change/))
    expect(chartsOf(board)).toHaveLength(2)
  }, 30000)
})

// The indicator a G2 turn ADDED to the chart it created: every instance a fresh chart does not start with (the defaults —
// EMA 9/20, SMA 50/200 — are adopted instances too). Read from the board, never a hard-coded id.
function turnInstance(chart) {
  const insts = chart?.opts?.settings?.indicatorInstances || []
  const defIds = new Set((mergeChartSettings(null).indicatorInstances || []).map(i => i.instanceId))
  const added = insts.filter(i => !defIds.has(i.instanceId) && !i.deleted)
  expect(added).toHaveLength(1)
  expect(added[0]).toMatchObject({ defId: 'movingAverage', inputs: { period: 50, maType: 'sma' } })
  const defaults = insts.filter(i => defIds.has(i.instanceId))
  expect(defaults.some(i => i.inputs?.period === 50 && i.inputs?.maType === 'sma')).toBe(true)   // the default SMA 50 is there too
  return { own: added[0], defaults: JSON.parse(JSON.stringify(defaults)) }
}
describe('NLM1-G2 · an indicator added on a chart THIS request created is the next follow-up\'s referent', () => {
  it('"add a chart for AMD and put the 50 SMA on it" → "make it orange" colours THAT SMA (no model turn); undo puts it back', async () => {
    const { board, say } = mount([{ id: 'c1', type: 'chart', x: 0, y: 0, w: 12, h: 20, color: 'A', opts: settings() }], { A: 'NVDA' })
    await say('add a chart for AMD and put the 50 SMA on it')
    const amd = () => chartsOf(board).find(w => w.id !== 'c1')
    const sma = () => (amd()?.opts?.settings?.indicatorInstances || []).find(i => i.defId === 'movingAverage' && Number(i.inputs?.period) === 50 && i.inputs?.maType === 'sma' && !i.deleted)
    await waitFor(() => expect(sma()).toBeTruthy(), { timeout: 8000 })
    const c1Before = JSON.stringify(board.state.widgets.find(w => w.id === 'c1'))
    const amdBefore = JSON.stringify(amd().opts)
    // target identity (owner requirement): the instance THIS turn added — never the new chart's default SMA 50
    const { own, defaults } = turnInstance(amd())
    await say('make it orange')
    await waitFor(() => expect(transcript()).toMatch(/Changed SMA 50's colour on Chart w-chart-1 to orange/), { timeout: 8000 })
    const after = amd().opts.settings.indicatorInstances
    expect(after.filter(i => /#f59e0b/i.test(JSON.stringify(i))).map(i => i.instanceId)).toEqual([own.instanceId])
    for (const d of defaults) expect(JSON.stringify(after.find(i => i.instanceId === d.instanceId))).toBe(JSON.stringify(d))
    expect(turnBodies()).toHaveLength(0)
    expect(JSON.stringify(board.state.widgets.find(w => w.id === 'c1'))).toBe(c1Before)
    await say('undo')
    await waitFor(() => expect(JSON.stringify(amd().opts)).toBe(amdBefore))
  }, 40000)
})

describe('NLM1-G1 · the timeframe equivalence is exactly the product\'s (a chart\'s absent tf IS \'D\'), nothing broader', () => {
  const fp = (widget, cfgTf) => {
    const host = { widgets: { configOf: () => ({ tf: cfgTf, symbol: 'AMD', color: 'N' }) }, charts: { read: () => null } }
    const w = { id: 'n1', x: 0, y: 0, w: 8, h: 10, color: 'N', ...widget }
    return workspaceKind.fingerprintFor(host, { widgets: [w] }, { patch: { beforeIds: [] }, after: { widgets: [w] } })
  }
  it('a chart: absent tf and "D" sign the same; "W" does not', () => {
    const absent = fp({ type: 'chart', optsSig: optsSignature({}), optsSigNoTf: optsSignature({}) }, 'D')
    const d = fp({ type: 'chart', optsSig: optsSignature({ tf: 'D' }), optsSigNoTf: optsSignature({}) }, 'D')
    const w = fp({ type: 'chart', optsSig: optsSignature({ tf: 'W' }), optsSigNoTf: optsSignature({}) }, 'W')
    expect(d).toBe(absent)
    expect(w).not.toBe(absent)
  })
  it('any other widget compares its opts as stored (no equivalence)', () => {
    const a = fp({ type: 'watchlist', optsSig: optsSignature({}), optsSigNoTf: optsSignature({}) }, 'D')
    const b = fp({ type: 'watchlist', optsSig: optsSignature({ tf: 'D' }), optsSigNoTf: optsSignature({}) }, 'D')
    expect(b).not.toBe(a)
  })
})

// ═══ NLM1-G1 / G2 review gaps (agent/w2/undo-binding-gaps, review of 933fc63087..4bf56c0d94) ═══════════════════════
describe('NLM1-G1 · review gaps: the equivalence is the effective timeframe, never anything broader', () => {
  const one = () => [[{ id: 'c1', type: 'chart', x: 0, y: 0, w: 12, h: 20, color: 'A', opts: settings() }], { A: 'NVDA' }]
  it('a chart CREATED weekly → "make it daily" → undo ×2: the board is byte-exact as before', async () => {
    const { board, h, say } = mount(...one())
    const raw0 = JSON.stringify(board.state.widgets)
    await say('add a weekly chart for AMD')
    await waitFor(() => expect(chartsOf(board)).toHaveLength(2), { timeout: 8000 })
    const amd = () => chartsOf(board).find(w => w.id !== 'c1')
    await waitFor(() => expect(h.charts.read(amd().id).tf).toBe('W'))
    await say('make it daily')
    await waitFor(() => expect(h.charts.read(amd().id).tf).toBe('D'))
    await say('undo')
    await waitFor(() => expect(h.charts.read(amd().id).tf).toBe('W'))
    await say('undo')
    await waitFor(() => expect(chartsOf(board)).toHaveLength(1), { timeout: 8000 })
    expect(transcript()).not.toMatch(/has changed since I made that change/)
    expect(JSON.stringify(board.state.widgets)).toBe(raw0)
  }, 40000)
  it('the member switches the new chart D → W → D by hand → "undo" takes back the creation (nothing really changed)', async () => {
    const { board, h, say } = mount(...one())
    const raw0 = JSON.stringify(board.state.widgets)
    await say('add a chart for AMD')
    await waitFor(() => expect(chartsOf(board)).toHaveLength(2), { timeout: 8000 })
    const amd = chartsOf(board).find(w => w.id !== 'c1')
    h.charts.commit(amd.id, { tf: 'W' })
    h.charts.commit(amd.id, { tf: 'D' })
    await say('undo')
    await waitFor(() => expect(chartsOf(board)).toHaveLength(1), { timeout: 8000 })
    expect(transcript()).not.toMatch(/has changed since I made that change/)
    expect(JSON.stringify(board.state.widgets)).toBe(raw0)
  }, 30000)
  it('the new chart differs in a NON-timeframe option (timeframe back on D) → "undo" still refuses, nothing removed', async () => {
    const { board, h, say } = mount(...one())
    await say('add a chart for AMD')
    await waitFor(() => expect(chartsOf(board)).toHaveLength(2), { timeout: 8000 })
    const amd = chartsOf(board).find(w => w.id !== 'c1')
    h.charts.commit(amd.id, { tf: 'D', settings: { ...(amd.opts.settings || {}), nlmG1Marker: 'by-hand' } })
    await say('undo')
    await waitFor(() => expect(transcript()).toMatch(/has changed since I made that change/))
    expect(chartsOf(board)).toHaveLength(2)
  }, 30000)
})

describe('NLM1-G2 · review gaps: only an indicator ON the created chart makes the turn about indicators', () => {
  const amdOf = (board) => chartsOf(board).find(w => w.id !== 'c1')
  const smaOf = (w) => (w?.opts?.settings?.indicatorInstances || []).find(i => i.defId === 'movingAverage' && Number(i.inputs?.period) === 50 && i.inputs?.maType === 'sma' && !i.deleted)
  const g2 = async () => {
    const r = mount([{ id: 'c1', type: 'chart', x: 0, y: 0, w: 12, h: 20, color: 'A', opts: settings() }], { A: 'NVDA' })
    await r.say('add a chart for AMD and put the 50 SMA on it')
    await waitFor(() => expect(smaOf(amdOf(r.board))).toBeTruthy(), { timeout: 8000 })
    return r
  }
  it('NEGATIVE: "add a chart for AMD and put RSI on my SPY chart" → "make it orange" never colours the RSI on SPY (not widened)', async () => {
    const { board, say } = mount([{ id: 'c1', type: 'chart', x: 0, y: 0, w: 12, h: 20, color: 'A', opts: settings() }], { A: 'SPY' })
    envelopes.push(b => env('apply', [
      { action: 'widget.add', target: ref(b, 'workspace'), args: { type: 'chart', as: 'new1' } },
      { action: 'chart.setSymbol', target: 'new1', args: { symbol: 'AMD' } },
      { action: 'indicator.add', target: b.context.indicatorEdits[0].ref, args: { defId: 'rsi', inputs: null } },
    ]))
    await say('add a chart for AMD and put RSI on my SPY chart')
    const rsi = () => (board.state.widgets.find(w => w.id === 'c1').opts?.settings?.indicatorInstances || []).find(i => i.defId === 'rsi' && !i.deleted)
    await waitFor(() => expect(chartsOf(board)).toHaveLength(2), { timeout: 8000 })
    await waitFor(() => expect(rsi()).toBeTruthy(), { timeout: 8000 })
    const c1Before = JSON.stringify(board.state.widgets.find(w => w.id === 'c1'))
    await say('make it orange')
    expect(JSON.stringify(board.state.widgets.find(w => w.id === 'c1'))).toBe(c1Before)
    expect(JSON.stringify(board.state.widgets)).not.toMatch(/#f59e0b/i)
  }, 40000)
  it('"make it weekly" after a G2 turn → the created chart goes weekly', async () => {
    const { board, h, say } = await g2()
    await say('make it weekly')
    await waitFor(() => expect(h.charts.read(amdOf(board).id).tf).toBe('W'), { timeout: 8000 })
    expect(h.charts.read('c1').tf).toBe('D')
  }, 40000)
  it('"remove it" after a G2 turn → proposes removing the SMA (needs approval); nothing changes before approval', async () => {
    const { board, say } = await g2()
    const raw = JSON.stringify(board.state.widgets)
    const { own, defaults } = turnInstance(amdOf(board))
    await say('remove it')
    await waitFor(() => expect(screen.queryAllByTestId('agent-proposal').length).toBeGreaterThan(0), { timeout: 8000 })
    expect(screen.queryAllByTestId('agent-proposal').map(n => n.textContent).join(' ')).toMatch(/SMA 50/)
    expect(JSON.stringify(board.state.widgets)).toBe(raw)
    expect(chartsOf(board)).toHaveLength(2)
    await say('do it')
    await waitFor(() => expect(transcript()).toMatch(/Removed SMA 50 on Chart w-chart-1/), { timeout: 8000 })
    const after = amdOf(board).opts.settings.indicatorInstances
    expect(after.filter(i => i.instanceId === own.instanceId && !i.deleted)).toHaveLength(0)        // the turn's own SMA is gone
    for (const d of defaults) expect(JSON.stringify(after.find(i => i.instanceId === d.instanceId))).toBe(JSON.stringify(d))   // ovl:2 untouched
    expect(chartsOf(board)).toHaveLength(2)
  }, 40000)
})
