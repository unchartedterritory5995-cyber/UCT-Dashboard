// S6 follow-ups (Agent-owned): F4 new charts and link groups, F5 one indicator on several charts,
// and the wording nits (chart choices, position labels). Real AgentPanel + useAgent + planner +
// runtime + the M2 mutation interface; fixture board (the product's own placement and link rules).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { fastParse } from './fastPath'
import { buildContext } from './capabilities'
import { planOps, collectTargets, prepareOps } from './executor'
import { commitPlan } from './runtime'
import { newChartTicker, screenNewChart } from './capabilities/workspace'
import { screenModelOps, multiChartAmbiguity } from './capabilities/indicatorAuthoring'
import { positionWord } from './host'
import { makeBoard } from './__fixtures__/board'
import { mergeChartSettings } from '../components/chart/chartDefaults'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
import AgentPanel from './AgentPanel'

registerBuiltins()

const KNOWN = new Set(['SPY', 'QQQ', 'NVDA', 'AAPL', 'MSFT'])
let calls, envelopes
beforeEach(() => {
  try { localStorage.clear() } catch { /* */ }
  calls = []; envelopes = []
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null
    calls.push([init.method || 'GET', String(url), body])
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
    if (url === '/api/agent/turn') { const e = envelopes.shift(); return json({ conversationId: 'ac_1', envelope: typeof e === 'function' ? e(body) : e, usage: { research_calls: 0, citations: [] } }) }
    if (url === '/api/agent/record') return json({ conversationId: 'ac_1' })
    if (String(url).startsWith('/api/ticker-search')) {
      const q = new URL(String(url), 'http://x').searchParams.get('q')
      return json({ results: KNOWN.has(q) ? [{ ticker: q }] : [] })
    }
    return json({ conversations: [] })
  })
})
afterEach(() => { vi.restoreAllMocks(); cleanup() })

const env = (disposition, ops) => ({ disposition, reply: '', question: null, ops, unsupported_category: null })
const turns = () => calls.filter(c => c[1] === '/api/agent/turn').length
const transcript = () => screen.getByTestId('agent-transcript').textContent
const saysSoon = (re) => waitFor(() => expect(transcript()).toMatch(re), { timeout: 6000 })

function mount(widgets, groupSyms, { readonly = [] } = {}) {
  const board = makeBoard(widgets, groupSyms)
  const pos = Object.fromEntries(widgets.map(w => [w.id, w.pos || null]))
  const base = board.host.charts
  const decorate = (s) => (s ? { ...s, position: pos[s.ref], label: pos[s.ref] ? `${pos[s.ref][0].toUpperCase()}${pos[s.ref].slice(1)} chart (${s.symbol})` : s.label } : s)
  const h = {
    ...board.host,
    charts: { ...base, list: () => base.list().map(decorate), read: (ref) => decorate(base.read(ref)), canManageIndicators: (ref) => !readonly.includes(ref) },
    persist: async () => ({ ok: true }),
  }
  render(<AgentPanel host={h} onClose={() => {}} />)
  const box = screen.getByLabelText('Message UCT Agent')
  const say = (t) => { fireEvent.change(box, { target: { value: t } }); fireEvent.keyDown(box, { key: 'Enter' }) }
  return { ...board, h, say }
}
const settingsOf = (board, id) => mergeChartSettings(JSON.stringify(board.state.widgets.find(w => w.id === id)?.opts?.settings || null))
const liveOf = (board, id, defId) => (settingsOf(board, id).indicatorInstances || []).filter(i => !i.deleted && i.defId === defId)
const W = (id, x, pos, color = 'N') => ({ id, type: 'chart', x, y: 0, w: 8, h: 20, color, pos, opts: { settings: mergeChartSettings(null) } })

