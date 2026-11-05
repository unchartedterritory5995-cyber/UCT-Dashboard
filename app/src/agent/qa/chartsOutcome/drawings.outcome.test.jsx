// CHARTS OUTCOME 1 — drawings: the state in the REAL drawings store (drawingsStore.peekDrawings), by symbol.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import * as store from '../../../components/chart/drawingsStore'
import { open, outcomeSuite, afterEachOutcome, QUAD, QUAD_SYMS, chart, chartAt, selectedChart, drawingsOf, must, waitFor, proposalsNow } from './outcomeHarness'

vi.mock('../../../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
await outcomeSuite()
afterEach(afterEachOutcome)
beforeEach(() => { for (const s of ['SPY', 'QQQ', 'NVDA', 'TSLA']) store.clearAll(s) })

const peek = (s) => store.peekDrawings(s)
const quad = (o = {}) => open(QUAD(), QUAD_SYMS, { extra: { drawings: true }, ...o })
const LINE = (ctx, symbol, price = 200) => ({ action: 'drawing.addLevel', target: drawingsOf(ctx, symbol).ref, args: { price, color: null, style: null } })
const TREND = (ctx, symbol) => ({ action: 'drawing.addTrendline', target: drawingsOf(ctx, symbol).ref, args: { from: { date: '2026-10-01', price: 100 }, to: { date: '2026-10-20', price: 120 }, color: null, style: null } })
const recent = (ctx, symbol) => must(drawingsOf(ctx, symbol).drawings.find(d => d.recent), `recent drawing on ${symbol}`)
const STYLE = (ctx, symbol, args) => ({ action: 'drawing.style', target: drawingsOf(ctx, symbol).ref, args: { drawing: recent(ctx, symbol).id, color: null, style: null, width: null, ...args } })
const REMOVE = (ctx, symbol, id = null) => ({ action: 'drawing.remove', target: drawingsOf(ctx, symbol).ref, args: { drawing: id ?? recent(ctx, symbol).id } })

describe('adding: the right symbol, the real store, a truthful receipt', () => {
  it('"this chart" with four on the board: a trendline and a horizontal line land only on the clicked chart\'s symbol', async () => {
    const m = quad({ selected: 'bl' })
    await m.say('draw a horizontal line at 200 on this chart', (c) => [LINE(c, selectedChart(c).symbol)])
    await m.say('and a trendline from Oct 1 at 100 to Oct 20 at 120 on this chart', (c) => [TREND(c, selectedChart(c).symbol)])
    await waitFor(() => expect(peek('NVDA').map(d => d.type)).toEqual(['horizontal', 'trendline']))
    expect(peek('NVDA')[0]).toMatchObject({ points: [{ price: 200 }] })
    expect(peek('NVDA')[1].points).toEqual([{ time: '2026-10-01', price: 100 }, { time: '2026-10-20', price: 120 }])
    for (const s of ['SPY', 'QQQ', 'TSLA']) expect(peek(s)).toEqual([])
    expect(m.p.summaries().join(' ')).toMatch(/horizontal line at \$200 on NVDA/)
    expect(m.lastReceipt().textContent).toMatch(/trendline on NVDA/)
  })
  it('"the top-left chart": the chart\'s position leads to the entry for ITS symbol', async () => {
    const m = quad()
    await m.say('draw a line at 200 on the top-left chart', (c) => [LINE(c, chartAt(c, 'top-left').symbol)])
    await waitFor(() => expect(peek('SPY')).toHaveLength(1))
    expect(peek('NVDA')).toEqual([])
    expect(m.lastReceipt().textContent).toMatch(/on SPY/)
  })
  it('two charts on one symbol share the drawing, and the receipt\'s claim holds for both', async () => {
    const m = open([chart('a', 0, 0, 12, 20), chart('b', 12, 0, 12, 20)], { 'N:a': 'NVDA', 'N:b': 'NVDA' }, { extra: { drawings: true } })
    await m.say('draw a trendline from Oct 1 at 100 to Oct 20 at 120 on the left chart', (c) => [TREND(c, 'NVDA')])
    await waitFor(() => expect(peek('NVDA')).toHaveLength(1))
    expect(m.lastReceipt().textContent).toMatch(/on every chart showing NVDA/)
    await m.say('list the drawings', (c) => { expect(drawingsOf(c, 'NVDA').shownOn).toHaveLength(2); return [{ action: 'drawing.list', target: drawingsOf(c, 'NVDA').ref, args: {} }] })
  })
  it('a refused level writes nothing and the panel does not claim one', async () => {
    const m = quad({ selected: 'bl' })
    await m.say('draw a line at 200', (c) => [LINE(c, 'NVDA')])
    await waitFor(() => expect(peek('NVDA')).toHaveLength(1))
    const out = await m.say('draw a line at 200 again', (c) => [LINE(c, 'NVDA')])
    expect(out).toMatch(/already a horizontal line at \$200/)
    expect(peek('NVDA')).toHaveLength(1)
  })
})

describe('restyle and the natural follow-up: "it" is the drawing just made', () => {
  it('"make it red and dashed" reaches the line just drawn through the recent mark; the other line is untouched; Undo restores it', async () => {
    const m = quad({ selected: 'bl' })
    await m.say('draw a line at 150', (c) => [LINE(c, 'NVDA', 150)])
    await m.say('draw a line at 200', (c) => [LINE(c, 'NVDA', 200)])
    await waitFor(() => expect(peek('NVDA')).toHaveLength(2))
    const [first, second] = peek('NVDA')
    await m.say('make it red and dashed', (c) => { expect(recent(c, 'NVDA').id).toBe(second.id); return [STYLE(c, 'NVDA', { color: 'red', style: 'dashed' })] })
    await waitFor(() => expect(peek('NVDA').find(d => d.id === second.id).lineStyle).toBe('dashed'))
    expect(peek('NVDA').find(d => d.id === first.id)).toEqual(first)
    expect(m.lastReceipt().textContent).toMatch(/colour red, dashed/)
    await m.say('undo')
    await waitFor(() => expect(peek('NVDA').find(d => d.id === second.id).lineStyle).toBe(undefined))
    expect(peek('NVDA').find(d => d.id === second.id).color).toBe(second.color)
  })
})

describe('delete and Undo', () => {
  it('one visible drawing goes at once with Undo (owner rule 2026-10-27), and Undo brings the same drawing back', async () => {
    const m = quad({ selected: 'bl' })
    await m.say('draw a trendline', (c) => [TREND(c, 'NVDA')])
    await waitFor(() => expect(peek('NVDA')).toHaveLength(1))
    const before = peek('NVDA')[0]
    await m.say('delete it', (c) => [REMOVE(c, 'NVDA')])
    await waitFor(() => expect(peek('NVDA')).toEqual([]))
    expect(m.pending()).toBe(0)
    expect(m.lastReceipt().getAttribute('data-undoable')).toBe('true')
    await m.say('undo')
    await waitFor(() => expect(peek('NVDA')).toHaveLength(1))
    const { id: _a, ...was } = before
    const { id: _b, ...now } = peek('NVDA')[0]
    expect(now).toEqual(was)
  })
  it('Undo of a delete restores the EXACT id, so an earlier change to that drawing still finds it', async () => {
    const m = quad({ selected: 'bl' })
    await m.say('draw a trendline', (c) => [TREND(c, 'NVDA')])
    await waitFor(() => expect(peek('NVDA')).toHaveLength(1))
    const { id } = peek('NVDA')[0]
    await m.say('delete it', (c) => [REMOVE(c, 'NVDA')])
    await waitFor(() => expect(peek('NVDA')).toEqual([]))
    await m.say('undo')
    await waitFor(() => expect(peek('NVDA').map(d => d.id)).toEqual([id]))
  })
  it('KNOWN LIMIT, pinned: Undo does not restore stacking order; the restored drawing comes back on top', async () => {
    const m = quad({ selected: 'bl' })
    await m.say('draw a trendline', (c) => [TREND(c, 'NVDA')])
    await m.say('and a horizontal line at 200', (c) => [LINE(c, 'NVDA')])
    await waitFor(() => expect(peek('NVDA').map(d => d.type)).toEqual(['trendline', 'horizontal']))
    const first = peek('NVDA')[0].id
    await m.say('delete the trendline', (c) => [REMOVE(c, 'NVDA', first)])
    await waitFor(() => expect(peek('NVDA').map(d => d.type)).toEqual(['horizontal']))
    await m.say('undo')
    await waitFor(() => expect(peek('NVDA').map(d => d.type)).toEqual(['horizontal', 'trendline']))
    expect(peek('NVDA')[1].id).toBe(first)
  })
  it('add → restyle → delete → Undo three times walks all the way back to nothing', async () => {
    const m = quad({ selected: 'bl' })
    await m.say('draw a line at 200', (c) => [LINE(c, 'NVDA')])
    await waitFor(() => expect(peek('NVDA')).toHaveLength(1))
    const original = peek('NVDA')[0]
    await m.say('make it red', (c) => [STYLE(c, 'NVDA', { color: 'red' })])
    await waitFor(() => expect(peek('NVDA')[0].color).not.toBe(original.color))
    await m.say('delete it', (c) => [REMOVE(c, 'NVDA')])
    await waitFor(() => expect(peek('NVDA')).toEqual([]))
    await m.say('undo')
    await waitFor(() => expect(peek('NVDA')).toHaveLength(1))
    await m.say('undo')
    await waitFor(() => expect(peek('NVDA')[0].color).toBe(original.color))
    await m.say('undo')
    await waitFor(() => expect(peek('NVDA')).toEqual([]))
  })
  it('a hidden drawing and "clear everything" are shown first; Dismiss removes nothing; Apply removes them; Undo restores all', async () => {
    const m = quad({ selected: 'bl' })
    await m.say('draw a line at 150', (c) => [LINE(c, 'NVDA', 150)])
    await m.say('draw a line at 200', (c) => [LINE(c, 'NVDA', 200)])
    await waitFor(() => expect(peek('NVDA')).toHaveLength(2))
    const hidden = peek('NVDA')[0].id
    store.updateDrawing('NVDA', hidden, { hidden: true })
    await m.say('delete the hidden line', (c) => [REMOVE(c, 'NVDA', hidden)])
    expect(proposalsNow()).toHaveLength(1)
    await m.dismiss()
    expect(peek('NVDA')).toHaveLength(2)
    await m.say('clear all the drawings on this chart', (c) => [{ action: 'drawing.clear', target: drawingsOf(c, selectedChart(c).symbol).ref, args: {} }])
    expect(proposalsNow()).toHaveLength(1)
    expect(peek('NVDA')).toHaveLength(2)
    await m.apply()
    await waitFor(() => expect(peek('NVDA')).toEqual([]))
    await m.say('undo')
    await waitFor(() => expect(peek('NVDA')).toHaveLength(2))
  })
  it('a line an alert is bound to is refused, and it stays', async () => {
    const m = quad({ selected: 'bl' })
    await m.say('draw a line at 200', (c) => [LINE(c, 'NVDA')])
    await waitFor(() => expect(peek('NVDA')).toHaveLength(1))
    const id = peek('NVDA')[0].id
    m.st.alerts = [{ id: 'x', user_id: 'me', sym: 'NVDA', target_price: 200, direction: 'above', is_active: 1, triggered_at: null, created_at: '2026-11-03T13:00:00Z', alert_type: 'line', drawing_id: id }]
    const out = await m.say('delete that line', (c) => [REMOVE(c, 'NVDA', id)])
    expect(out).toMatch(/alert is attached/)
    expect(peek('NVDA')).toHaveLength(1)
  })
})

describe('receipt truthfulness: the account sync', () => {
  it('a drawing the account copy never confirms is not reported as simply done', async () => {
    const m = quad({ selected: 'bl' })
    m.h.drawings.confirm = async () => ({ ok: false, reason: 'not-synced' })
    await m.say('draw a line at 200', (c) => [LINE(c, 'NVDA')])
    await waitFor(() => expect(peek('NVDA')).toHaveLength(1))
    await waitFor(() => expect(m.p.transcript()).toMatch(/not confirmed/))
  })
})
