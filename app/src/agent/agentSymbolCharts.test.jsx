// Symbol sources → Charts: a screen's results, a saved watchlist or the last screen
// feed ONE consumer (widget.addCharts) that expands into the ordinary creation ops.
// Real AgentPanel + useAgent + planner + runtime; fixture Screener engine, fixture
// watchlist server and fixture board (the product's own placement rules).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { expandOps, checkRefs } from './compose'
import { getCapability, manifestFor } from './capabilities'
import { _resetScreenerCache, loadMeta } from './capabilities/screener'
import { makeBoard } from './__fixtures__/board'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
import AgentPanel from './AgentPanel'

registerBuiltins()

const UNIVERSE = Array.from({ length: 30 }, (_, i) => ({ ticker: `T${String(i + 1).padStart(2, '0')}`, adr_pct: 4 + i * 0.3, price: 5 + i * 3 }))
const KNOWN = new Set(['SPY', 'QQQ', 'NVDA'])
let calls, envelopes, research
beforeEach(() => {
  _resetScreenerCache()
  try { localStorage.clear() } catch { /* */ }
  calls = []; envelopes = []; research = 0
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null
    calls.push([init.method || 'GET', String(url), body])
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
    if (url === '/api/screener/fields') return json({ fields: [{ key: 'adr_pct', label: 'ADR %', type: 'range', unit: '%' }, { key: 'price', label: 'Price', type: 'range', unit: '$' }] })
    if (url === '/api/screener/saved-screens') return json({ saved: [], starters: [] })
    if (url === '/api/screener/scan') {
      const ok = (r, f) => (f.op === 'gt' ? r[f.key] > f.min : f.op === 'lt' ? r[f.key] < f.max : true)
      let rows = UNIVERSE.filter(r => body.filters.every(f => ok(r, f)))
      if (body.sort?.key) rows = [...rows].sort((a, b) => (body.sort.dir === 'asc' ? 1 : -1) * (a[body.sort.key] - b[body.sort.key]))
      return json({ total: rows.length, rows: rows.slice(0, body.page_size), snapshot_date: '2026-10-07' })
    }
    if (url === '/api/agent/turn') {
      const e = envelopes.shift()
      return json({ conversationId: 'ac_1', envelope: typeof e === 'function' ? e(body) : e, usage: { research_calls: research, citations: [] } })
    }
    if (url === '/api/agent/record') return json({ conversationId: 'ac_1' })
    if (String(url).startsWith('/api/ticker-search')) {
      const q = new URL(String(url), 'http://x').searchParams.get('q')
      return json({ results: KNOWN.has(q) ? [{ ticker: q }] : [] })
    }
    return json({ conversations: [] })
  })
})
afterEach(() => { vi.restoreAllMocks() })

const env = (disposition, ops, reply = '') => ({ disposition, reply, question: null, ops, unsupported_category: null })
const turns = () => calls.filter(c => c[1] === '/api/agent/turn').length
const scans = () => calls.filter(c => c[1] === '/api/screener/scan')
// The model's refs, read from the context it was actually sent.
const WS = (b) => b.context.workspace[0].ref
const SCR = (b) => b.context.screener[0].ref
const LIST = (b, name) => b.context.watchlists.find(w => w.name === name).ref
const SCREEN = (b, extra = {}) => ({ action: 'screener.run', target: SCR(b), args: { filters: [{ field: 'adr_pct', op: 'gt', value: 10, max: null }], sort_field: null, sort_dir: null, mode: 'new', show: null, as: 'screen1', ...extra } })
const CHARTS = (b, symbols, extra = {}) => ({ action: 'widget.addCharts', target: WS(b), args: { symbols, timeframe: null, chart_type: null, exact: null, ...extra } })

const EXISTING = { id: 'c', type: 'chart', x: 0, y: 0, w: 12, h: 20 }
const LISTS = [{ id: 'm1', name: 'Agent Test Watchlist', symbols: ['T03', 'T01', 'T02'] }]

