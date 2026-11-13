// ⛔ CHART RAIL + PENDING TASK lifecycle (hotfix 2026-11-13) — through the REAL panel (AgentPanel + useAgent + registry,
// planner, runtime, receipts and Undo) on the REAL board writer (fixture board). Stand-in: the Agent model (/api/agent/turn),
// scripted. No paid model call. Board: SPY (left), NVDA (right), as in production.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { makeBoard } from './__fixtures__/board'
import { mergeChartSettings } from '../components/chart/chartDefaults'
import { AuthContext } from '../context/AuthContext'
import { QUESTION_TTL_MS, replyRelation } from './pendingTask'
import { isNewRequest } from './useAgent'
import { keptCharts, isAdditive, requestedPanels } from './chartRail'

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
const records = () => calls.filter(c => c[1] === '/api/agent/record').map(c => c[2])
const transcript = () => screen.getByTestId('agent-transcript').textContent
const idle = () => waitFor(() => expect(screen.queryByTestId('agent-typing')).toBeNull(), { timeout: 10000 })

function mount(widgets, groupSyms, opts) {
  const board = makeBoard(widgets, groupSyms, opts)
  const base = board.host.charts
  const h = {
    ...board.host,
    charts: { ...base, canManageIndicators: () => true, canCreateIndicator: () => true, previewHost: () => null, selected: () => null },
    persist: async () => ({ ok: true }),
  }
  render(<AuthContext.Provider value={{ user: { id: 1, role: 'admin' } }}><AgentPanel host={h} onClose={() => {}} /></AuthContext.Provider>)
  const box = screen.getByLabelText('Message UCT Agent')
  const say = async (t) => { await idle(); fireEvent.change(box, { target: { value: t } }); fireEvent.keyDown(box, { key: 'Enter' }); await idle() }
  const click = async (label) => { await idle(); fireEvent.click(screen.getAllByRole('button', { name: label }).at(-1)); await idle() }
  return { board, h, say, click }
}
const chartsOf = (board) => board.state.widgets.filter(w => w.type === 'chart').sort((a, b) => (a.y - b.y) || (a.x - b.x))
const settings = () => ({ settings: mergeChartSettings(null) })
const syms = (board, h) => chartsOf(board).map(w => h.charts.read(w.id).symbol)
const raw = (board) => JSON.stringify({ w: board.state.widgets, g: board.state.groupSyms })
const SPY_NVDA = () => [['c1', 'c2'].map((id, i) => ({ id, type: 'chart', x: i * 12, y: 0, w: 12, h: 20, color: 'N', opts: settings() })), { 'N:c1': 'SPY', 'N:c2': 'NVDA' }]

const ASK = 'Change my chart layout to a 2-by-2 grid, keeping SPY and NVDA in the layout.'
const QUESTION = 'Which two tickers should I add to fill the other two charts of the 2×2 grid?'
const REPLY = 'Add AAPL and MSFT as the other two charts'
const clarify = (text = QUESTION) => env('clarify', [], text, { text, choices: [] })
const grid = (symbols, extra = {}) => env('apply', [{ action: 'chartGrid.set', target: 'board', args: { symbols, timeframe: null, layout: 'grid', new_charts: null, watchlist: null, replace: null, ...extra } }])
const setSym = (target, symbol) => env('apply', [{ action: 'chart.setSymbol', target, args: { symbol } }])

