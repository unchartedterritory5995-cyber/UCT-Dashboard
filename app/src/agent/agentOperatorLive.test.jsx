// LIVE TEST 2026-10-28 — "make Agent an operator, not an approval assistant". The owner's failed live requests,
// through the REAL panel (AgentPanel + useAgent + registry, planner, policy, runtime, receipts and Undo), the
// REAL board writer (fixture board: the product's placement and applyBoard), and for the custom indicator the REAL
// Indicators authoring interface (engine, draft store, canonical Save) and the REAL chart add. Stand-ins: the Agent
// model (/api/agent/turn), the builder's model (/converse) and the definitions server. No paid model call.
//   L1  "Create four charts for SPY, QQQ, NVDA and TSLA and make them all daily charts." — one chart fills the board
//   L2  ordinary reversible changes run without Apply / Dismiss (one target, several targets, several steps)
//   L3  destructive / permanent changes are still proposed — and the approval policy is a deliberate, railed list
//   L4  "Create a custom indicator that shows the difference between the 9 EMA and 20 EMA as a percentage and put
//       it in a separate pane." — built, saved, on the chart, in its own pane, one short sentence, Undo
//   L5  a builder failure says WHAT failed, in plain words
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerBuiltins } from './builtins'
import { allCapabilityNames, getCapability } from './capabilities'
import { setAuthoringSources, _resetAuthoring, refusalSentence } from './capabilities/indicatorAuthoring'
import { _resetProposedPlans } from './capabilities/indicatorEdits'
import { receiptView } from './receiptView'
import { makeBoard } from './__fixtures__/board'
import { mergeChartSettings } from '../components/chart/chartDefaults'
import { boardProblems } from '../pages/charts/placement/arrange'
import { storeConversation } from '../components/chart/builder/conversationSave'
import { _simulateReload, STORAGE_KEY } from '../components/chart/builder/authoring/conversationSessions'
import { _resetDraftPreview, AUTHORING_REASONS as AR } from '../components/chart/builder/agentAuthoring'
import { CREATE_INDICATOR_FLAG_KEY } from '../components/chart/builder/studio/createIndicatorFlag'
import { AuthContext } from '../context/AuthContext'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
import AgentPanel from './AgentPanel'

registerBuiltins()
const HERE = path.dirname(fileURLToPath(import.meta.url))

