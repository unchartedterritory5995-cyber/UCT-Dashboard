// ⭐ (lane C, zero-network PR 2.1, goal A4) THE TIMEFRAME FLIP (chart/useDoubleBuffer.js, doubleBuffer.js):
//   T1 with no list beside the chart, the hidden layer holds the front's OWN symbol at the member's habitual next
//      timeframe (tfHabit.js; no history: the bar's next longer timeframe)
//   T2 a press of that timeframe, the hidden chart having REPORTED it with the store's bars of that key NOW: the FLIP
//      (roles swap, no layer changes symbol or timeframe, the paint recorded as a 'flip', the decision logged 'tf')
//   T3 the store's bars for that key moved on since the hidden chart reported: refused ('stale'), the normal switch
//   T4 a press of another timeframe than the one held: the normal switch ('shadow-other-tf'); the front takes the tf
//   T5 a view lock on the front (a range, a pan, Go-to-date) frames a timeframe switch by rules not proved: 'view-lock'
//   T6 change-date mode: never a timeframe flip ('tf-replay')
//   T7 WITH a list: the hidden layer holds the row ahead at the front's timeframe; a timeframe press is the normal switch
//      and the hidden row follows the new timeframe (what both layers did before PR 2.1)
//   T8 a symbol and a timeframe change in one render: the normal switch of both ('sym-and-tf')
//   T9 after a timeframe flip the old front (the timeframe left) is retargeted to the new front's habitual next one
//   T11 (after #2947) at the date the member went to, the timeframe press carries the anchor and flips; another date refuses
//   T10 PARITY: the flipped-to chart is exactly the chart a fresh render of (sym, tf) shows: the same symbol, timeframe,
//      session, settings and the very bars array the store gives that key now
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

vi.mock('./barStoreSwitch', () => ({ BARSTORE: true }))
vi.mock('../../utils/afterPaint', () => ({ afterPaint: (fn) => { fn(); return () => false } }))
const painted = vi.hoisted(() => [])
vi.mock('./paintLog', async (orig) => ({ ...(await orig()), recordPaint: (...a) => { painted.push(a) } }))
vi.mock('../../data/barStore/prefetch', async (orig) => ({ ...(await orig()), heldRows: () => 0, deepPending: () => true, lakePending: () => true }))

const { useDoubleBuffer, barsNowFor, __setDoubleBufferBarsSourceForTests } = await import('./useDoubleBuffer')
const { chartKeyFor } = await import('./useBarSnapshotBars')
const db = await import('./doubleBuffer')
const nf = await import('./neighborFrames')
const { __resetTfHabitForTests, noteTfPress } = await import('./tfHabit')

const BAR = ['60', 'D', 'W']
const keyOf = (sym, tf) => chartKeyFor({ sym, resolvedTf: tf, showExtended: false, replayCutoff: null, hasOverride: false })
const bars = new Map()
const fresh = (sym, tf) => { const b = Object.freeze([sym, tf, Math.random()]); bars.set(keyOf(sym, tf), b); return b }
const settings = { look: 1 }
let scope
const member = { m: 1 }
const idle = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(400) }) }
const meta = (width = 160) => { const toRight = -(width * 0.05); return { frame: { fromRight: toRight + width, toRight, locked: false }, activeRange: null, priceAuto: true, replay: { on: false }, plotWidthPx: 1000 } }
let panes
const base = () => ({ eligible: true, sym: 'AAA', tf: 'D', tfBar: BAR, settings, cutoff: null, scope, member, parentVis: null, panes: () => panes, layerEls: () => [] })
const mount = (over = {}) => renderHook((p) => useDoubleBuffer(p), { initialProps: { ...base(), ...over } })
const report = (h, i, sym, tf, cutoff = null) => act(() => { h.result.current.reporters[i]({ sym, tf, ext: false, bars: bars.get(keyOf(sym, tf)), cutoff }) })
const press = (h, over) => h.rerender({ ...base(), ...over })

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('requestIdleCallback', undefined)
  painted.length = 0
  scope = {}
  bars.clear()
  for (const s of ['AAA', 'BBB']) for (const tf of ['60', 'D', 'W']) fresh(s, tf)
  __setDoubleBufferBarsSourceForTests((k) => bars.get(k) ?? null)
  panes = [0, 1].map(() => { const p = { m: meta(), focus: vi.fn() }; p.getDateMeta = () => p.m; p.viewDo = () => {}; return p })
  nf.__setNeighborFramesForTests(true); nf.__resetScanForTests()
  db.__resetDoubleBufferStatsForTests()
  __resetTfHabitForTests()
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); nf.__setNeighborFramesForTests(null); __setDoubleBufferBarsSourceForTests(null) })