describe('CHART RAIL · the model plans the destructive reading — refused, nothing written', () => {
  it('KEPT: the continued task planned as chartGrid.set [AAPL, MSFT] (re-symbolling SPY and NVDA) is refused, the board byte-identical', async () => {
    const { board, h, say } = mount(...SPY_NVDA())
    envelopes.push(clarify())
    await say(ASK)
    const before = raw(board)
    envelopes.push(grid(['AAPL', 'MSFT']))
    await say(REPLY)
    expect(turnBodies()).toHaveLength(2)
    expect(raw(board)).toBe(before)
    expect(syms(board, h)).toEqual(['SPY', 'NVDA'])
    expect(transcript()).toMatch(/I can’t change a chart you asked to keep — you asked to keep SPY and NVDA/)
    expect(transcript()).not.toMatch(/Set up two charts/)
    expect(records().some(r => r?.outcomeData?.reason === 'chart-rail')).toBe(true)
  }, 30000)
  it('KEPT: chart.setSymbol on a kept chart (model, same turn words) is refused', async () => {
    const { board, h, say } = mount(...SPY_NVDA())
    envelopes.push(setSym('c1', 'AAPL'))
    await say('keep SPY on screen and show me Apple somewhere')
    expect(syms(board, h)).toEqual(['SPY', 'NVDA'])
    expect(transcript()).toMatch(/asked to keep SPY/)
  }, 30000)
  it('COUNT: a 2×2 asked for, a plan that leaves 2 charts — never reported as success', async () => {
    const { board, h, say } = mount(...SPY_NVDA())
    envelopes.push(grid(['QQQ', 'IWM']))
    await say('make my charts a 2x2 grid')
    expect(syms(board, h)).toEqual(['SPY', 'NVDA'])
    expect(transcript()).toMatch(/you asked for a 4-chart grid, but this would leave 2 charts/)
    expect(transcript()).not.toMatch(/Set up/)
  }, 30000)
  it('REMOVAL: a chart removed at once with no word asking for it is refused (the panel count never drops silently)', async () => {
    const { board, say } = mount(...SPY_NVDA())
    envelopes.push(env('apply', [{ action: 'widget.remove', target: 'board', args: { widget: 'c2' } }]))
    await say('give my layout some breathing room')
    expect(chartsOf(board)).toHaveLength(2)
    expect(transcript()).toMatch(/would have removed the NVDA chart, and you didn’t ask to remove a chart/)
  }, 30000)
  it('ADDITIVE: "I want AMD as well, show it on the NVDA chart" planned as a re-symbol of the NVDA chart is refused', async () => {
    const { board, h, say } = mount(...SPY_NVDA())
    envelopes.push(setSym('c2', 'AMD'))
    await say('I want AMD as well, show it on the NVDA chart')
    expect(syms(board, h)).toEqual(['SPY', 'NVDA'])
    expect(transcript()).toMatch(/you asked for more charts, but this would have changed the ones you have/)
  }, 30000)
})

describe('CHART RAIL · explicit requests still run, and their Undo is exact', () => {
  it('chart.setSymbol: "replace SPY with AAPL" runs; Undo restores the board byte for byte', async () => {
    const { board, h, say } = mount(...SPY_NVDA())
    const before = raw(board)
    envelopes.push(setSym('c1', 'AAPL'))
    await say('replace the SPY chart with AAPL')
    expect(syms(board, h)).toEqual(['AAPL', 'NVDA'])
    await say('undo')
    expect(raw(board)).toBe(before)
  }, 30000)
  it('chartGrid.set: the continued 2×2 (SPY, NVDA kept; AAPL, MSFT added) runs; Undo restores the board byte for byte', async () => {
    const { board, h, say } = mount(...SPY_NVDA())
    const before = raw(board)
    envelopes.push(clarify())
    await say(ASK)
    envelopes.push(grid(['SPY', 'NVDA', 'AAPL', 'MSFT']))
    await say(REPLY)
    expect(syms(board, h)).toEqual(['SPY', 'NVDA', 'AAPL', 'MSFT'])
    await say('undo')
    // the board's widgets byte for byte, and every remaining chart's symbol (the fixture keeps the dead link keys of the two
    // charts the Undo closed — N:w-chart-1 / N:w-chart-2 — which no widget reads)
    expect(JSON.stringify(board.state.widgets)).toBe(JSON.stringify(JSON.parse(before).w))
    expect(syms(board, h)).toEqual(['SPY', 'NVDA'])
  }, 30000)
  it('widget.remove: "remove the NVDA chart" runs; Undo restores the board byte for byte', async () => {
    const { board, say } = mount(...SPY_NVDA())
    const before = raw(board)
    envelopes.push(env('apply', [{ action: 'widget.remove', target: 'board', args: { widget: 'c2' } }]))
    await say('remove the NVDA chart')
    expect(chartsOf(board)).toHaveLength(1)
    await say('undo')
    expect(raw(board)).toBe(before)
  }, 30000)
})