// ── the builder's model (/converse): the owner's EMA % request → the formula it should produce ──
const PATCH = 'uct.authoring.patch/1'
const close = { type: 'series', name: 'close' }
const call = (name, ...args) => ({ type: 'call', name, args })
const num = (value) => ({ type: 'num', value })
const op = (name, ...args) => ({ type: 'op', name, args })
const E9 = call('ema', close, num(9)), E20 = call('ema', close, num(20))
const PCT = op('*', op('/', op('-', E9, E20), E20), num(100))          // (EMA(9) − EMA(20)) / EMA(20) × 100
let builder
function converse({ message, state }) {
  builder.calls.push(message)
  if (builder.mode === 'malformed') return { ok: false, gate: 'envelope:schema', reason: 'the assistant\'s change did not follow the change format, so nothing was offered to apply' }
  if (builder.mode === 'lower-tf') return { ok: false, gate: 'unsupported:node', reason: 'it reads a lower timeframe; conversational authoring draws on the chart\'s own bars or a higher timeframe only' }
  return { ok: true, disposition: 'change', turn: 'patch', reply: '', envelope: { contract: PATCH, baseRevision: state.revision, assumptions: [], disposition: 'change',
    ops: [{ op: 'create', name: 'EMA 9/20 % Diff', placement: 'pane', outputs: [{ key: 'diff', label: 'EMA 9/20 % Diff', tree: PCT }] }] } }
}
// ── the definitions server ──
let server
const fakeSave = async (doc, defId, _x, opts) => {
  const id = defId || `u_aaaaaaaaae${String(server.size + 10).padStart(2, '0')}`
  const version = defId ? (opts?.baseVersion || 0) + 1 : 1
  server.set(id, { def_id: id, version, rev: 1, definition: { ...doc, id, version } })
  return { ok: true, row: { def_id: id, version, rev: 1 } }
}
// ── the Agent model, scripted per test ──
let envelopes, calls
const env = (disposition, ops, reply = '') => ({ disposition, reply, question: null, ops, unsupported_category: null })
beforeEach(() => {
  server = new Map(); envelopes = []; calls = []; builder = { mode: 'ok', calls: [] }
  _simulateReload()
  try { sessionStorage.removeItem(STORAGE_KEY) } catch { /* */ }
  try { localStorage.clear() } catch { /* */ }
  localStorage.setItem(CREATE_INDICATOR_FLAG_KEY, '1')
  _resetAuthoring(); _resetDraftPreview(); _resetProposedPlans()
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null
    calls.push([init.method || 'GET', String(url), body])
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
    if (url === '/api/agent/turn') { const e = envelopes.shift(); return json({ conversationId: 'ac_1', envelope: typeof e === 'function' ? e(body) : e, usage: { research_calls: 0, citations: [] } }) }
    if (url === '/api/agent/record') return json({ conversationId: 'ac_1' })
    if (String(url).startsWith('/api/user-definitions')) return json({ definitions: [...server.values()] })
    const q = /ticker-search\?q=([^&]+)/.exec(String(url))
    if (q) return json({ results: [{ ticker: decodeURIComponent(q[1]).toUpperCase() }] })
    if (String(url).startsWith('/api/live-prices')) return json({})
    return json({ conversations: [] })
  })
})
afterEach(() => { vi.restoreAllMocks(); cleanup() })

const turns = () => calls.filter(c => c[1] === '/api/agent/turn').length
const transcript = () => screen.getByTestId('agent-transcript').textContent
const proposals = () => screen.queryAllByTestId('agent-proposal')
const receipts = () => screen.queryAllByTestId('agent-receipt')
const idle = () => waitFor(() => expect(screen.queryByTestId('agent-typing')).toBeNull(), { timeout: 10000 })

function mount(widgets, groupSyms, { decorate = null } = {}) {
  const board = makeBoard(widgets, groupSyms)
  const base = board.host.charts
  const d = decorate || ((s) => s)
  const h = {
    ...board.host,
    charts: { ...base, list: () => base.list().map(d), read: (ref) => d(base.read(ref)), canManageIndicators: () => true, canCreateIndicator: () => true, previewHost: () => null, selected: () => null },
    persist: async () => ({ ok: true }),
  }
  render(<AuthContext.Provider value={{ user: { id: 1, role: 'admin' } }}><AgentPanel host={h} onClose={() => {}} /></AuthContext.Provider>)
  setAuthoringSources({ extra: { converse, readBack: async (id) => server.get(id) || null, store: (s, o) => storeConversation(s, { ...o, save: fakeSave }) } })
  const box = screen.getByLabelText('Message UCT Agent')
  const say = async (t) => { await idle(); fireEvent.change(box, { target: { value: t } }); fireEvent.keyDown(box, { key: 'Enter' }) }
  return { board, h, say }
}
const chartsOf = (board) => board.state.widgets.filter(w => w.type === 'chart').sort((a, b) => (a.y - b.y) || (a.x - b.x))
const cellsOf = (board) => chartsOf(board).map(w => [w.x, w.y, w.w, w.h])
const ONE_FULL = () => [[{ id: 'c1', type: 'chart', x: 0, y: 0, w: 24, h: 20, color: 'A', opts: { settings: mergeChartSettings(null) } }], { A: 'AAPL' }]
const LIVE = 'Create four charts for SPY, QQQ, NVDA and TSLA and make them all daily charts.'

