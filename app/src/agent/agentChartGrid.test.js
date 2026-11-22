// LIVE TEST 2026-10-28 — "Create four charts for SPY, QQQ, NVDA and TSLA and make them all daily charts" on a
// board whose ONE chart fills the workspace. chartGrid.set (agent/chartGrid.js + capabilities/board.js) through
// the REAL planner, policy, runtime and Undo, on the fixture board (the product's placement and board writer).
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { registerBuiltins } from './builtins'
import { planOps, collectTargets, prepareOps } from './executor'
import { decideMode } from './policy'
import { commitPlan, undoEntry } from './runtime'
import { planChartGrid } from './chartGrid'
import { multiChartPlan } from './multiChart'
import { boardProblems } from '../pages/charts/placement/arrange'
import { makeBoard } from './__fixtures__/board'

registerBuiltins()
const CTX = { surface: 'charts' }
const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } })
beforeEach(() => {
  // the ticker search knows every symbol but ZZZZ
  globalThis.fetch = vi.fn(async (url) => {
    const q = /ticker-search\?q=([^&]+)/.exec(String(url))
    if (q) return json({ results: decodeURIComponent(q[1]) === 'ZZZZ' ? [] : [{ ticker: decodeURIComponent(q[1]) }] })
    return json({})
  })
})
const grid = (symbols, timeframe = null, layout = null) => ({ action: 'chartGrid.set', target: 'board', args: { symbols, timeframe, layout, new_charts: null, watchlist: null, replace: null } })
async function plan(b, ops) {
  const env = await prepareOps(ops)
  return { p: planOps(collectTargets(b.host, ['board']), ops, env, CTX), env }
}
const charts = (b) => b.state.widgets.filter(w => w.type === 'chart')
const symOf = (b, w) => b.host.charts.read(w.id).symbol
const cells = (b) => charts(b).map(w => [w.x, w.y, w.w, w.h]).sort((p, q) => (p[1] - q[1]) || (p[0] - q[0]))
const ONE = () => makeBoard([{ id: 'c1', type: 'chart', x: 0, y: 0, w: 24, h: 20, color: 'A' }], { A: 'AAPL' })