describe('PENDING TASK lifecycle · answer, ask again, Cancel, TTL', () => {
  it('UNCLEAR → asked again (nothing runs, no model call); "Yes" continues the pending task with the held reply', async () => {
    const { board, h, say, click } = mount(...SPY_NVDA())
    envelopes.push(clarify('Should the two new charts be daily or weekly?'))
    await say(ASK)
    await say('Add AAPL and MSFT')
    expect(turnBodies()).toHaveLength(1)
    expect(syms(board, h)).toEqual(['SPY', 'NVDA'])
    expect(transcript()).toMatch(/Is that your answer to my question about “Change my chart layout to a 2-by-2 grid/)
    envelopes.push(grid(['SPY', 'NVDA', 'AAPL', 'MSFT']))
    await click('Yes — use it to finish that request')
    expect(turnBodies()).toHaveLength(2)
    expect(turnBodies()[1].message).toBe('Add AAPL and MSFT')
    expect(syms(board, h)).toEqual(['SPY', 'NVDA', 'AAPL', 'MSFT'])
  }, 30000)
  it('UNCLEAR → "no" typed: a NEW request (the old question withdrawn) — and the kept charts still never change', async () => {
    const { board, h, say } = mount(...SPY_NVDA())
    envelopes.push(clarify('Should the two new charts be daily or weekly?'))
    await say(ASK)
    await say('Add AAPL and MSFT')
    await say('no')
    expect(transcript()).toMatch(/Withdrawn/)
    expect(syms(board, h).slice(0, 2)).toEqual(['SPY', 'NVDA'])
  }, 30000)
  it('Cancel clears it: the reply after "cancel" is read on its own — and the rail refuses re-symbolling for an additive request', async () => {
    const { board, h, say } = mount(...SPY_NVDA())
    envelopes.push(clarify())
    await say(ASK)
    await say('cancel')
    await say(REPLY)
    expect(syms(board, h).slice(0, 2)).toEqual(['SPY', 'NVDA'])
    expect(transcript()).not.toMatch(/Set up two charts for AAPL and MSFT/)
  }, 30000)
  it('TTL: a question older than QUESTION_TTL_MS is withdrawn; the reply is read alone — never re-symbols SPY / NVDA', async () => {
    const { board, h, say } = mount(...SPY_NVDA())
    envelopes.push(clarify())
    await say(ASK)
    const t0 = Date.now()
    vi.spyOn(Date, 'now').mockImplementation(() => t0 + QUESTION_TTL_MS + 1000)
    await say(REPLY)
    expect(transcript()).toMatch(/Withdrawn/)
    expect(syms(board, h).slice(0, 2)).toEqual(['SPY', 'NVDA'])
    expect(transcript()).not.toMatch(/Set up two charts for AAPL and MSFT/)
  }, 30000)
})

describe('units · replyRelation / keptCharts / isAdditive / requestedPanels', () => {
  const host = makeBoard(...SPY_NVDA()).host
  it('replyRelation', () => {
    const q = { text: QUESTION, choices: [] }
    expect(replyRelation(REPLY, q, ASK, isNewRequest)).toBe('answer')
    expect(replyRelation('AAPL and MSFT', q, ASK, isNewRequest)).toBe('answer')
    // each rule on its own: the back-reference alone (a question that asked no tickers), the tickers slot alone (no cue)
    expect(replyRelation(REPLY, { text: 'Daily or weekly?', choices: [] }, ASK, isNewRequest)).toBe('answer')
    expect(replyRelation('Add AAPL and MSFT', q, ASK, isNewRequest)).toBe('answer')
    expect(replyRelation('Add AAPL and MSFT', { text: 'Daily or weekly?', choices: [] }, ASK, isNewRequest)).toBe('unclear')
    // LT-6 unchanged: a new request of its own on a task that is not about the board's charts
    expect(replyRelation('trendline on nvda from 2031-01-01 to today', { text: 'Which October low do you mean — Oct 10 or Oct 24?', choices: [{ label: 'Oct 10' }, { label: 'Oct 24' }] }, 'draw a trendline on nvda from the october lows', isNewRequest)).toBe('new')
    // a LOCAL question (no model words): the old rule
    expect(replyRelation('add a QQQ chart', { text: 'Which chart?', choices: [] }, null, isNewRequest)).toBe('new')
  })
  it('keptCharts', () => {
    expect([...keptCharts(ASK, host).symbols].sort()).toEqual(['NVDA', 'SPY'])
    expect([...keptCharts('leave the left one alone and put AMD on the right', host).refs]).toEqual(['c1'])
    expect(keptCharts("don't touch my charts", host).all).toBe(true)
    expect(keptCharts('make the left chart weekly', host).symbols.size).toBe(0)
  })
  it('isAdditive / requestedPanels', () => {
    expect(isAdditive(REPLY)).toBe(true)
    expect(isAdditive('add a 2x2 of SPY QQQ IWM DIA')).toBe(false)          // GRID-REUSE (owner ruling): a count of tickers is THE grid
    expect(isAdditive('replace the others with two more charts')).toBe(false)
    expect(requestedPanels(ASK)).toBe(4)
    expect(requestedPanels('3x3 please')).toBe(9)
    expect(requestedPanels('show NVDA and AMD side by side')).toBe(null)
  })
})