/** Mounted on AAA @ D (no list), both charts reported, the hidden layer on AAA @ W. */
async function ready(over = {}) {
  const h = mount(over)
  report(h, 0, 'AAA', 'D')
  await idle()
  report(h, 1, h.result.current.syms[1], h.result.current.tfs[1])
  return h
}

describe('useDoubleBuffer: the timeframe flip', () => {
  it('T1 no list: the hidden layer holds the front symbol at the habitual next timeframe (no history: the next longer)', async () => {
    const h = mount()
    report(h, 0, 'AAA', 'D')
    expect(h.result.current.syms).toEqual(['AAA', 'AAA'])
    expect(h.result.current.tfs).toEqual(['D', 'W'])
  })

  it('T1b history: the timeframe the member goes to from here', async () => {
    noteTfPress('D', '60'); noteTfPress('D', '60')
    const h = mount()
    report(h, 0, 'AAA', 'D')
    expect(h.result.current.tfs).toEqual(['D', '60'])
  })

  it('T2 a press of the held timeframe FLIPS: roles swap, no layer changes, the flip recorded and logged as a tf press', async () => {
    const h = await ready()
    const handles = h.result.current.handles
    press(h, { tf: 'W' })
    expect(h.result.current.front).toBe(1)
    expect(h.result.current.syms[1]).toBe('AAA')
    expect(h.result.current.tfs[1]).toBe('W')
    expect(handles[1].state).toBe('visible')
    expect(handles[0].state).toBe('hidden')
    expect(db.doubleBufferStats().flips).toBe(1)
    expect(db.doubleBufferStats().log.at(-1)).toMatchObject({ sym: 'AAA@W', why: 'flip', press: 'tf' })
    expect(painted.some((a) => a[0] === 'AAA' && a[1] === 'W' && a[3] === 'flip' && a[4] === member)).toBe(true)
  })

  it('T3 the store moved on since the hidden chart reported: refused (stale), the normal switch', async () => {
    const h = await ready()
    fresh('AAA', 'W')
    press(h, { tf: 'W' })
    expect(h.result.current.front).toBe(0)
    expect(h.result.current.tfs[0]).toBe('W')
    expect(db.doubleBufferStats().why.stale).toBe(1)
  })

  it('T4 a press of another timeframe than the one held: the normal switch', async () => {
    const h = await ready()
    press(h, { tf: '60' })
    expect(h.result.current.front).toBe(0)
    expect(h.result.current.tfs[0]).toBe('60')
    expect(db.doubleBufferStats().why['shadow-other-tf']).toBe(1)
  })

  it('T5 a view lock on the front: refused (view-lock)', async () => {
    const h = await ready()
    panes[0].m = { ...meta(), frame: { ...meta().frame, locked: true, lock: { anchorFrac: 0.95, width: 160, tf: 'D' } } }
    press(h, { tf: 'W' })
    expect(h.result.current.front).toBe(0)
    expect(db.doubleBufferStats().why['view-lock']).toBe(1)
  })

  it('T5b CONTROL: the zoom widths differ: refused (view-zoom), as for a symbol press', async () => {
    const h = await ready()
    panes[0].m = meta(80)
    press(h, { tf: 'W' })
    expect(db.doubleBufferStats().why['view-zoom']).toBe(1)
  })

  it('T6 change-date mode with no list: no hidden chart at a habitual timeframe (it could never flip), the normal switch', async () => {
    const c = '2006-03-16'
    const h = mount({ cutoff: c })
    report(h, 0, 'AAA', 'D', c)
    await idle()
    expect(h.result.current.syms[1], 'a replay window loaded for a layer that can never flip (review of #3008, F4)').toBe(null)
    press(h, { tf: 'W', cutoff: c })
    expect(h.result.current.front).toBe(0)
    expect(h.result.current.tfs[0]).toBe('W')
  })

  it('T12 (F5) a hidden chart at another timeframe is not given the front view lock (only the pin)', async () => {
    const h = await ready()
    const writes = []
    panes[1].viewDo = (op, f) => { if (op === 'restoreView') writes.push(f) }
    panes[0].m = { ...meta(), frame: { ...meta().frame, locked: true, lock: { anchorFrac: 0.95, width: 160, tf: 'D' } } }
    act(() => { h.result.current.viewChanged(0) })
    await idle()
    expect(writes).toEqual([])
  })

  it('T7 with a list: the hidden layer is the row ahead at the front tf, and follows a timeframe press', async () => {
    nf.publishScanNeighbors('AAA', ['BBB'], [])
    const h = mount()
    report(h, 0, 'AAA', 'D')
    expect(h.result.current.syms).toEqual(['AAA', 'BBB'])
    expect(h.result.current.tfs).toEqual(['D', 'D'])
    press(h, { tf: 'W' })
    expect(h.result.current.front).toBe(0)
    expect(h.result.current.tfs).toEqual(['W', 'W'])
  })

  it('T8 a symbol and a timeframe in one render: the normal switch of both', async () => {
    const h = await ready()
    press(h, { sym: 'BBB', tf: 'W' })
    expect(h.result.current.front).toBe(0)
    expect(h.result.current.syms[0]).toBe('BBB')
    expect(h.result.current.tfs[0]).toBe('W')
    expect(db.doubleBufferStats().why['sym-and-tf']).toBe(1)
  })

  it('T9 after a timeframe flip, the old front is retargeted to the new front\'s habitual next timeframe', async () => {
    const h = await ready()
    noteTfPress('W', '60')   // what ChartWidget's setTf records for a later W -> 60 habit
    press(h, { tf: 'W' })
    await idle()
    expect(h.result.current.front).toBe(1)
    expect(h.result.current.syms[0]).toBe('AAA')
    expect(h.result.current.tfs[0]).toBe('60')
  })

  it('T10 PARITY: the flipped-to layer holds exactly what a fresh render of (AAA, W) would: barsNowFor of that key', async () => {
    const h = await ready()
    press(h, { tf: 'W' })
    const r = { sym: 'AAA', tf: 'W', ext: false, cutoff: null }
    expect(barsNowFor(r)).toBe(bars.get(keyOf('AAA', 'W')))
    // and a press back to D flips again (the old front still holds AAA @ D, reported, the store unchanged)
    press(h, { tf: 'D' })
    expect(h.result.current.front).toBe(0)
    expect(db.doubleBufferStats().flips).toBe(2)
  })
})