// ═══ L1 ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('L1 · four charts on a board one chart fills', () => {
  it('the owner\'s exact words: the chart is reused, three are added, an equal 2×2 grid, all daily — no card, no model call, one short receipt; ONE Undo restores the board', async () => {
    const { board, h, say } = mount(...ONE_FULL())
    const before = JSON.stringify(board.state.widgets)
    await say(LIVE)
    await waitFor(() => expect(chartsOf(board)).toHaveLength(4), { timeout: 8000 })
    expect(cellsOf(board)).toEqual([[0, 0, 12, 10], [12, 0, 12, 10], [0, 10, 12, 10], [12, 10, 12, 10]])     // equal 2×2
    expect(chartsOf(board).map(w => h.charts.read(w.id).symbol)).toEqual(['SPY', 'QQQ', 'NVDA', 'TSLA'])
    expect(chartsOf(board).map(w => h.charts.read(w.id).tf)).toEqual(['D', 'D', 'D', 'D'])
    expect(boardProblems(board.state.widgets, 24, 20)).toEqual([])
    expect(proposals()).toHaveLength(0)                                       // no Apply / Dismiss
    expect(turns()).toBe(0)                                                    // read on the instant path
    await waitFor(() => expect(receipts()).toHaveLength(1))
    const said = screen.getByTestId('agent-receipt-summary').textContent
    expect(said).toBe('Set up four daily charts for SPY, QQQ, NVDA and TSLA in a 2×2 grid (1 reused, 3 new)')
    expect(transcript()).not.toMatch(/isn't enough open space|Close or shrink|rearranging your current workspace/)
    expect((transcript().match(/Create four charts for SPY/g) || []).length).toBe(1)          // the member's line only — never read back
    await say('undo')
    await waitFor(() => expect(chartsOf(board)).toHaveLength(1), { timeout: 8000 })
    expect(JSON.stringify(board.state.widgets)).toBe(before)                  // the prior layout, exactly
    expect(h.charts.read('c1').symbol).toBe('AAPL')
  }, 30000)

  it('the same request planned by the MODEL (adds + tickers that cannot fit) becomes the one grid change — never "not enough open space"', async () => {
    const { board, h, say } = mount(...ONE_FULL())
    const ws = (b) => b.context.workspace[0].ref
    envelopes.push(b => env('apply', [{ action: 'widget.addCharts', target: ws(b), args: { symbols: ['SPY', 'QQQ', 'NVDA', 'TSLA'], timeframe: 'D', chart_type: null, exact: null } }]))
    await say('Set me up with SPY, QQQ, NVDA and TSLA as four daily charts, thanks!')
    await waitFor(() => expect(chartsOf(board)).toHaveLength(4), { timeout: 8000 })
    expect(turns()).toBe(1)
    expect(cellsOf(board)).toEqual([[0, 0, 12, 10], [12, 0, 12, 10], [0, 10, 12, 10], [12, 10, 12, 10]])
    expect(chartsOf(board).map(w => h.charts.read(w.id).symbol)).toEqual(['SPY', 'QQQ', 'NVDA', 'TSLA'])
    expect(proposals()).toHaveLength(0)
  }, 30000)

  it('other widgets are never moved or removed; when the charts cannot be re-tiled without moving them, ONE plain sentence and nothing changes', async () => {
    const widgets = [
      { id: 'c1', type: 'chart', x: 0, y: 0, w: 18, h: 20, color: 'N', opts: {} },
      { id: 'wl', type: 'watchlist', x: 18, y: 0, w: 6, h: 20, color: 'A', opts: {} },
    ]
    const { board, say } = mount(widgets, { 'N:c1': 'AAPL' })
    await say(LIVE)
    await waitFor(() => expect(chartsOf(board)).toHaveLength(4), { timeout: 8000 })
    expect(board.state.widgets.find(w => w.id === 'wl')).toMatchObject({ x: 18, y: 0, w: 6, h: 20 })
    cleanup()
    const split = mount([
      { id: 'a', type: 'chart', x: 0, y: 0, w: 8, h: 20, color: 'N', opts: {} }, { id: 'wl', type: 'watchlist', x: 8, y: 0, w: 8, h: 20, color: 'A', opts: {} },
      { id: 'b', type: 'chart', x: 16, y: 0, w: 8, h: 20, color: 'N', opts: {} },
    ], { 'N:a': 'AAPL', 'N:b': 'MSFT' })
    const before = JSON.stringify(split.board.state.widgets)
    await split.say(LIVE)
    await waitFor(() => expect(transcript()).toMatch(/separated by other widgets, so they can’t be re-tiled into one even grid without moving those widgets/), { timeout: 8000 })
    expect(JSON.stringify(split.board.state.widgets)).toBe(before)
    expect(proposals()).toHaveLength(0)
  }, 30000)
})

