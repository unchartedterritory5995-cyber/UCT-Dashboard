import { describe, it, expect } from 'vitest'
import { manifestFor, buildContext } from './capabilities'
import { registerBuiltins } from './builtins'
import { planOps, collectTargets } from './executor'
import { decideMode } from './policy'
import { commitPlan, undoEntry } from './runtime'
import { fastParse } from './fastPath'
import { makeBoard } from './__fixtures__/board'

registerBuiltins()
const CTX = { surface: 'charts' }

const wsPlan = (host, ops, env = {}) => planOps(collectTargets(host, ['workspace', 'chart']), ops, env, CTX)
const addOp = (type, as = null) => ({ action: 'widget.add', target: 'workspace', args: { type, as } })
const BASE = () => makeBoard([{ id: 'c', type: 'chart', x: 0, y: 0, w: 12, h: 20 }])
// The model's plan for "Add N charts, all <tf>, with these symbols".
const build = (syms, tf = '5') => [
  ...syms.map((_, i) => addOp('chart', `new${i + 1}`)),
  ...syms.map((_, i) => ({ action: 'chart.setTimeframe', target: `new${i + 1}`, args: { timeframe: tf } })),
  ...syms.map((s, i) => ({ action: 'chart.setSymbol', target: `new${i + 1}`, args: { symbol: s } })),
]
const newCharts = (state) => state.widgets.filter(w => w.id !== 'c')

describe('widget.add (single)', () => {
  it('is discovered through the manifest and the workspace context', () => {
    expect(manifestFor(CTX).map(c => c.name)).toContain('widget.add')
    const { host } = BASE()
    const { context, refMap } = buildContext(host, CTX)
    expect(context.workspace[0]).toMatchObject({ ref: 'w1', widgetCount: 1, widgetLimit: 16 })
    expect(context.workspace[0].openSlots.chart).toBeGreaterThan(0)
    expect(refMap.w1).toEqual({ kind: 'workspace', ref: 'workspace' })
  })
  it('adds into empty space, ACKs the new widget, and Undo closes exactly it', async () => {
    const { host, state } = BASE()
    const p = wsPlan(host, [addOp('watchlist')])
    expect(p.ok).toBe(true)
    expect(decideMode('apply', p)).toBe('apply')
    expect(p.lines).toEqual(['Added a Watchlist'])
    const res = await commitPlan(host, p)
    expect(res.ok).toBe(true)
    expect(state.widgets.map(w => w.type)).toEqual(['chart', 'watchlist'])
    expect((await undoEntry(host, res.undo)).ok).toBe(true)
    expect(state.widgets.map(w => w.id)).toEqual(['c'])
  })
  it('fast path: "add a watchlist" / "add another chart"', () => {
    expect(fastParse('add a watchlist').ops[0]).toEqual({ action: 'widget.add', args: { type: 'watchlist', as: null } })
    expect(fastParse('add another chart').ops[0]).toEqual({ action: 'widget.add', args: { type: 'chart', as: null } })
    expect(fastParse('add a watchlist with my tech stocks')).toBeNull()
  })
})