describe('useDoubleBuffer: the timeframe flip AT A DATE (after #2947)', () => {
  const A = '2016-06-14|165'
  const at = () => ({ frame: { fromRight: 4700, toRight: 4535, locked: false }, activeRange: null, priceAuto: true, replay: { mode: false },
    rows: 6000, anchor: { date: '2016-06-14', width: 165 }, anchorFrame: { fromRight: 4700, toRight: 4535 }, anchorEarliest: false })
  const reportAt = (h, i, sym, tf, anchor) => act(() => { h.result.current.reporters[i]({ sym, tf, ext: false, bars: bars.get(keyOf(sym, tf)), cutoff: null, anchor }) })
  it('T11 both layers at the date the member went to: a timeframe press flips, the want carrying the anchor', async () => {
    panes.forEach((p) => { p.m = at() })
    const h = mount({ anchor: A })
    reportAt(h, 0, 'AAA', 'D', A)
    await idle()
    expect(h.result.current.tfs).toEqual(['D', 'W'])
    reportAt(h, 1, 'AAA', 'W', A)
    press(h, { tf: 'W', anchor: A })
    expect(h.result.current.front).toBe(1)
    expect(db.doubleBufferStats().flips).toBe(1)
  })
  it('T11b CONTROL: the hidden chart drew at another date: refused (anchor)', async () => {
    panes.forEach((p) => { p.m = at() })
    const h = mount({ anchor: A })
    reportAt(h, 0, 'AAA', 'D', A)
    await idle()
    reportAt(h, 1, 'AAA', 'W', '2012-01-03|165')
    press(h, { tf: 'W', anchor: A })
    expect(h.result.current.front).toBe(0)
    expect(db.doubleBufferStats().why.anchor).toBe(1)
  })
})

describe('flipDecision: the timeframe-press form', () => {
  const want = { press: 'tf', sym: 'AAA', tf: 'W', ext: false, settings, cutoff: null }
  const rep = { sym: 'AAA', tf: 'W', ext: false, bars: ['x'], settings, cutoff: null }
  it('flips when everything matches, refuses another resolved timeframe, refuses replay', () => {
    expect(db.flipDecision(want, rep, () => rep.bars, () => 'ok')).toEqual({ flip: true, why: 'flip' })
    expect(db.flipDecision(want, { ...rep, tf: 'D' }, () => rep.bars, () => 'ok').why).toBe('tf')
    expect(db.flipDecision({ ...want, cutoff: '2006-01-03' }, { ...rep, cutoff: '2006-01-03' }, () => rep.bars, () => 'ok').why).toBe('tf-replay')
  })
  it('shadowTargetFor: the row ahead first, else the habitual timeframe, never the front itself', () => {
    expect(db.shadowTargetFor('AAA', 'D', 'W')).toEqual({ sym: 'AAA', tf: 'W' })
    expect(db.shadowTargetFor('AAA', 'D', 'D')).toBeNull()
    nf.publishScanNeighbors('AAA', ['BBB'], [])
    expect(db.shadowTargetFor('AAA', 'D', 'W')).toEqual({ sym: 'BBB', tf: 'D' })
  })
})