// ═══ L2 ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('L2 · ordinary reversible changes run without Apply / Dismiss', () => {
  const TWO = () => [[
    { id: 'L', type: 'chart', x: 0, y: 0, w: 12, h: 20, color: 'N', opts: { settings: mergeChartSettings(null) } },
    { id: 'R', type: 'chart', x: 12, y: 0, w: 12, h: 20, color: 'N', opts: { settings: mergeChartSettings(null) } },
  ], { 'N:L': 'NVDA', 'N:R': 'AMD' }]
  it('a model plan of several explicit steps on several charts (symbols, timeframes, an indicator) applies at once — receipts, no card', async () => {
    const { board, h, say } = mount(...TWO())
    const ref = (b, pos, kind = 'charts') => b.context[kind].find(c => c.position === pos).ref
    envelopes.push(b => env('apply', [
      { action: 'chart.setSymbol', target: ref(b, 'left'), args: { symbol: 'SPY' } },
      { action: 'chart.setSymbol', target: ref(b, 'right'), args: { symbol: 'QQQ' } },
      { action: 'chart.setTimeframe', target: ref(b, 'left'), args: { timeframe: 'W' } },
      { action: 'chart.setTimeframe', target: ref(b, 'right'), args: { timeframe: 'W' } },
    ]))
    await say('Put SPY on the left chart and QQQ on the right chart, and make both of them weekly, thank you.')
    await waitFor(() => expect([h.charts.read('L').tf, h.charts.read('R').tf]).toEqual(['W', 'W']), { timeout: 8000 })
    expect([h.charts.read('L').symbol, h.charts.read('R').symbol]).toEqual(['SPY', 'QQQ'])
    expect(proposals()).toHaveLength(0)
    await waitFor(() => expect(receipts().length).toBeGreaterThanOrEqual(1))
    void board
  }, 30000)
  it('the same change on both charts (a fan-out) the member asked for runs per chart — two receipts, no card', async () => {
    const { h, say } = mount(...TWO())
    await say('make both charts weekly')
    await waitFor(() => expect([h.charts.read('L').tf, h.charts.read('R').tf]).toEqual(['W', 'W']), { timeout: 8000 })
    expect(proposals()).toHaveLength(0)
  }, 30000)
})