describe('compound creation: several charts, each configured, one transaction', () => {
  it('HAPPY PATH: 4 charts, all 5-minute, SPY/QQQ/NVDA/TSLA — proposal, exactly four, one Undo', async () => {
    // An empty board: the product's own placement puts four charts in empty
    // space (two columns). The existing link group A keeps its symbol.
    const { host, state } = makeBoard([])
    const before = JSON.stringify(state.widgets)
    const p = wsPlan(host, build(['SPY', 'QQQ', 'NVDA', 'TSLA']))
    expect(p.ok).toBe(true)
    expect(decideMode('apply', p)).toBe('propose')
    expect(p.lines).toEqual([
      'Added 4 Charts (not linked — each keeps its own symbol)',
      'All 4 new: Switched timeframe to 5 minutes',
      'New chart 1: Changed symbol to SPY', 'New chart 2: Changed symbol to QQQ',
      'New chart 3: Changed symbol to NVDA', 'New chart 4: Changed symbol to TSLA',
    ])
    expect(JSON.stringify(state.widgets)).toBe(before)
    const res = await commitPlan(host, p)
    expect(res.ok).toBe(true)
    const made = newCharts(state)
    expect(made).toHaveLength(4)
    expect(made.map(w => host.charts.read(w.id).symbol)).toEqual(['SPY', 'QQQ', 'NVDA', 'TSLA'])
    expect(made.every(w => w.opts.tf === '5' && w.color === 'N')).toBe(true)
    expect(state.groupSyms.A).toBe('AAPL')
    expect(res.lines).toEqual(p.lines)
    const u = await undoEntry(host, res.undo)
    expect(u.ok).toBe(true)
    expect(state.widgets).toEqual([])
  })
  it('the count is not special: 2 charts works the same way', async () => {
    const { host, state } = BASE()
    const res = await commitPlan(host, wsPlan(host, build(['IBM', 'DIA'], 'W')))
    expect(res.ok).toBe(true)
    expect(newCharts(state).map(w => host.charts.read(w.id).symbol)).toEqual(['IBM', 'DIA'])
    expect(state.widgets[0]).toMatchObject({ id: 'c', x: 0, y: 0, w: 12, h: 20 })   // the existing chart: untouched
    expect(host.charts.read('c').symbol).toBe('AAPL')                                // and so is its symbol
  })
  it('the order and names the production model actually emits: interleaved per chart, free-form aliases', async () => {
    const { host, state } = BASE()
    const ops = ['IBM', 'DIA'].flatMap(s => [
      addOp('chart', `${s.toLowerCase()}_chart`),
      { action: 'chart.setSymbol', target: `${s.toLowerCase()}_chart`, args: { symbol: s } },
      { action: 'chart.setTimeframe', target: `${s.toLowerCase()}_chart`, args: { timeframe: '5' } },
    ])
    const res = await commitPlan(host, wsPlan(host, ops))
    expect(res.ok).toBe(true)
    expect(newCharts(state).map(w => [host.charts.read(w.id).symbol, host.charts.read(w.id).tf])).toEqual([['IBM', '5'], ['DIA', '5']])
  })
  it('an INVALID symbol refuses the whole plan before any widget exists', () => {
    const { host, state } = BASE()
    const p = wsPlan(host, build(['SPY', 'ZZZZQ']), { unknownSymbols: new Set(['ZZZZQ']) })
    expect(p.ok).toBe(false)
    expect(p.refusals[0].reason).toMatch(/no symbol “ZZZZQ”/)
    expect(state.widgets).toHaveLength(1)
  })
  it('the 16-widget limit is enforced before mutation', () => {
    const tiles = Array.from({ length: 14 }, (_, i) => ({ id: `x${i}`, type: 'news', x: (i % 7) * 3, y: Math.floor(i / 7) * 3, w: 3, h: 3 }))
    const { host, state } = makeBoard(tiles)
    const p = wsPlan(host, build(['SPY', 'QQQ', 'NVDA']))
    expect(p.ok).toBe(false)
    expect(p.refusals.some(r => /holds 16/.test(r.reason))).toBe(true)
    expect(state.widgets).toHaveLength(14)
  })
  it('not enough open space → refused before mutation; nothing moved or resized', () => {
    // Half the board is empty: the product places TWO charts there; a third
    // would shrink the existing chart — so four is refused, with the real room.
    const { host, state } = BASE()
    const before = JSON.stringify(state.widgets)
    const p = wsPlan(host, build(['SPY', 'QQQ', 'NVDA', 'TSLA']))
    expect(p.ok).toBe(false)
    expect(p.refusals[0].reason).toBe("There isn't enough open space to add 4 widgets without rearranging your current workspace (room for 2 more Charts).")
    expect(JSON.stringify(state.widgets)).toBe(before)
  })
  it('a failure after the first write is COMPENSATED: no half-built board, honest failure', async () => {
    const { host, state } = makeBoard([], { A: 'AAPL' }, { failAddAt: 3 })
    const p = wsPlan(host, build(['SPY', 'QQQ', 'NVDA', 'TSLA']))
    expect(p.ok).toBe(true)
    const res = await commitPlan(host, p)
    expect(res.ok).toBe(false)
    expect(res.compensated).toBe(true)
    expect(res.failed[0].reason).toMatch(/nothing was left changed/)
    expect(res.undo).toBeNull()
    expect(state.widgets).toEqual([])                              // the two that landed were closed
  })
  it('stale undo: a manual edit to a NEW chart blocks undo; moving an UNRELATED widget does not', async () => {
    const a = BASE()
    const r1 = await commitPlan(a.host, wsPlan(a.host, build(['SPY', 'QQQ'])))
    const id = newCharts(a.state)[1].id
    a.state.widgets = a.state.widgets.map(w => (w.id === id ? { ...w, opts: { ...w.opts, tf: '60' } } : w))
    expect((await undoEntry(a.host, r1.undo)).ok).toBe(false)
    expect(newCharts(a.state)).toHaveLength(2)

    const b = BASE()
    const r2 = await commitPlan(b.host, wsPlan(b.host, build(['SPY', 'QQQ'])))
    b.state.widgets = b.state.widgets.map(w => (w.id === 'c' ? { ...w, h: 18 } : w))
    expect((await undoEntry(b.host, r2.undo)).ok).toBe(true)
    expect(b.state.widgets.map(w => w.id)).toEqual(['c'])
  })
  it('a chart that gets NO symbol keeps the product default link (no invented linking)', async () => {
    const { host, state } = BASE()
    const p = wsPlan(host, [addOp('chart', 'new1'), { action: 'chart.setTimeframe', target: 'new1', args: { timeframe: '5' } }])
    expect(p.lines[0]).toBe('Added a Chart')
    await commitPlan(host, p)
    expect(newCharts(state)[0].color).toBe('A')
  })
  it('an alias used before it is created, and creation mixed with existing changes, are refused', () => {
    const { host } = BASE()
    expect(wsPlan(host, [{ action: 'chart.setSymbol', target: 'new1', args: { symbol: 'SPY' } }, addOp('chart', 'new1')]).ok).toBe(false)
    const mixed = wsPlan(host, [addOp('chart', 'new1'), { action: 'chart.setType', target: 'c', args: { type: 'bars' } }])
    expect(mixed.ok).toBe(false)
    expect(mixed.refusals[0].reason).toMatch(/two steps/)
  })
})