// ── F4 ─────────────────────────────────────────────────────────────────────────────
describe('F4 — a new chart for a named ticker is born on it, not linked', () => {
  it('reads the ticker only when the member wrote one (capitals), never an ordinary word', () => {
    expect(newChartTicker('Open a QQQ chart.')).toBe('QQQ')
    expect(newChartTicker('add a new SPY chart')).toBe('SPY')
    expect(newChartTicker('Open a chart of NVDA')).toBe('NVDA')
    expect(newChartTicker('please open a QQQ chart, please')).toBe('QQQ')
    expect(newChartTicker('open a qqq chart')).toBe(null)                   // lower case: not read as a ticker
    expect(newChartTicker('open a new chart')).toBe(null)
    expect(newChartTicker('Add a NEW chart')).toBe(null)
    expect(newChartTicker('Open QQQ')).toBe(null)                            // that is chart.setSymbol's phrase
  })
  it('the fast path: "Open a QQQ chart." → widget.addCharts [QQQ]; "open QQQ" still changes the current chart', () => {
    const board = makeBoard([{ id: 'c', type: 'chart', x: 0, y: 0, w: 12, h: 20 }], { A: 'AAPL' })
    const hit = fastParse('Open a QQQ chart.', { host: board.host })
    expect(hit?.kind).toBe('ops')
    expect(hit.ops.map(o => [o.action, o.args.symbols])).toEqual([['widget.addCharts', ['QQQ']]])
    expect(fastParse('open QQQ', { host: board.host })?.ops?.[0]?.action).toBe('chart.setSymbol')
  })
  it('the model path: a plan that dropped the ticker is corrected; a complete plan, or another widget, is left alone', () => {
    const add = { action: 'widget.add', target: 'ws', args: { type: 'chart', as: null } }
    expect(screenNewChart([add], 'Open a QQQ chart.')).toEqual({ ops: [{ action: 'widget.addCharts', target: 'ws', args: { symbols: ['QQQ'], timeframe: null, chart_type: null, exact: null } }], corrected: true })
    const full = [{ ...add, args: { type: 'chart', as: 'new1' } }, { action: 'chart.setSymbol', target: 'new1', args: { symbol: 'QQQ' } }]
    expect(screenNewChart(full, 'Open a QQQ chart.').corrected).toBe(false)
    expect(screenNewChart([{ ...add, args: { type: 'watchlist', as: null } }], 'Open a QQQ chart.').corrected).toBe(false)
    expect(screenNewChart([add], 'add a chart').corrected).toBe(false)
  })
  it('end to end (the S6 W2b repro): "Open a QQQ chart." makes ONE chart on QQQ, not linked; group A keeps its symbol and the existing chart is untouched', async () => {
    const { state, h, say } = mount([{ id: 'c', type: 'chart', x: 0, y: 0, w: 12, h: 20, color: 'A' }], { A: 'NASDAQ:DEC' })
    say('Open a QQQ chart.')
    await waitFor(() => expect(screen.getAllByTestId('agent-proposal').length).toBe(1))
    expect(screen.getAllByTestId('agent-proposal')[0].textContent).toMatch(/Create a chart: QQQ — each on its own symbol, not linked/)
    expect(turns()).toBe(0)
    say('do it')
    await waitFor(() => expect(state.widgets.filter(w => w.type === 'chart')).toHaveLength(2), { timeout: 4000 })
    const fresh = state.widgets.find(w => w.id !== 'c')
    expect(fresh.color).toBe('N')
    expect(h.charts.read(fresh.id).symbol).toBe('QQQ')
    expect(state.groupSyms.A).toBe('NASDAQ:DEC')                           // ⛔ the shared group symbol is never written
    expect(h.charts.read('c').symbol).toBe('NASDAQ:DEC')
  })
  it('charts ALREADY linked keep the product rule: a symbol change on a linked chart moves its group (unchanged behaviour)', async () => {
    const board = makeBoard([{ id: 'a', type: 'chart', x: 0, y: 0, w: 12, h: 20, color: 'A' }, { id: 'b', type: 'chart', x: 12, y: 0, w: 12, h: 20, color: 'A' }], { A: 'AAPL' })
    const ops = [{ action: 'chart.setSymbol', target: 'a', args: { symbol: 'MSFT' } }]
    buildContext(board.host, { surface: 'charts' })
    const p = planOps(collectTargets(board.host, ['chart']), ops, await prepareOps(ops), { surface: 'charts' })
    expect(p.ok, JSON.stringify(p.refusals)).toBe(true)
    expect((await commitPlan(board.host, p, { env: {}, ctx: { surface: 'charts' } })).ok).toBe(true)
    expect(board.state.groupSyms.A).toBe('MSFT')
    expect(board.host.charts.read('b').symbol).toBe('MSFT')                 // intentional linking still links
  })
})

