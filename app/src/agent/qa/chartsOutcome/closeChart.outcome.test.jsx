// CHARTS OUTCOME 4 — closing a chart: the state of the board (fixture board = the board writer's rules: remove / restore),
// and WHICH chart went when several exist.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { open, outcomeSuite, afterEachOutcome, QUAD, QUAD_SYMS, chart, widgetAt, widgetOf, selectedChart, subjectChart, boardRef, must, waitFor, proposalsNow } from './outcomeHarness'

vi.mock('../../../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
await outcomeSuite()
afterEach(afterEachOutcome)

const CLOSE = (c, ref) => ({ action: 'widget.remove', target: boardRef(c), args: { widget: ref } })
const ids = (m) => m.board.state.widgets.map(w => w.id).sort()
const quad = (o = {}) => open(QUAD(), QUAD_SYMS, o)
const REST = (gone) => ['tl', 'tr', 'bl', 'br'].filter(x => x !== gone).sort()

describe('which chart', () => {
  it('"close the top-left chart": that one and only that one, its neighbours keep their cells, Undo restores it exactly', async () => {
    const m = quad()
    const before = JSON.stringify(m.board.state.widgets.find(w => w.id === 'tl'))
    const others = JSON.stringify(m.board.state.widgets.filter(w => w.id !== 'tl'))
    await m.say('close the top-left chart', (c) => [CLOSE(c, widgetAt(c, 'top-left'))])
    await waitFor(() => expect(ids(m)).toEqual(REST('tl')))
    expect(JSON.stringify(m.board.state.widgets.filter(w => w.id !== 'tl'))).toBe(others)
    expect(m.pending()).toBe(0)                                         // one chart, exact Undo: at once
    expect(m.lastReceipt().textContent).toMatch(/top-left/)
    await m.say('undo')
    await waitFor(() => expect(ids(m)).toEqual(REST(null)))
    expect(JSON.stringify(m.board.state.widgets.find(w => w.id === 'tl'))).toBe(before)
  })
  it('"close this chart": the clicked chart, not the first one', async () => {
    const m = quad({ selected: 'br' })
    await m.say('close this chart', (c) => [CLOSE(c, widgetOf(c, selectedChart(c)))])
    await waitFor(() => expect(ids(m)).toEqual(REST('br')))
  })
  it('"close the NVDA chart": found by what it shows', async () => {
    const m = quad()
    await m.say('close the NVDA chart', (c) => [CLOSE(c, widgetOf(c, must(c.charts.find(x => x.symbol === 'NVDA'), 'NVDA chart')))])
    await waitFor(() => expect(ids(m)).toEqual(REST('bl')))
    expect(m.lastReceipt().textContent).toMatch(/bottom-left/)
  })
  it('"close the one I just changed": the conversation\'s subject chart is in the request', async () => {
    const m = quad()
    await m.say('make the bottom-right chart weekly', (c) => [{ action: 'chart.setTimeframe', target: must(c.charts.find(x => x.position === 'bottom-right'), 'chart').ref, args: { timeframe: 'W' } }])
    await waitFor(() => expect(m.h.charts.read('br').tf).toBe('W'))
    await m.say('close the one I just changed', (c) => [CLOSE(c, widgetOf(c, subjectChart(c)))])
    await waitFor(() => expect(ids(m)).toEqual(REST('br')))
  })
  it('the bottom row of a three-chart board keeps its position words honest after one closes', async () => {
    const m = quad()
    await m.say('close the top-left chart', (c) => [CLOSE(c, widgetAt(c, 'top-left'))])
    await waitFor(() => expect(ids(m)).toEqual(REST('tl')))
    await m.say('close the bottom-right chart', (c) => [CLOSE(c, widgetAt(c, 'bottom-right'))])
    await waitFor(() => expect(ids(m)).toEqual(['bl', 'tr']))
  })
  it('a widget that is not there is refused and nothing moves', async () => {
    const m = quad()
    const out = await m.say('close that chart', (c) => [CLOSE(c, 'nope')])
    expect(ids(m)).toEqual(REST(null))
    expect(out).toMatch(/nope|isn't on|not on|no widget/i)
  })
})

describe('approval and Undo', () => {
  it('two charts in one request are shown first; Dismiss keeps both; Apply closes both; one Undo brings both back', async () => {
    const m = quad()
    const BOTH = (c) => [CLOSE(c, widgetAt(c, 'bottom-left')), CLOSE(c, widgetAt(c, 'bottom-right'))]
    await m.say('close the two bottom charts', BOTH)
    expect(proposalsNow()).toHaveLength(1)
    await m.dismiss()
    expect(ids(m)).toEqual(REST(null))
    await m.say('close the two bottom charts', BOTH)
    await m.apply()
    await waitFor(() => expect(ids(m)).toEqual(['tl', 'tr']))
    await m.say('undo')
    await waitFor(() => expect(ids(m)).toEqual(REST(null)))
  })
  it('the only chart on the board closes, and Undo brings its tabs and settings back', async () => {
    const tabs = [{ id: 'x1', name: 'Swing', tf: 'W', color: 'A', settings: {} }]
    const one = chart('solo', 0, 0, 24, 20, {})
    one.opts = { ...one.opts, chartTabs: tabs, activeChartTab: 1 }
    const m = open([one], { 'N:solo': 'NVDA' })
    const before = JSON.stringify(m.board.state.widgets[0])
    await m.say('close this chart', (c) => [CLOSE(c, c.board[0].widgets[0].id)])
    await waitFor(() => expect(m.board.state.widgets).toEqual([]))
    await m.say('undo')
    await waitFor(() => expect(m.board.state.widgets).toHaveLength(1))
    expect(JSON.stringify(m.board.state.widgets[0])).toBe(before)
  })
  it('a chart changed after it was closed-and-restored still has a truthful Undo: the member\'s newer edit is not overwritten', async () => {
    const m = quad()
    await m.say('close the top-left chart', (c) => [CLOSE(c, widgetAt(c, 'top-left'))])
    await waitFor(() => expect(ids(m)).toEqual(REST('tl')))
    m.board.widgetOps.applyBoard({ set: { tr: { w: 11 } } })            // the member drags a neighbour
    await m.say('undo')
    await m.p.idle()
    await waitFor(() => expect(ids(m)).toEqual(REST(null)))             // nothing of theirs was touched by bringing it back
    expect(m.board.state.widgets.find(w => w.id === 'tr').w).toBe(11)
  })
})
