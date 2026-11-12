// DRAWING EXTRAS — the Position Calculator (C1-144), a drawing's Save as default (C1-160) and a drawing tool's ★ (C1-165),
// asserted on the state the product keeps: the chart's view read-out (StockChart getDateMeta.positionCalc, the harness's
// timeNav view), the chart widget's stored settings (cs.drawingDefaults) and the favourites in browser storage, through
// the real panel. Only the model is scripted (see outcomeHarness.jsx): this proves what a correct plan does to the state,
// not that a paid model would pick it.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import * as store from '../../../components/chart/drawingsStore'
import { saveDefaultsPayloadFor, mergeDrawingDefaults } from '../../../components/chart/drawingSaveDefaults'
import { LS_FAV, readFavoriteTools } from '../../../components/chart/drawToolFavorites'
import { TOOLS } from '../../../components/chart/ChartToolbar'
import { FAVORITE_TOOLS, positionPlan } from '../../capabilities/drawingExtras'
import { open, outcomeSuite, afterEachOutcome, QUAD, QUAD_SYMS, selectedChart, chartAt, drawingsOf, must, waitFor, proposalsNow } from './outcomeHarness'

vi.mock('../../../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
await outcomeSuite()
afterEach(afterEachOutcome)
beforeEach(() => { for (const s of ['SPY', 'QQQ', 'NVDA', 'TSLA']) store.clearAll(s); localStorage.removeItem(LS_FAV) })

const quad = (o = {}) => open(QUAD(), QUAD_SYMS, { extra: { drawings: true, timeNav: true }, selected: 'bl', ...o })
const on = (m, id) => m.board.state.widgets.find(w => w.id === id)
const calcs = (m) => Object.fromEntries(Object.entries(m.st.views).map(([ref, v]) => [ref, v.positionCalc]))
const CLOSED = { can: true, open: false, entry: '', stop: '', target: '', direction: 'long' }
const POS = (ref, entry, stop, target, side = null) => ({ action: 'drawing.positionCalculator', target: ref, args: { entry, stop, target, side } })

describe('C1-144 Position Calculator: the toolbar\'s Position tool on ONE chart, through its own state', () => {
  it('a long from entry > stop: the selected chart\'s calculator opens with the three prices; no other chart changes; Undo closes it exactly', async () => {
    const m = quad()
    let ref
    await m.say('open the position calculator with entry 50 stop 48 target 56', (c) => { ref = selectedChart(c).ref; return [POS(ref, 50, 48, 56)] })
    await waitFor(() => expect(Object.values(calcs(m)).filter(p => p.open)).toHaveLength(1))
    const [hit, pc] = Object.entries(calcs(m)).find(([, p]) => p.open)
    expect(pc).toMatchObject({ open: true, entry: '50', stop: '48', target: '56', direction: 'long' })
    for (const [r, p] of Object.entries(calcs(m))) if (r !== hit) expect(p).toEqual(CLOSED)
    expect(m.lastReceipt().textContent).toMatch(/Position Calculator on this chart \(NVDA\): long/)
    await m.say('undo')
    await waitFor(() => expect(calcs(m)[hit]).toEqual(CLOSED))
  }, 40000)
  it('a short from entry < stop; wrong-target control: naming the TSLA chart opens TSLA\'s calculator, NVDA\'s (the selected one) stays closed', async () => {
    const m = quad()
    await m.say('position calculator on the tsla chart: short at 30, stop 32, target 25', (c) => [POS(chartAt(c, 'bottom-right').ref, 30, 32, 25)])
    await waitFor(() => expect(Object.values(calcs(m)).filter(p => p.open)).toHaveLength(1))
    const open1 = Object.values(calcs(m)).find(p => p.open)
    expect(open1).toMatchObject({ entry: '30', stop: '32', target: '25', direction: 'short' })
    expect(m.lastReceipt().textContent).toMatch(/\(TSLA\): short/)
  }, 40000)
  it('refused, nothing opened: a missing price, an unreadable one, a stop at the entry, a target on the losing side, a side that contradicts entry vs stop', async () => {
    const m = quad()
    const cases = [
      [[50, 48, null], /missing target/],
      [[50, null, 56], /missing stop/],
      [[50, -3, 56], /stop \(“-3” isn't a price\)/],
      [[50, 50, 56], /stop is at the entry/],
      [[50, 48, 45], /target goes above the entry/],
      [[50, 48, 56, 'short'], /which did you mean/],
    ]
    for (const [[e, s, t, side], re] of cases) {
      expect(await m.say('position calculator', (c) => [POS(selectedChart(c).ref, e, s, t, side ?? null)])).toMatch(re)
    }
    expect(proposalsNow()).toHaveLength(0)
    for (const p of Object.values(calcs(m))) expect(p).toEqual(CLOSED)
  }, 40000)
  it('the side is never guessed: positionPlan reads it from entry vs stop only', () => {
    expect(positionPlan({ entry: 10, stop: 9, target: 12, side: null }).side).toBe('long')
    expect(positionPlan({ entry: 10, stop: 11, target: 8, side: null }).side).toBe('short')
    expect(positionPlan({ entry: 10, stop: 10, target: 12, side: 'long' }).why).toMatch(/long \(stop below the entry\) or a short/)
  })
})

describe('C1-160 Save as default: the menu row\'s payload onto ONE chart\'s drawing defaults', () => {
  const TREND = (c, s = 'NVDA') => [{ action: 'drawing.addTrendline', target: drawingsOf(c, s).ref, args: { from: { date: '2026-10-01', price: 100 }, to: { date: '2026-10-20', price: 120 }, color: 'red', style: 'dashed' } }]
  const SAVE = (ref, id) => ({ action: 'drawing.saveDefaults', target: ref, args: { drawing: id } })
  it('the selected chart\'s drawingDefaults become exactly what the row saves; the other charts keep theirs; Undo restores the exact blob', async () => {
    const m = quad()
    await m.say('draw a trendline', (c) => TREND(c))
    await waitFor(() => expect(store.peekDrawings('NVDA')).toHaveLength(1))
    const d = store.peekDrawings('NVDA')[0]
    const before = JSON.stringify(on(m, 'bl').opts)
    const others = JSON.stringify(['tl', 'tr', 'br'].map(id => on(m, id).opts))
    await m.say('make this trendline my default style', (c) => [SAVE(selectedChart(c).ref, must(drawingsOf(c, 'NVDA').drawings.find(x => x.recent), 'recent').id)])
    const want = mergeDrawingDefaults(JSON.parse(before).settings?.drawingDefaults, saveDefaultsPayloadFor(d))
    await waitFor(() => expect(on(m, 'bl').opts.settings.drawingDefaults).toEqual(want))
    expect(want).toMatchObject({ style: 'dashed' })
    expect(JSON.stringify(['tl', 'tr', 'br'].map(id => on(m, id).opts))).toBe(others)
    expect(store.peekDrawings('NVDA')[0]).toEqual(d)
    expect(m.lastReceipt().textContent).toMatch(/Saved the trendline's style as this chart's drawing default \(NVDA\)/)
    await m.say('undo')
    await waitFor(() => expect(JSON.stringify(on(m, 'bl').opts)).toBe(before))
  }, 40000)
  it('wrong-target control: NVDA\'s drawing id sent to the TSLA chart is refused, and no chart\'s settings change', async () => {
    const m = quad()
    await m.say('draw a trendline', (c) => TREND(c))
    await waitFor(() => expect(store.peekDrawings('NVDA')).toHaveLength(1))
    const id = store.peekDrawings('NVDA')[0].id
    const all = JSON.stringify(m.board.state.widgets)
    expect(await m.say('make that trendline the default drawing style on the tsla chart', (c) => [SAVE(chartAt(c, 'bottom-right').ref, id)])).toMatch(/no drawing .* on this chart \(TSLA\)/)
    expect(JSON.stringify(m.board.state.widgets)).toBe(all)
  }, 40000)
  it('a retired position drawing has no Save as default: refused', async () => {
    const m = quad()
    const pid = store.addDrawing('NVDA', { type: 'position', points: [{ time: '2026-10-01', price: 100 }, { time: '2026-10-01', price: 90 }, { time: '2026-10-20', price: 120 }] })
    const all = JSON.stringify(m.board.state.widgets)
    expect(await m.say('save the position as default', (c) => [SAVE(selectedChart(c).ref, pid)])).toMatch(/no Save as default/)
    expect(JSON.stringify(m.board.state.widgets)).toBe(all)
  }, 40000)
})

describe('C1-165 drawing tool favourites: the toolbar menu\'s ★, read back from storage', () => {
  const FAV = (c, tool, favorite) => ({ action: 'drawing.favoriteTool', target: selectedChart(c).ref, args: { tool, favorite } })
  it('star appends the tool after the existing favourites; unstar removes only it; Undo restores the exact list each time', async () => {
    const m = quad()
    localStorage.setItem(LS_FAV, JSON.stringify(['measure']))      // (after mounting: the harness starts on clean storage)
    await m.say('add the fib tool to my favourites', (c) => [FAV(c, 'fib', true)])
    await waitFor(() => expect(readFavoriteTools()).toEqual(['measure', 'fib']))
    expect(m.lastReceipt().textContent).toMatch(/Added the Fibonacci Retracement to your favourite drawing tools/)
    await m.say('undo')
    await waitFor(() => expect(readFavoriteTools()).toEqual(['measure']))
    await m.say('unstar the measure tool', (c) => [FAV(c, 'measure', false)])
    await waitFor(() => expect(readFavoriteTools()).toEqual([]))
    await m.say('undo')
    await waitFor(() => expect(readFavoriteTools()).toEqual(['measure']))
  }, 40000)
  it('already a favourite: nothing written', async () => {
    const m = quad()
    localStorage.setItem(LS_FAV, JSON.stringify(['measure']))
    expect(await m.say('star the measure tool', (c) => [FAV(c, 'measure', true)])).toMatch(/already a favourite/)
    expect(readFavoriteTools()).toEqual(['measure'])
  }, 40000)
  it('the starrable tools are exactly the toolbar\'s buttons', () => {
    expect([...FAVORITE_TOOLS].sort()).toEqual(TOOLS.filter(t => t && t.id).map(t => t.id).sort())
  })
})