// ═══ L3 ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('L3 · destructive / permanent changes still need approval', () => {
  it('removing two widgets the model planned as "apply" is still a card — nothing removed before Apply', async () => {
    const quad = [
      { id: 'tl', type: 'chart', x: 0, y: 0, w: 12, h: 10, color: 'N', opts: {} }, { id: 'tr', type: 'chart', x: 12, y: 0, w: 12, h: 10, color: 'N', opts: {} },
      { id: 'bl', type: 'chart', x: 0, y: 10, w: 12, h: 10, color: 'N', opts: {} }, { id: 'br', type: 'chart', x: 12, y: 10, w: 12, h: 10, color: 'N', opts: {} },
    ]
    const { board, say } = mount(quad, { 'N:tl': 'A1', 'N:tr': 'B1', 'N:bl': 'C1', 'N:br': 'D1' })
    envelopes.push(b => env('apply', [
      { action: 'widget.remove', target: b.context.board[0].ref, args: { widget: 'bl' } },
      { action: 'widget.remove', target: b.context.board[0].ref, args: { widget: 'br' } },
    ]))
    await say('Get rid of the two bottom charts, please.')
    await waitFor(() => expect(proposals()).toHaveLength(1), { timeout: 8000 })
    expect(board.state.widgets).toHaveLength(4)
  }, 30000)

  it('the approval policy is a deliberate list: every confirm-risk or permanent action is proposed; only indicator.saveDraft may skip its card on the member\'s own words', () => {
    const contract = JSON.parse(fs.readFileSync(path.resolve(HERE, 'contract/manifest.contract.json'), 'utf8'))
    const caps = allCapabilityNames().map(getCapability)
    expect(caps.filter(c => c.explicitOk).map(c => c.name).sort()).toEqual([...contract.approval.explicitOk].sort())
    const guarded = caps.filter(c => c.risk === 'confirm' || c.reversible === false).map(c => c.name).sort()
    // ⛔ changing this list changes what UCT asks before doing — review it with the owner (and the server mirror)
    expect(guarded).toEqual(['alert.create', 'alert.delete', 'chart.applyTemplate', 'chart.resetDefaults', 'chartSetup.copyLook', 'chartSetup.deleteTemplate',
      'definition.delete', 'definition.duplicate', 'drawing.clear', 'indicator.discardDraft', 'indicator.remove', 'indicator.saveDraft', 'layout.create',
      'layout.delete', 'layout.duplicate', 'layout.rename', 'layout.saveAs', 'layout.saveCurrent', 'screener.deleteSaved', 'screener.duplicateSaved',
      'screener.renameSaved', 'screener.saveAs', 'watchlist.clear', 'watchlist.create', 'watchlist.delete', 'watchlist.rename'])
    // the new grid is an ordinary, reversible workspace change (exact Undo)
    expect(getCapability('chartGrid.set')).toMatchObject({ target: 'board' })
    expect(getCapability('chartGrid.set').risk ?? 'local').toBe('local')
    expect(getCapability('chartGrid.set').reversible).not.toBe(false)
  })
})

// ═══ L4 ═════════════════════════════════════════════════════════════════════════════════════════════════
const EMA_PCT = 'Create a custom indicator that shows the difference between the 9 EMA and 20 EMA as a percentage and put it in a separate pane.'
const customOn = (board, id) => (mergeChartSettings(JSON.stringify(board.state.widgets.find(w => w.id === id)?.opts?.settings || null)).indicatorInstances || []).filter(i => !i.deleted && /^u_/.test(String(i.defId)))
const label1 = (s) => (s ? { ...s, label: `Chart (${s.symbol})` } : s)
describe('L4 · the owner\'s custom indicator, end to end', () => {
  it('(EMA 9 − EMA 20) / EMA 20 × 100: built, saved as a new indicator, on the chart, in its own pane — one sentence, no card; Undo takes it off the chart', async () => {
    const { board, say } = mount([{ id: 'c', type: 'chart', x: 0, y: 0, w: 24, h: 20, color: 'N', opts: { settings: mergeChartSettings(null) } }], { 'N:c': 'QQQ' }, { decorate: label1 })
    // the model plans only the build (the Agent adds the Save the member's words asked for)
    envelopes.push(b => env('apply', [{ action: 'indicator.draft', target: b.context.indicatorDrafts.find(e => e.new).ref, args: { message: EMA_PCT, chart: b.context.charts[0].ref, edit: null } }]))
    await say(EMA_PCT)
    await waitFor(() => expect(customOn(board, 'c')).toHaveLength(1), { timeout: 12000 })
    expect(builder.calls).toEqual([EMA_PCT])                                   // the member's words, verbatim, once
    const saved = [...server.values()]
    expect(saved).toHaveLength(1)
    expect(saved[0].definition.placement).toMatchObject({ target: 'pane' })   // its own pane
    expect(JSON.stringify(saved[0].definition)).toMatch(/"ema"/)
    // one sentence: what, where, which pane (the builder named it after its formula — a formula-like name never goes in chat)
    await waitFor(() => expect(screen.getAllByTestId('agent-receipt-summary').map(e => e.textContent)).toContain('Done — created your “EMA 9 vs EMA 20 %” indicator and added it to Chart (QQQ), in its own pane.'), { timeout: 8000 })
    expect(proposals()).toHaveLength(0)
    expect(transcript()).not.toMatch(/Want me to apply it|couldn’t do that|nothing was saved/)
    expect((transcript().match(/difference between the 9 EMA and 20 EMA/g) || []).length).toBe(1)    // never read back
    await say('undo')
    await waitFor(() => expect(customOn(board, 'c')).toHaveLength(0), { timeout: 8000 })
    expect(server.size).toBe(1)                                               // the saved indicator stays (as the receipt said)
  }, 40000)
})