// ── F5 ─────────────────────────────────────────────────────────────────────────────
const ADD = (b, pos, defId = 'rsi') => ({ action: 'indicator.add', target: b.context.indicatorEdits.find(e => e.position === pos).ref, args: { defId } })
describe('F5 — "add this indicator to both charts": one proposal, then each chart on its own (M2 adds, own receipts + Undo)', () => {
  it('proposed once naming both charts; Apply adds to each separately; Undo removes ONE and leaves the other', async () => {
    const { state, say } = mount([W('L', 0, 'left'), W('R', 8, 'right')], { 'N:L': 'NVDA', 'N:R': 'AAPL' })
    envelopes.push(b => env('apply', [ADD(b, 'left'), ADD(b, 'right')]))
    say('Add RSI to both charts.')
    await waitFor(() => expect(screen.getAllByTestId('agent-proposal').length).toBe(1))
    const card = screen.getAllByTestId('agent-proposal')[0].textContent
    expect(card).toMatch(/Add Relative Strength[^·]* to Left chart \(NVDA\)/)
    expect(card).toMatch(/Add Relative Strength[^·]* to Right chart \(AAPL\)/)
    expect(card).toContain('Each chart is changed separately, with its own receipt and Undo.')
    expect(liveOf({ state }, 'L', 'rsi')).toHaveLength(0)                   // proposing writes nothing
    say('do it')
    await waitFor(() => expect(screen.getAllByTestId('agent-receipt').length).toBe(2), { timeout: 5000 })
    expect(liveOf({ state }, 'L', 'rsi')).toHaveLength(1)
    expect(liveOf({ state }, 'R', 'rsi')).toHaveLength(1)
    say('undo')
    await waitFor(() => expect(liveOf({ state }, 'R', 'rsi')).toHaveLength(0), { timeout: 4000 })
    expect(liveOf({ state }, 'L', 'rsi')).toHaveLength(1)                   // independent Undo
  })
  it('one chart can\'t take it (read-only) → refused up front; NOTHING is added anywhere', async () => {
    const { state, say } = mount([W('L', 0, 'left'), W('R', 8, 'right')], { 'N:L': 'NVDA', 'N:R': 'AAPL' }, { readonly: ['R'] })
    envelopes.push(b => env('apply', [ADD(b, 'left'), ADD(b, 'right')]))
    say('Add RSI to both charts.')
    await saysSoon(/I didn't change anything/)
    expect(screen.queryAllByTestId('agent-proposal')).toHaveLength(0)
    expect(liveOf({ state }, 'L', 'rsi')).toHaveLength(0)
  })
  it('a chart closed between the card and Apply → refused at Apply; nothing added', async () => {
    const { state, say } = mount([W('L', 0, 'left'), W('R', 8, 'right')], { 'N:L': 'NVDA', 'N:R': 'AAPL' })
    envelopes.push(b => env('apply', [ADD(b, 'left'), ADD(b, 'right')]))
    say('Add RSI to both charts.')
    await waitFor(() => expect(screen.getAllByTestId('agent-proposal').length).toBe(1))
    state.widgets = state.widgets.filter(w => w.id !== 'R')
    say('do it')
    await saysSoon(/I didn't change anything|changed since you approved/)
    expect(liveOf({ state }, 'L', 'rsi')).toHaveLength(0)
  })
  it('applied only as a whole: "just the first one" is refused and the card stays', async () => {
    const { state, say } = mount([W('L', 0, 'left'), W('R', 8, 'right')], { 'N:L': 'NVDA', 'N:R': 'AAPL' })
    envelopes.push(b => env('apply', [ADD(b, 'left'), ADD(b, 'right')]))
    say('Add RSI to both charts.')
    await waitFor(() => expect(screen.getAllByTestId('agent-proposal').length).toBe(1))
    say('just do the first one')
    await saysSoon(/can only be applied as a whole/)
    expect(liveOf({ state }, 'L', 'rsi')).toHaveLength(0)
  })
  it('unambiguous targets: "both" on a 3-chart board with the charts unnamed → asks which two; named → fine; "all" = every chart', () => {
    const board = makeBoard([W('L', 0, 'left'), W('M', 8, 'middle'), W('R', 16, 'right')], { 'N:L': 'NVDA', 'N:M': 'MSFT', 'N:R': 'AAPL' })
    const h = { ...board.host, charts: { ...board.host.charts, canManageIndicators: () => true } }
    const adds = (refs) => refs.map(r => ({ action: 'indicator.add', target: `ixe:${r}`, args: { defId: 'rsi' } }))
    expect(multiChartAmbiguity(h, adds(['L', 'R']), 'Add RSI to both charts')).toBe('Which two charts should it go on?')
    expect(multiChartAmbiguity(h, adds(['L', 'R']), 'Add RSI to both the NVDA and AAPL charts')).toBe(null)
    expect(multiChartAmbiguity(h, adds(['L', 'M', 'R']), 'Add RSI to both charts')).toBe('Which two charts should it go on?')
    expect(multiChartAmbiguity(h, adds(['L', 'M', 'R']), 'Add RSI to all my charts')).toBe(null)
    expect(multiChartAmbiguity(h, adds(['L', 'R']), 'Add RSI to all my charts')).toBe('Which charts should it go on?')
    const s = screenModelOps(h, adds(['L', 'R']), 'Add RSI to both charts', { surface: 'charts' })
    expect(s.ops).toEqual([])
    expect(s.ask.text).toBe('Which two charts should it go on?')
  })
  it('the same add on ONE chart is unchanged (applied directly, no fan-out card)', async () => {
    const { state, say } = mount([W('L', 0, 'left'), W('R', 8, 'right')], { 'N:L': 'NVDA', 'N:R': 'AAPL' })
    envelopes.push(b => env('apply', [ADD(b, 'left')]))
    say('Add RSI to the left chart.')
    await waitFor(() => expect(screen.queryAllByTestId('agent-receipt').length, transcript()).toBe(1), { timeout: 4000 })
    expect(screen.queryAllByTestId('agent-proposal')).toHaveLength(0)
    expect(liveOf({ state }, 'L', 'rsi')).toHaveLength(1)
  })
})

// ── wording nits ─────────────────────────────────────────────────────────────────────
describe('S6 wording nits', () => {
  it('position labels: a full-height left chart beside a top-right one is "left" (was "bottom-left"); quadrants unchanged', () => {
    const left = { x: 0, y: 0, w: 12, h: 20 }
    const tr = { x: 12, y: 0, w: 12, h: 12 }
    expect(positionWord(left, [left, tr])).toBe('left')
    expect(positionWord(tr, [left, tr])).toBe('top-right')
    const q = [{ x: 0, y: 0, w: 12, h: 10 }, { x: 12, y: 0, w: 12, h: 10 }, { x: 0, y: 10, w: 12, h: 10 }, { x: 12, y: 10, w: 12, h: 10 }]
    expect(q.map(w => positionWord(w, q))).toEqual(['top-left', 'top-right', 'bottom-left', 'bottom-right'])
    const sideBySide = [{ x: 0, y: 0, w: 12, h: 20 }, { x: 12, y: 0, w: 12, h: 20 }]
    expect(sideBySide.map(w => positionWord(w, sideBySide))).toEqual(['left', 'right'])
  })
  it('a NEW draft with no chart named on a multi-chart board → "Which chart…?" WITH the charts as choices (refs), nothing sent', () => {
    const board = makeBoard([W('L', 0, 'left'), W('R', 8, 'right')], { 'N:L': 'NVDA', 'N:R': 'AAPL' })
    const ops = [{ action: 'indicator.draft', target: 'draft:new', args: { message: 'Build me an RSI 14 indicator.', chart: null, edit: null } }]
    const s = screenModelOps(board.host, ops, 'Build me an RSI 14 indicator.', { surface: 'charts', createIndicator: true })
    expect(s.ops).toEqual([])
    expect(s.ask.text).toBe('Which chart is this indicator for?')
    expect(s.ask.choices.map(c => c.ref)).toEqual(['L', 'R'])
    expect(s.ask.pick).toEqual({ ops, action: 'indicator.draft', arg: 'chart' })
    // one chart → no question (it is that chart)
    const one = makeBoard([W('L', 0, 'left')], { 'N:L': 'NVDA' })
    expect(screenModelOps(one.host, ops, 'Build me an RSI 14 indicator.', { surface: 'charts', createIndicator: true }).ask).toBeUndefined()
  })
})