async function mount({ widgets = [EXISTING], lists = LISTS, failAddAt = null } = {}) {
  const board = makeBoard(widgets, { A: 'AAPL' }, { watchlists: lists, failAddAt })
  render(<AgentPanel host={board.host} onClose={() => {}} />)
  await loadMeta()
  const box = screen.getByLabelText('Message UCT Agent')
  const say = (t) => { fireEvent.change(box, { target: { value: t } }); fireEvent.keyDown(box, { key: 'Enter' }) }
  const newCharts = () => board.state.widgets.filter(w => w.type === 'chart' && w.id !== 'c')
  const syms = () => newCharts().map(w => board.host.charts.read(w.id).symbol)
  return { ...board, say, newCharts, syms }
}
// The n-th card of a kind (1-based), once it exists.
const nth = async (testId, n) => {
  await waitFor(() => expect(screen.queryAllByTestId(testId).length).toBeGreaterThanOrEqual(n), { timeout: 4000 })
  return screen.getAllByTestId(testId)[n - 1].textContent
}
const transcript = () => screen.getByTestId('agent-transcript').textContent
const saysSoon = (re) => waitFor(() => expect(transcript()).toMatch(re), { timeout: 6000 })

describe('Screener → Charts', () => {
  it('proposal first (query + rule, no symbols); Apply screens fresh and builds 4 EQUAL 5-minute charts in the engine order — 0 model / 0 research calls on Apply; one Undo', async () => {
    const { state, host, say, newCharts, syms } = await mount()
    envelopes.push(b => env('propose', [SCREEN(b), CHARTS(b, { from: 'screen1', top: 4 }, { timeframe: '5' })]))
    say('Find stocks with ADR above 10% and open the top 4 as 5-minute charts.')
    const card = await nth('agent-proposal', 1)
    expect(card).toContain('Screen for ADR % > 10% — run fresh when you apply')
    expect(card).toContain('Create up to 4 5-minute charts, one per stock in its order')
    expect(card).not.toMatch(/T\d\d/)
    expect(scans()).toHaveLength(0)
    expect(newCharts()).toHaveLength(0)
    const t = turns()
    say('do it')
    const rec = await nth('agent-receipt', 1)
    expect(turns()).toBe(t)
    expect(scans()).toHaveLength(1)
    // ADR > 10 → T22… (T21 is exactly 10.0) in the engine's (unsorted) order.
    expect(syms()).toEqual(['T22', 'T23', 'T24', 'T25'])
    expect(newCharts().map(w => host.charts.read(w.id).tf)).toEqual(['5', '5', '5', '5'])
    expect(new Set(newCharts().map(w => `${w.w}x${w.h}`))).toEqual(new Set(['6x10']))
    expect(newCharts().every(w => w.color === 'N')).toBe(true)                        // unlinked: the member's group is not retargeted
    expect(state.widgets.find(w => w.id === 'c')).toMatchObject(EXISTING)
    expect(host.charts.read('c').symbol).toBe('AAPL')
    expect(rec).toContain('Screened ADR % > 10%: 9 matches')
    expect(rec).toContain('Created 4 5-minute charts: T22, T23, T24 and T25')
    say('undo')
    await saysSoon(/Undid: Created 4 5-minute charts/)
    expect(newCharts()).toHaveLength(0)
    expect(state.widgets).toHaveLength(1)
    expect(turns()).toBe(t)
  })

  it("the production model's measured shape (2026-10-07: filter without `max`, sort_dir with no field, chart_type candles) works end to end", async () => {
    const { host, say, newCharts, syms } = await mount()
    envelopes.push(b => env('propose', [
      { action: 'screener.run', target: SCR(b), args: { filters: [{ field: 'adr_pct', op: 'gt', value: 10 }], sort_field: null, sort_dir: 'asc', mode: 'new', show: 4, as: 'screen1' } },
      CHARTS(b, { from: 'screen1', top: 4 }, { timeframe: '5', chart_type: 'candles' }),
    ]))
    say('Find stocks with ADR above 10% and open the top 4 as 5-minute charts.')
    await nth('agent-proposal', 1)
    say('do it')
    expect(await nth('agent-receipt', 1)).toContain('Created 4 5-minute charts (candles): T22, T23, T24 and T25')
    expect(syms()).toEqual(['T22', 'T23', 'T24', 'T25'])
    expect(newCharts().map(w => host.charts.read(w.id).tf)).toEqual(['5', '5', '5', '5'])
  })

  it('each new chart is BORN unlinked on its own ticker and timeframe — no default (yellow group / SPY) symbol is ever loaded first; a plain "add a chart" keeps the product default', async () => {
    const { state, host, say, newCharts } = await mount()
    envelopes.push(b => env('propose', [SCREEN(b), CHARTS(b, { from: 'screen1', top: 4 }, { timeframe: '5' })]))
    say('Chart the top 4 with ADR above 10% on 5-minute.')
    await nth('agent-proposal', 1)
    say('do it')
    await nth('agent-receipt', 1)
    expect(state.addCalls.map(c => c.init)).toEqual([
      { symbol: 'T22', tf: '5' }, { symbol: 'T23', tf: '5' }, { symbol: 'T24', tf: '5' }, { symbol: 'T25', tf: '5' },
    ])
    expect(newCharts().map(w => [w.color, host.charts.read(w.id).symbol, host.charts.read(w.id).tf])).toEqual([
      ['N', 'T22', '5'], ['N', 'T23', '5'], ['N', 'T24', '5'], ['N', 'T25', '5'],
    ])
    expect(state.groupSyms.A).toBe('AAPL')                                       // the member's yellow group untouched
    say('undo')
    await saysSoon(/Undid: Created 4 5-minute charts/)
    envelopes.push(b => env('apply', [{ action: 'widget.add', target: WS(b), args: { type: 'chart', as: null } }]))
    say('Add a chart widget please')
    await nth('agent-receipt', 3)
    const plain = newCharts()
    expect(plain).toHaveLength(1)
    expect(plain[0].color).toBe('A')                                             // manual default: the linked yellow group
    expect(state.addCalls[state.addCalls.length - 1].init).toBeNull()
  })

  it('an explicit SORT decides the order; bars type applied to every new chart', async () => {
    const { host, say, newCharts, syms } = await mount()
    envelopes.push(b => env('propose', [SCREEN(b, { sort_field: 'adr_pct', sort_dir: 'desc' }), CHARTS(b, { from: 'screen1', top: 3 }, { chart_type: 'bars' })]))
    say('Screen ADR above 10% sorted by ADR highest first and chart the top 3 as bars.')
    await nth('agent-proposal', 1)
    say('do it')
    await nth('agent-receipt', 1)
    expect(syms()).toEqual(['T30', 'T29', 'T28'])
    expect(newCharts().map(w => host.charts.read(w.id).cs.chartType)).toEqual(['bars', 'bars', 'bars'])
    expect(scans()[0][2].sort).toEqual({ key: 'adr_pct', dir: 'desc' })
  })

  it('FEWER results than asked: uses what matched; EXACT: refuses, nothing created; ZERO: nothing created', async () => {
    const { say, newCharts, syms, widgetOps } = await mount()
    // ADR > 12 → T28, T29, T30 only.
    envelopes.push(b => env('propose', [SCREEN(b, { filters: [{ field: 'adr_pct', op: 'gt', value: 12, max: null }] }), CHARTS(b, { from: 'screen1', top: 4 })]))
    say('Chart the top 4 with ADR above 12%.')
    await nth('agent-proposal', 1)
    say('do it')
    expect(await nth('agent-receipt', 1)).toContain('Created 3 charts: T28, T29 and T30')
    expect(syms()).toEqual(['T28', 'T29', 'T30'])
    say('undo')
    await saysSoon(/Undid: Created 3 charts/)

    const add = vi.spyOn(widgetOps, 'add')
    envelopes.push(b => env('propose', [SCREEN(b, { filters: [{ field: 'adr_pct', op: 'gt', value: 12, max: null }] }), CHARTS(b, { from: 'screen1', top: 4 }, { exact: true })]))
    say('I need exactly 4 charts with ADR above 12%.')
    expect(await nth('agent-proposal', 2)).toContain('Create exactly 4 charts')
    say('do it')
    await saysSoon(/only 3 stocks came back and you asked for exactly 4, so I didn't create any charts/)
    expect(add).not.toHaveBeenCalled()
    expect(newCharts()).toHaveLength(0)

    envelopes.push(b => env('propose', [SCREEN(b, { filters: [{ field: 'adr_pct', op: 'gt', value: 50, max: null }] }), CHARTS(b, { from: 'screen1', top: 4 })]))
    say('Chart the top 4 with ADR above 50%.')
    await nth('agent-proposal', 3)
    say('do it')
    await saysSoon(/No stocks matched ADR % > 50%, so I didn't create or change anything\./)
    expect(add).not.toHaveBeenCalled()
  })

  it('CAPACITY: refused at the proposal before any screen runs; space taken before Apply → refused at Apply, still no screen', async () => {
    // Chart left + rail right: room for 3 charts, not 4.
    const rail = { id: 'wl', type: 'watchlist', x: 18, y: 0, w: 6, h: 20 }
    const { state, say } = await mount({ widgets: [EXISTING, rail] })
    envelopes.push(b => env('propose', [SCREEN(b), CHARTS(b, { from: 'screen1', top: 4 })]))
    say('Chart the top 4 with ADR above 10%.')
    await saysSoon(/There isn't enough open space for 4 charts without rearranging your current workspace \(room for 3 more charts\)/)
    expect(screen.queryByTestId('agent-proposal')).toBeNull()
    expect(scans()).toHaveLength(0)

    envelopes.push(b => env('propose', [SCREEN(b), CHARTS(b, { from: 'screen1', top: 3 })]))
    say('Chart the top 3 with ADR above 10%.')
    await nth('agent-proposal', 1)
    // The member drops a widget into the free strip before approving.
    state.widgets = [...state.widgets, { id: 'n1', type: 'news', x: 12, y: 0, w: 6, h: 20, color: 'A', opts: {} }]
    const before = JSON.stringify(state.widgets)
    say('do it')
    await saysSoon(/isn't enough open space for 3 charts/)
    expect(scans()).toHaveLength(0)
    expect(JSON.stringify(state.widgets)).toBe(before)
  })

  it('a LAYOUT switch before Apply refuses the proposal; nothing runs', async () => {
    const { host, state, say } = await mount()
    host.epoch = () => 'user:1'
    envelopes.push(b => env('propose', [SCREEN(b), CHARTS(b, { from: 'screen1', top: 2 })]))
    say('Chart the top 2 with ADR above 10%.')
    await nth('agent-proposal', 1)
    host.epoch = () => 'user:2'
    state.widgets = []
    say('do it')
    await saysSoon(/A different layout is open now/)
    expect(scans()).toHaveLength(0)
    expect(state.widgets).toHaveLength(0)
  })

  it('a write failing MIDWAY is compensated: no new chart remains, the existing one is untouched', async () => {
    const { state, host, say, newCharts } = await mount({ failAddAt: 3 })
    envelopes.push(b => env('propose', [SCREEN(b), CHARTS(b, { from: 'screen1', top: 4 })]))
    say('Chart the top 4 with ADR above 10%.')
    await nth('agent-proposal', 1)
    say('do it')
    await saysSoon(/didn't take effect|didn't change anything/)
    expect(newCharts()).toHaveLength(0)
    expect(state.widgets.find(w => w.id === 'c')).toMatchObject(EXISTING)
    expect(host.charts.read('c').symbol).toBe('AAPL')
  }, 15000)
})

describe('Watchlist → Charts and the last screen → Charts', () => {
  it('a saved list is bound by id and read FRESH in its saved order at Apply; the list itself is never written', async () => {
    const { state, say, syms } = await mount()
    envelopes.push(b => env('propose', [
      { action: 'watchlist.show', target: LIST(b, 'Agent Test Watchlist'), args: { as: 'list1' } },
      CHARTS(b, { from: 'list1', top: 3 }, { timeframe: 'D' }),
    ]))
    say('Open my Agent Test Watchlist as charts.')
    const card = await nth('agent-proposal', 1)
    expect(card).toContain('Use the stocks in “Agent Test Watchlist” (its saved order) — read when you apply')
    expect(card).not.toMatch(/T0\d/)
    // Reordered by hand (another tab) after the proposal: Apply uses the NEW order.
    state.manual('m1', (wl) => { wl.items = [...wl.items].reverse() })
    const writes = () => state.server.calls.filter(c => c[0] !== 'GET')
    const w0 = writes().length
    say('do it')
    const rec = await nth('agent-receipt', 1)
    expect(syms()).toEqual(['T02', 'T01', 'T03'])
    expect(rec).toContain('Read “Agent Test Watchlist”: 3 stocks')
    expect(rec).toContain('Created 3 daily charts: T02, T01 and T03')
    expect(writes().length).toBe(w0)
    expect(state.server.lists[0].items.map(i => i.sym)).toEqual(['T02', 'T01', 'T03'])
  })

  it("the production model's measured shapes (2026-10-07): from = the LIST's own ref, or the consumer listed BEFORE its producer — both read the list fresh", async () => {
    const { state, say, syms } = await mount()
    envelopes.push(b => env('apply', [CHARTS(b, { from: LIST(b, 'Agent Test Watchlist'), top: 3 })]))
    say('Open my Agent Test Watchlist as charts.')
    expect(await nth('agent-proposal', 1)).toContain('Use the stocks in “Agent Test Watchlist” (its saved order) — read when you apply')
    state.manual('m1', (wl) => { wl.items = [...wl.items].reverse() })
    say('do it')
    expect(await nth('agent-receipt', 1)).toContain('Created 3 charts: T02, T01 and T03')
    expect(syms()).toEqual(['T02', 'T01', 'T03'])
    say('undo')
    await saysSoon(/Undid: Created 3 charts/)
    envelopes.push(b => env('apply', [
      CHARTS(b, { from: 'list1', top: 3 }),
      { action: 'watchlist.show', target: LIST(b, 'Agent Test Watchlist'), args: { as: 'list1' } },
    ]))
    say('Chart everything in Agent Test Watchlist.')
    await nth('agent-proposal', 2)
    say('do it')
    expect(await nth('agent-receipt', 3)).toContain('Created 3 charts: T02, T01 and T03')
  })

  it('a reference to a producer that is not in the plan, or to a target that produces nothing, is refused — nothing runs', async () => {
    const { say, newCharts } = await mount()
    envelopes.push(b => env('apply', [CHARTS(b, { from: 'list1', top: 3 })]))
    say('Chart my list.')
    await saysSoon(/“list1” isn't a result I can use here/)
    envelopes.push(b => env('apply', [CHARTS(b, { from: b.context.charts[0].ref, top: 3 })]))
    say('Chart that chart.')
    await saysSoon(/isn't a result I can use here[\s\S]*isn't a result I can use here/)
    expect(newCharts()).toHaveLength(0)
    expect(screen.queryByTestId('agent-proposal')).toBeNull()
  })

  it('PROVENANCE: the model is never the authority for a list — tickers copied from a NAMED list are bound back to it and read fresh at Apply; even though the model could see the contents', async () => {
    const { state, say, syms } = await mount()
    let seenCtx = null
    // The model copies the first two of the named list as literal tickers.
    envelopes.push(b => { seenCtx = b.context.watchlists; return env('apply', [CHARTS(b, ['T03', 'T01'])]) })
    say('Open the first two stocks in my Agent Test Watchlist as charts.')
    const card = await nth('agent-proposal', 1)
    expect(seenCtx[0]).toEqual(expect.objectContaining({ name: 'Agent Test Watchlist', count: 3 }))
    expect(seenCtx[0].symbols).toEqual(['T03', 'T01', 'T02'])                    // it SAW them — and is still not the authority
    expect(card).toContain('Use the stocks in “Agent Test Watchlist” (its saved order) — read when you apply')
    expect(card).not.toContain('T03')
    // Reordered AND renamed by hand before Apply: bound by id, read fresh.
    state.manual('m1', (wl) => { wl.items = [wl.items[2], wl.items[0], wl.items[1]]; wl.name = 'Renamed List' })
    say('do it')
    const rec = await nth('agent-receipt', 1)
    expect(syms()).toEqual(['T02', 'T03'])
    expect(rec).toContain('Read “Renamed List”: 3 stocks')
    expect(rec).toContain('Created 2 charts: T02 and T03')
  })

  it('PROVENANCE is narrow: explicit tickers stay literal, and a near-miss of a named list is not rebound', async () => {
    const { say, syms, newCharts } = await mount()
    envelopes.push(b => env('apply', [CHARTS(b, ['SPY', 'QQQ'])]))
    say('Add two daily charts for SPY and QQQ.')
    expect(await nth('agent-proposal', 1)).toContain('Create 2 charts: SPY and QQQ')
    say('do it')
    await nth('agent-receipt', 1)
    expect(syms()).toEqual(['SPY', 'QQQ'])
    say('undo')
    await saysSoon(/Undid: Created 2 charts/)
    expect(newCharts()).toHaveLength(0)
    // Names the list, but the tickers are NOT its first N in order → left as typed (shown in the proposal).
    envelopes.push(b => env('apply', [CHARTS(b, ['SPY', 'NVDA'])]))
    say('Chart SPY and NVDA next to my Agent Test Watchlist stuff.')
    expect(await nth('agent-proposal', 2)).toContain('Create 2 charts: SPY and NVDA')
  })

  it('PROVENANCE: ALL of a named list (copied) binds with top = its size', async () => {
    const { say, syms } = await mount()
    envelopes.push(b => env('apply', [CHARTS(b, ['T03', 'T01', 'T02'], { timeframe: '5' })]))
    say('Build 5-minute charts from everything in Agent Test Watchlist.')
    expect(await nth('agent-proposal', 1)).toContain('Use the stocks in “Agent Test Watchlist”')
    say('do it')
    expect(await nth('agent-receipt', 1)).toContain('Created 3 5-minute charts: T03, T01 and T02')
    expect(syms()).toEqual(['T03', 'T01', 'T02'])
  })

  it('a list deleted before Apply → refused; an empty list → nothing created', async () => {
    const { state, say, newCharts } = await mount({ lists: [...LISTS, { id: 'e1', name: 'Empty One', symbols: [] }] })
    envelopes.push(b => env('propose', [{ action: 'watchlist.show', target: LIST(b, 'Empty One'), args: { as: 'list1' } }, CHARTS(b, { from: 'list1', top: 4 })]))
    say('Chart Empty One.')
    await nth('agent-proposal', 1)
    say('do it')
    await saysSoon(/“Empty One” is empty, so I didn't create or change anything\./)
    expect(newCharts()).toHaveLength(0)

    envelopes.push(b => env('propose', [{ action: 'watchlist.show', target: LIST(b, 'Agent Test Watchlist'), args: { as: 'list1' } }, CHARTS(b, { from: 'list1', top: 3 })]))
    say('Chart Agent Test Watchlist.')
    await nth('agent-proposal', 2)
    state.server.lists = state.server.lists.filter(l => l.id !== 'm1')
    say('do it')
    await saysSoon(/I didn't change anything: .*(not found|couldn't find)/i)
    expect(newCharts()).toHaveLength(0)
  })

  it('the LAST screen run here feeds charts (re-run fresh at Apply)', async () => {
    const { say, syms } = await mount()
    envelopes.push(b => env('apply', [{ ...SCREEN(b), args: { ...SCREEN(b).args, as: null } }]))
    say('Show me stocks with ADR above 10%')
    await saysSoon(/9 stocks match/)
    envelopes.push(b => env('propose', [CHARTS(b, { from: 'lastScreen', top: 2 })]))
    say('Chart the top 2 of those.')
    await nth('agent-proposal', 1)
    const s0 = scans().length
    say('do it')
    await nth('agent-receipt', 1)
    expect(scans()).toHaveLength(s0 + 1)
    expect(syms()).toEqual(['T22', 'T23'])
  })

  it('STALE Undo: a created chart changed by hand afterwards blocks Undo', async () => {
    const { state, host, say, newCharts } = await mount()
    envelopes.push(b => env('propose', [SCREEN(b), CHARTS(b, { from: 'screen1', top: 2 })]))
    say('Chart the top 2 with ADR above 10%.')
    await nth('agent-proposal', 1)
    say('do it')
    await nth('agent-receipt', 1)
    host.charts.commit(newCharts()[0].id, { symbol: 'NVDA' })
    say('undo')
    await saysSoon(/has changed since I made that change/)
    expect(newCharts()).toHaveLength(2)
    expect(state.widgets).toHaveLength(3)
  })
})

describe('literal tickers and typed references', () => {
  it('literal tickers: proposal shows them; the model-typed tickers are looked up; dedup keeps the first', async () => {
    const { say, syms } = await mount()
    envelopes.push(b => env('apply', [CHARTS(b, ['spy', 'QQQ', 'SPY', 'NVDA'])]))
    say('Chart SPY, QQQ and NVDA.')
    expect(await nth('agent-proposal', 1)).toContain('Create 3 charts: SPY, QQQ and NVDA')    // always proposed
    say('do it')
    expect(await nth('agent-receipt', 1)).toContain('Created 3 charts: SPY, QQQ and NVDA')
    expect(syms()).toEqual(['SPY', 'QQQ', 'NVDA'])
    envelopes.push(b => env('apply', [CHARTS(b, ['SPY', 'ZZZZQ'])]))
    say('Chart SPY and ZZZZQ.')
    await saysSoon(/no symbol “ZZZZQ”/)
  })

  it('only { from, top } from an earlier producer or a standing source is a reference', () => {
    const add = (symbols) => [{ action: 'widget.addCharts', target: 'workspace', args: { symbols, timeframe: null, chart_type: null, exact: null } }]
    expect(checkRefs(add({ from: 'nope', top: 3 }))).toBe('“nope” isn\'t a result I can use here.')
    expect(checkRefs([{ action: 'watchlist.create', target: 'library', args: { name: 'X', as: 'new1' } }, ...add({ from: 'new1', top: 3 })])).toMatch(/isn't a result I can use/)
    expect(checkRefs(add({ from: 'screen1', top: 0 }))).toMatch(/isn't a result|between 1 and/)
    expect(expandOps(add({ from: 'screen1', top: 3, path: 'rows[0]' })).reason).toBe('“symbols” has the wrong kind of value')
    expect(expandOps(add('SPY')).reason).toBe('“symbols” has the wrong kind of value')
    expect(expandOps(add(Array.from({ length: 13 }, (_, i) => `S${i}`))).reason).toMatch(/more than 12 charts/)
  })

  it('the expansion is the ordinary creation ops (no second builder), counted as ONE request', () => {
    const x = expandOps([{ action: 'widget.addCharts', target: 'workspace', args: { symbols: ['SPY', 'QQQ'], timeframe: 'W', chart_type: null, exact: null } }])
    expect(x.ops.map(o => [o.action, o.target, o.args])).toEqual([
      ['widget.add', 'workspace', { type: 'chart', as: 'ac1x1' }], ['widget.add', 'workspace', { type: 'chart', as: 'ac1x2' }],
      ['chart.setSymbol', 'ac1x1', { symbol: 'SPY' }], ['chart.setSymbol', 'ac1x2', { symbol: 'QQQ' }],
      ['chart.setTimeframe', 'ac1x1', { timeframe: 'W' }], ['chart.setTimeframe', 'ac1x2', { timeframe: 'W' }],
    ])
    expect(getCapability('widget.addCharts').inputs).toEqual({ symbols: 'symbols' })
    expect(getCapability('watchlist.show').produces).toBe('symbols')
    const m = manifestFor({ surface: 'charts' })
    expect(m.find(c => c.name === 'widget.addCharts')).toBeTruthy()
    expect(m.some(c => c.name.startsWith('indicator.'))).toBe(false)
  })
})

describe('cross-session guard (host.boardInSync): another window/device changed this member\'s board', () => {
  it('buildBoardSync: same → ok; this tab\'s own save still in flight → ok after it lands; changed elsewhere / other layout open → refused; unreadable → never blocks', async () => {
    const { buildBoardSync, boardSig } = await import('./host')
    const local = { widgets: [{ id: 'a', type: 'chart', x: 0, y: 0, w: 12, h: 20, color: 'A', opts: { tf: 'D' } }] }
    let server = { sig: boardSig(local.widgets), epoch: 'user:1' }
    const sync = buildBoardSync({ readServer: async () => server, localLayout: () => local, localEpoch: () => 'user:1', settleMs: 5, tries: 2 })
    expect((await sync()).ok).toBe(true)
    // In flight: the server catches up after one settle.
    let n = 0
    const lagging = buildBoardSync({ readServer: async () => (n++ === 0 ? { sig: '[]', epoch: 'user:1' } : server), localLayout: () => local, localEpoch: () => 'user:1', settleMs: 5 })
    expect((await lagging()).ok).toBe(true)
    server = { sig: '[]', epoch: 'user:1' }
    expect(await sync()).toEqual({ ok: false, reason: 'this board was changed in another window or device' })
    server = { sig: boardSig(local.widgets), epoch: 'user:2' }
    expect(await sync()).toEqual({ ok: false, reason: 'a different layout was opened in another window or device' })
    const broken = buildBoardSync({ readServer: async () => { throw new Error('offline') }, localLayout: () => local, localEpoch: () => 'user:1' })
    expect(await broken()).toEqual({ ok: true, unchecked: true })
  })

  it('CASE A/B: a proposal applied after another session changed the board (or opened another layout) is refused BEFORE any source is read or widget written', async () => {
    const { host, say, newCharts, widgetOps } = await mount()
    host.epoch = () => 'user:1'
    let inSync = { ok: true }
    host.boardInSync = async () => inSync
    const add = vi.spyOn(widgetOps, 'add')
    envelopes.push(b => env('propose', [SCREEN(b), CHARTS(b, { from: 'screen1', top: 2 })]))
    say('Chart the top 2 with ADR above 10%.')
    await nth('agent-proposal', 1)
    inSync = { ok: false, reason: 'this board was changed in another window or device' }
    say('do it')
    await saysSoon(/I didn't change anything: this board was changed in another window or device\. Reload this page/)
    expect(scans()).toHaveLength(0)
    expect(add).not.toHaveBeenCalled()
    expect(newCharts()).toHaveLength(0)
  })

  it('CASE C: Undo after another session changed the board is refused — the Agent\'s charts stay, nothing is overwritten', async () => {
    const { host, say, newCharts } = await mount()
    host.epoch = () => 'user:1'
    let inSync = { ok: true }
    host.boardInSync = async () => inSync
    envelopes.push(b => env('propose', [SCREEN(b), CHARTS(b, { from: 'screen1', top: 2 })]))
    say('Chart the top 2 with ADR above 10%.')
    await nth('agent-proposal', 1)
    say('do it')
    await nth('agent-receipt', 1)
    inSync = { ok: false, reason: 'this board was changed in another window or device' }
    say('undo')
    await saysSoon(/I didn't undo anything: this board was changed in another window or device/)
    expect(newCharts()).toHaveLength(2)
  })
})

describe('ticker lookups: a ticker the proposal found KNOWN is not looked up again at Apply', () => {
  it('known → cached; unknown → asked every time', async () => {
    const { unknownSymbols, _resetKnownTickers } = await import('./agentClient')
    _resetKnownTickers()
    const n0 = calls.filter(c => c[1].startsWith('/api/ticker-search')).length
    expect([...(await unknownSymbols(['SPY', 'ZZZQ']))]).toEqual(['ZZZQ'])
    expect([...(await unknownSymbols(['SPY', 'ZZZQ']))]).toEqual(['ZZZQ'])
    const asked = calls.filter(c => c[1].startsWith('/api/ticker-search')).slice(n0).map(c => new URL(c[1], 'http://x').searchParams.get('q'))
    expect(asked).toEqual(['SPY', 'ZZZQ', 'ZZZQ'])
    _resetKnownTickers()
  })
})


describe('one thing at a time: Apply / Undo / a choice can never run alongside another request', () => {
  it('Apply clicked while a model reply is still coming does nothing; a double click applies once', async () => {
    const { say, newCharts, widgetOps } = await mount()
    const add = vi.spyOn(widgetOps, 'add')
    envelopes.push(b => env('propose', [CHARTS(b, ['SPY', 'QQQ'])]))
    say('Chart SPY and QQQ.')
    await nth('agent-proposal', 1)
    // A slow model turn is in flight (the member typed something else)…
    let release
    const gate = new Promise(r => { release = r })
    const realFetch = globalThis.fetch
    globalThis.fetch = vi.fn(async (url, init) => {
      if (url === '/api/agent/turn') await gate
      return realFetch(url, init)
    })
    envelopes.push(() => env('answer', [], 'An EMA weights recent prices more.'))
    say('what is an EMA?')
    const apply = screen.getAllByRole('button', { name: 'Apply' })[0]
    expect(apply.disabled).toBe(true)
    fireEvent.click(apply)                                    // ignored: the lock is held
    await new Promise(r => setTimeout(r, 50))
    expect(add).not.toHaveBeenCalled()
    release()
    await saysSoon(/An EMA weights recent prices more/)
    expect(add).not.toHaveBeenCalled()                        // the stale card was replaced, never applied
    envelopes.push(b => env('propose', [CHARTS(b, ['SPY', 'QQQ'])]))
    say('Chart SPY and QQQ.')
    await nth('agent-proposal', 2)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Apply' }).disabled).toBe(false))
    const btn = screen.getByRole('button', { name: 'Apply' })
    fireEvent.click(btn)
    fireEvent.click(btn)                                      // a double click
    await nth('agent-receipt', 1)
    expect(newCharts()).toHaveLength(2)
    expect(add).toHaveBeenCalledTimes(2)                      // two charts, created once
  })
})