// ═══ L5 ═════════════════════════════════════════════════════════════════════════════════════════════════
describe('L5 · a builder failure says what failed', () => {
  it('a malformed builder answer → that, plainly, and what to try; nothing saved, nothing on the chart', async () => {
    builder.mode = 'malformed'
    const { board, say } = mount([{ id: 'c', type: 'chart', x: 0, y: 0, w: 24, h: 20, color: 'N', opts: { settings: mergeChartSettings(null) } }], { 'N:c': 'QQQ' }, { decorate: label1 })
    envelopes.push(b => env('apply', [{ action: 'indicator.draft', target: b.context.indicatorDrafts.find(e => e.new).ref, args: { message: EMA_PCT, chart: b.context.charts[0].ref, edit: null } }]))
    await say(EMA_PCT)
    await waitFor(() => expect(transcript()).toMatch(/The indicator builder’s answer wasn’t a valid indicator, so nothing was saved\. Try asking again, or describe the calculation step by step\./), { timeout: 10000 })
    expect(transcript()).not.toMatch(/envelope:|schema|gate/)
    expect(server.size).toBe(0)
    expect(customOn(board, 'c')).toHaveLength(0)
  }, 30000)
  it('a specific refusal carries the builder\'s own reason', () => {
    const out = { ok: false, reason: AR.TURN_REFUSED, detail: { gate: 'unsupported:node' }, lines: ['it reads a lower timeframe; conversational authoring draws on the chart\'s own bars or a higher timeframe only', 'Nothing changed.'] }
    expect(refusalSentence(out)).toBe('The indicator builder couldn’t build that: it reads a lower timeframe; conversational authoring draws on the chart\'s own bars or a higher timeframe only. Nothing was saved.')
  })
})

// ═══ receipts: one short sentence, the record one click away ═══════════════════════════════════════════
describe('receiptView', () => {
  it('one line as it is; several as one sentence with the exact lines in Details; an Undo as it is', () => {
    expect(receiptView(['Added EMA 20 on Left chart (NVDA)'])).toEqual({ summary: 'Added EMA 20 on Left chart (NVDA)', details: '' })
    expect(receiptView(['Added EMA 9/20 % Diff on Chart (QQQ)', 'Saved to your indicators — EMA 9/20 % Diff — …'])).toEqual({
      summary: 'Done — created your “EMA 9/20 % Diff” indicator and added it to Chart (QQQ).', details: 'Added EMA 9/20 % Diff on Chart (QQQ) · Saved to your indicators — EMA 9/20 % Diff — …' })
    expect(receiptView(['Switched timeframe to Weekly', 'Changed symbol to SPY', 'Changed symbol to QQQ']).summary).toBe('Done — switched timeframe to Weekly (and 2 more changes).')
    expect(receiptView(['Undid: x · y'], { isUndo: true })).toEqual({ summary: 'Undid: x · y', details: '' })
  })
})
