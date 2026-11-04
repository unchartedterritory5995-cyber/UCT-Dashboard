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
import { touchesCharts, arrangesBoard, asSubjectWords, isShortAnswer } from './useAgent'
import { AuthContext } from '../context/AuthContext'
import { selectGroups, routeManifest, wordsSelect } from './routing'
import { fastParse } from './fastPath'
import { multiChartPlan } from './multiChart'
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
  it('A2: a board-only change (the grid, adding a chart) is acknowledged on the BOARD\'s own save — it never waits on other preference writes (the new charts\' chart_settings as they load); a chart-settings change still does', async () => {
    const asked = []
    const { board, h, say } = mount(...HALF(), { epoch: () => 1, persist: async (opts) => { asked.push(opts ?? 'default'); return { ok: true } } })
    await say(GRID)
    await waitFor(() => expect(chartsOf(board)).toHaveLength(4), { timeout: 8000 })
    await waitFor(() => expect(receipts()).toHaveLength(1))
    expect(asked).toEqual([{ settle: [] }])
    await say('add a chart for AMD')
    await waitFor(() => expect(receipts()).toHaveLength(2), { timeout: 8000 })
    expect(asked[1]).toEqual({ settle: [] })
    await say('make the AMD chart weekly')
    await waitFor(() => expect(receipts()).toHaveLength(3), { timeout: 8000 })
    expect(asked[2]).toBe('default')
    expect(h.charts.read(chartsOf(board).find(w => h.charts.read(w.id).symbol === 'AMD').id).tf).toBe('W')
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
    for (const [m, own] of [['which indicators are on my chart', 'indicators'], ['remove any indicators', 'indicators']]) {
      expect(wordsSelect('definitions', m), m).toBe(false)
      expect(selectGroups(m).selected, m).toContain(own)
    }
    expect(wordsSelect('definitions', 'are there any volatility indicators')).toBe(true)
    expect(wordsSelect('definitions', 'what indicators do you have')).toBe(true)
  })
})