describe('chartGrid.set — one full-board chart → four equal daily charts', () => {
  it('reuses the chart, adds three, a 2×2 grid of equal cells; applied (no card); ONE Undo restores the board', async () => {
    const b = ONE()
    const before = JSON.stringify(b.state.widgets)
    const { p, env } = await plan(b, [grid(['SPY', 'QQQ', 'NVDA', 'TSLA'], 'D')])
    expect(p.ok).toBe(true)
    expect(p.lines).toEqual(['Set up four daily charts for SPY, QQQ, NVDA and TSLA in a 2×2 grid (1 reused, 3 new)'])
    expect(decideMode('apply', p)).toBe('apply')
    const res = await commitPlan(b.host, p, { env })
    expect(res.ok).toBe(true)
    expect(charts(b)).toHaveLength(4)
    expect(cells(b)).toEqual([[0, 0, 12, 10], [12, 0, 12, 10], [0, 10, 12, 10], [12, 10, 12, 10]])
    const inOrder = [...charts(b)].sort((p2, q) => (p2.y - q.y) || (p2.x - q.x))
    expect(inOrder.map(w => symOf(b, w))).toEqual(['SPY', 'QQQ', 'NVDA', 'TSLA'])
    expect(inOrder.map(w => b.host.charts.read(w.id).tf)).toEqual(['D', 'D', 'D', 'D'])
    expect(boardProblems(b.state.widgets, 24, 20)).toEqual([])
    // one logical Undo: the three new charts closed, the first back to the whole board on AAPL
    expect(res.undo.items).toHaveLength(1)
    expect((await undoEntry(b.host, res.undo)).ok).toBe(true)
    expect(JSON.stringify(b.state.widgets)).toBe(before)
    expect(symOf(b, b.state.widgets[0])).toBe('AAPL')
  })

  it('other widgets are never moved or removed: a chart beside a watchlist is tiled inside its own area', async () => {
    const b = makeBoard([{ id: 'c1', type: 'chart', x: 0, y: 0, w: 18, h: 20, color: 'N' }, { id: 'wl', type: 'watchlist', x: 18, y: 0, w: 6, h: 20 }], { 'N:c1': 'AAPL' })
    const { p, env } = await plan(b, [grid(['SPY', 'QQQ', 'NVDA', 'TSLA'], 'D')])
    expect(p.ok).toBe(true)
    expect((await commitPlan(b.host, p, { env })).ok).toBe(true)
    expect(b.state.widgets.find(w => w.id === 'wl')).toMatchObject({ x: 18, y: 0, w: 6, h: 20 })
    expect(cells(b)).toEqual([[0, 0, 9, 10], [9, 0, 9, 10], [0, 10, 9, 10], [9, 10, 9, 10]])
  })

  it('enough charts already: each shows its ticker, nothing moves or is added', async () => {
    const quad = makeBoard([
      { id: 'a', type: 'chart', x: 0, y: 0, w: 12, h: 10, color: 'N' }, { id: 'b', type: 'chart', x: 12, y: 0, w: 12, h: 10, color: 'N' },
      { id: 'c', type: 'chart', x: 0, y: 10, w: 12, h: 10, color: 'N' }, { id: 'd', type: 'chart', x: 12, y: 10, w: 12, h: 10, color: 'N' },
    ], { 'N:a': 'AAPL', 'N:b': 'AMD', 'N:c': 'MSFT', 'N:d': 'META' })
    const { p, env } = await plan(quad, [grid(['SPY', 'QQQ', 'NVDA', 'TSLA'], 'W')])
    expect(p.lines).toEqual(['Set up four weekly charts for SPY, QQQ, NVDA and TSLA'])
    expect((await commitPlan(quad.host, p, { env })).ok).toBe(true)
    expect(['a', 'b', 'c', 'd'].map(id => quad.host.charts.read(id).symbol)).toEqual(['SPY', 'QQQ', 'NVDA', 'TSLA'])
    expect(quad.state.widgets).toHaveLength(4)
  })

  it('two charts in one link group are unlinked so each can show its own ticker (and relinked by Undo)', async () => {
    const b = makeBoard([{ id: 'l', type: 'chart', x: 0, y: 0, w: 12, h: 20, color: 'A' }, { id: 'r', type: 'chart', x: 12, y: 0, w: 12, h: 20, color: 'A' }], { A: 'AAPL' })
    const { p, env } = await plan(b, [grid(['NVDA', 'AMD'], null, 'columns')])
    expect(p.ok).toBe(true)
    const res = await commitPlan(b.host, p, { env })
    expect(res.ok).toBe(true)
    expect([symOf(b, { id: 'l' }), symOf(b, { id: 'r' })]).toEqual(['NVDA', 'AMD'])
    expect(b.state.widgets.find(w => w.id === 'l').color).toBe('A')
    expect(b.state.widgets.find(w => w.id === 'r').color).toBe('N')
    expect((await undoEntry(b.host, res.undo)).ok).toBe(true)
    expect(b.state.widgets.map(w => w.color)).toEqual(['A', 'A'])
    expect(symOf(b, { id: 'l' })).toBe('AAPL')
  })

  it('refused in one sentence, before anything is written: an unknown ticker, a duplicate, too many for the space', async () => {
    const b = ONE()
    expect((await plan(b, [grid(['SPY', 'ZZZZ'])])).p.refusals[0].reason).toMatch(/UCT has no symbol “ZZZZ”/)
    expect((await plan(b, [grid(['SPY', 'SPY'])])).p.refusals[0].reason).toMatch(/named twice/)
    const tight = makeBoard([{ id: 'c1', type: 'chart', x: 0, y: 0, w: 3, h: 6, color: 'N' }, { id: 'wl', type: 'watchlist', x: 3, y: 0, w: 21, h: 20 }, { id: 'n2', type: 'news', x: 0, y: 6, w: 3, h: 14 }], { 'N:c1': 'AAPL' })
    const r = (await plan(tight, [grid(['SPY', 'QQQ', 'NVDA', 'TSLA'])])).p
    expect(r.ok).toBe(false)
    expect(r.refusals[0].reason).toMatch(/isn't room for 4 equal charts/)
    expect(tight.state.boardWrites || 0).toBe(0)
  })

  it('a step that does not land takes back everything before it: the board is exactly as it was', async () => {
    const b = makeBoard([{ id: 'c1', type: 'chart', x: 0, y: 0, w: 24, h: 20, color: 'A' }], { A: 'AAPL' }, { failAddAt: 2 })
    const before = JSON.stringify(b.state.widgets)
    const { p, env } = await plan(b, [grid(['SPY', 'QQQ', 'NVDA', 'TSLA'], 'D')])
    const res = await commitPlan(b.host, p, { env })
    expect(res.ok).toBe(false)
    expect(res.failed[0].reason).toMatch(/nothing was left changed/)
    expect(JSON.stringify(b.state.widgets)).toBe(before)
  }, 15000)
})

describe('planChartGrid (pure)', () => {
  const minOf = () => ({ minW: 2, minH: 3 })
  const charts = new Map([['c1', { ref: 'c1', symbol: 'AAPL', tf: 'D' }]])
  it('one full chart + 4 tickers → 2×2 cells, the reused chart first', () => {
    const g = planChartGrid({ board: [{ id: 'c1', type: 'chart', x: 0, y: 0, w: 24, h: 20, color: 'A' }], charts, symbols: ['spy', 'qqq', 'nvda', 'tsla'], timeframe: 'D', cols: 24, rows: 20, minOf, maxWidgets: 16 })
    expect(g.ok).toBe(true)
    expect(g.set.c1).toEqual({ x: 0, y: 0, w: 12, h: 10 })
    expect(g.add.map(a => a.symbol)).toEqual(['QQQ', 'NVDA', 'TSLA'])
    expect(g.shape).toEqual({ rows: 2, cols: 2 })
  })
  it('the workspace limit is said with the numbers', () => {
    const many = Array.from({ length: 15 }, (_, i) => ({ id: `w${i}`, type: 'news', x: 0, y: 0, w: 1, h: 1 }))
    const g = planChartGrid({ board: [...many, { id: 'c1', type: 'chart', x: 0, y: 0, w: 24, h: 20 }], charts, symbols: ['A1', 'B1', 'C1'], cols: 24, rows: 20, minOf, maxWidgets: 16 })
    expect(g.reason).toMatch(/A board holds at most 16 widgets, and this one would hold \d+\. Close a widget before adding another\./)
  })
})
// AUTOTEST chart-grid-01 — "I want SPY, QQQ, NVDA and TSLA side by side, four equal charts" was refused with no model call:
// four columns of a chart beside a Watchlist are under a chart's minimum width. A line of charts is a layout, not the request.
describe('chartGrid.set — a line of charts that cannot hold them becomes the even grid, and says so', () => {
  // the product's own minimum (widgets/registry: chart minW 6, minH 6); the fixture board's default is smaller
  const real = { minOf: () => ({ minW: 6, minH: 6 }) }
  const beside = () => makeBoard([{ id: 'c1', type: 'chart', x: 0, y: 0, w: 18, h: 20, color: 'N' }, { id: 'wl', type: 'watchlist', x: 18, y: 0, w: 6, h: 20 }], { 'N:c1': 'AAPL' }, real)
  const whole = () => makeBoard([{ id: 'c1', type: 'chart', x: 0, y: 0, w: 24, h: 20, color: 'A' }], { A: 'AAPL' }, real)
  const FOUR = ['SPY', 'QQQ', 'NVDA', 'TSLA']

  it('four "side by side" beside a Watchlist: a 2×2 in the charts\' area, the receipt says why, one Undo restores', async () => {
    const b = beside()
    const before = JSON.stringify(b.state.widgets)
    const { p, env } = await plan(b, [grid(FOUR, null, 'columns')])
    expect(p.ok).toBe(true)
    expect(p.lines[0]).toBe('Set up four charts for SPY, QQQ, NVDA and TSLA in a 2×2 grid, because four side by side would be too narrow (1 reused, 3 new)')
    const res = await commitPlan(b.host, p, { env })
    expect(res.ok).toBe(true)
    expect(cells(b)).toEqual([[0, 0, 9, 10], [9, 0, 9, 10], [0, 10, 9, 10], [9, 10, 9, 10]])
    expect(b.state.widgets.find(w => w.id === 'wl')).toMatchObject({ x: 18, y: 0, w: 6, h: 20 })
    expect((await undoEntry(b.host, res.undo)).ok).toBe(true)
    expect(JSON.stringify(b.state.widgets)).toBe(before)
  })
  it('four "stacked" on a board too short for four rows: the same, in the words of a stack', async () => {
    const b = whole()
    const { p } = await plan(b, [grid(FOUR, null, 'rows')])
    expect(p.ok).toBe(true)
    expect(p.lines[0]).toMatch(/in a 2×2 grid, because four stacked would be too short/)
  })
  it('five that cannot share a row: three above two, on the board\'s even grid', async () => {
    const b = whole()
    const { p, env } = await plan(b, [grid(['SPY', 'QQQ', 'NVDA', 'TSLA', 'AMD'], null, 'columns')])
    expect(p.ok).toBe(true)
    expect(p.lines[0]).toMatch(/because five side by side would be too narrow/)
    expect((await commitPlan(b.host, p, { env })).ok).toBe(true)
    expect(charts(b)).toHaveLength(5)
    expect(boardProblems(b.state.widgets, 24, 20)).toEqual([])
  })
  it('NEGATIVE: a line that fits stays a line, with no explanation', async () => {
    for (const [symbols, layout, word] of [[['SPY', 'QQQ', 'NVDA'], 'columns', 'side by side'], [['SPY', 'QQQ'], 'columns', 'side by side'], [['SPY', 'QQQ', 'NVDA'], 'rows', 'stacked']]) {
      const { p } = await plan(beside(), [grid(symbols, null, layout)])
      expect(p.ok).toBe(true)
      expect(p.lines[0]).toContain(word)
      expect(p.lines[0]).not.toMatch(/because/)
    }
  })
  it('NEGATIVE: four columns that DO fit a whole board stay four columns', async () => {
    const { p } = await plan(whole(), [grid(FOUR, null, 'columns')])
    expect(p.lines[0]).toContain('side by side')
    expect(p.lines[0]).not.toMatch(/because/)
  })
  it('NEGATIVE: when the even grid cannot hold them either, the refusal stands and nothing is planned', async () => {
    const tight = makeBoard([{ id: 'c1', type: 'chart', x: 0, y: 0, w: 8, h: 8, color: 'N' }, { id: 'n1', type: 'news', x: 8, y: 0, w: 16, h: 8 }, { id: 'n2', type: 'news', x: 0, y: 8, w: 24, h: 12 }], { 'N:c1': 'AAPL' }, real)
    const { p } = await plan(tight, [grid(FOUR, null, 'columns')])
    expect(p.ok).toBe(false)
    expect(p.refusals[0].reason).toMatch(/There isn't room for 4 equal charts/)
  })
  it('NEGATIVE: an unknown ticker is refused by name, whatever the shape', async () => {
    const { p } = await plan(beside(), [grid(['SPY', 'ZZZZ', 'NVDA', 'TSLA'], null, 'columns')])
    expect(p.ok).toBe(false)
    expect(p.refusals[0].reason).toContain('ZZZZ')
  })
  it('AUDIT D2: a bare "grid" can be the board itself, so it never outranks the shape the member asked for', () => {
    const host = beside().host
    const layoutOf = (t) => multiChartPlan(t, { host })?.ops?.[0]?.args?.layout
    expect(layoutOf('put NVDA and AMD stacked on the grid')).toBe('rows')
    expect(layoutOf('put NVDA, AMD and TSLA side by side in my grid')).toBe('columns')
    for (const t of ['put NVDA, AMD, TSLA and SPY side by side in a grid', 'NVDA, AMD, TSLA and SPY stacked as a grid', 'NVDA, AMD, TSLA and SPY side by side in a 2x2', 'NVDA, AMD, TSLA and SPY stacked in a quad']) expect(layoutOf(t), t).toBe('grid')
    expect(layoutOf('grid of NVDA, AMD and TSLA')).toBe('grid')
  })
  it('the reflow note counts every chart tiled, kept ones included', async () => {
    const { p } = await plan(whole(), [{ ...grid(['SPY', 'QQQ', 'NVDA', 'TSLA'], null, 'columns'), args: { ...grid(['SPY', 'QQQ', 'NVDA', 'TSLA'], null, 'columns').args, new_charts: true } }])
    expect(p.ok).toBe(true)
    expect(p.lines[0]).toMatch(/because five side by side would be too narrow/)
  })
  it('the instant reader: the same sentence and its variations reach this plan; a shape stated outright wins', () => {
    const host = beside().host
    const layoutOf = (t) => multiChartPlan(t, { host })?.ops?.[0]?.args?.layout
    for (const t of ['I want SPY, QQQ, NVDA and TSLA side by side, four equal charts', 'put SPY QQQ NVDA TSLA in a row']) expect(layoutOf(t), t).toBe('columns')
    expect(multiChartPlan('SPY, QQQ, NVDA and TSLA next to each other', { host })).toBeNull()      // not read here: the model's
    for (const t of ['SPY, QQQ, NVDA and TSLA side by side in a 2x2 grid', 'put SPY, QQQ, NVDA and TSLA in a grid, side by side']) expect(layoutOf(t), t).toBe('grid')
  })
})
