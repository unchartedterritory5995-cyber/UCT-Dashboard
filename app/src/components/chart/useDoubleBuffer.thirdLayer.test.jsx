// ⭐ (lane C, zero-network plan 2.4; owner YES 2026-11-28) THE THIRD LAYER: a double-buffered widget on a desktop of 8 GB
// or more keeps TWO hidden panes (useDoubleBuffer `layers: 3`):
//   L1 a list: the hidden panes hold the row ahead AND the row behind; a press either way flips
//   L2 a typed candidate (publishTypedNext): it takes a hidden pane at once, the row ahead stays in the other; Enter flips
//   L3 no list: the front's own symbol at its two habitual next timeframes; either timeframe press flips
//   L4 planRetarget keeps a pane that already holds a target and fills empty panes first
//   L6 typing: a new candidate takes the row pane while the previous candidate's pane is kept until the new one reports
//   L5 thirdLayerOn: 8 GB or more only (a browser that does not say keeps two layers), off by localStorage
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

vi.mock('./barStoreSwitch', () => ({ BARSTORE: true }))
vi.mock('../../utils/afterPaint', () => ({ afterPaint: (fn) => { fn(); return () => false } }))
vi.mock('./paintLog', async (orig) => ({ ...(await orig()), recordPaint: () => {} }))
vi.mock('../../data/barStore/prefetch', async (orig) => ({ ...(await orig()), heldRows: () => 0, deepPending: () => true, lakePending: () => true }))

const { useDoubleBuffer, planRetarget, __setDoubleBufferBarsSourceForTests } = await import('./useDoubleBuffer')
const { chartKeyFor } = await import('./useBarSnapshotBars')
const db = await import('./doubleBuffer')
const nf = await import('./neighborFrames')
const { __resetTfHabitForTests } = await import('./tfHabit')

const keyOf = (sym, tf) => chartKeyFor({ sym, resolvedTf: tf, showExtended: false, replayCutoff: null, hasOverride: false })
const bars = new Map()
for (const s of ['AAA', 'BBB', 'ZZZ', 'NVDA', 'NVAX']) for (const tf of ['60', 'D', 'W']) bars.set(keyOf(s, tf), Object.freeze([s, tf]))
const settings = { look: 1 }
const meta = () => ({ frame: { fromRight: 152, toRight: -8, locked: false }, activeRange: null, priceAuto: true, replay: { on: false }, plotWidthPx: 1000 })
let panes
const base = () => ({ eligible: true, sym: 'AAA', tf: 'D', tfBar: ['60', 'D', 'W'], layers: 3, settings, cutoff: null, scope: {}, member: {}, parentVis: null, panes: () => panes, layerEls: () => [] })
const mount = () => renderHook((p) => useDoubleBuffer(p), { initialProps: base() })
const reportAll = (h) => act(() => { h.result.current.syms.forEach((sym, i) => { if (sym) h.result.current.reporters[i]({ sym, tf: h.result.current.tfs[i], ext: false, bars: bars.get(keyOf(sym, h.result.current.tfs[i])), cutoff: null }) }) })
const idle = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(400) }) }

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('requestIdleCallback', undefined)
  __setDoubleBufferBarsSourceForTests((k) => bars.get(k) ?? null)
  panes = [0, 1, 2].map(() => { const p = { m: meta(), focus: () => {} }; p.getDateMeta = () => p.m; p.viewDo = () => {}; return p })
  nf.__setNeighborFramesForTests(true); nf.__resetScanForTests()
  db.__resetDoubleBufferStatsForTests()
  __resetTfHabitForTests()
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); nf.__setNeighborFramesForTests(null); __setDoubleBufferBarsSourceForTests(null); db.__setThirdLayerForTests(null) })

describe('useDoubleBuffer: three layers', () => {
  it('L1 a list: the row ahead and the row behind are both held; a press either way flips', async () => {
    nf.publishScanNeighbors('AAA', ['BBB'], ['ZZZ'])
    const h = mount()
    expect(h.result.current.handles).toHaveLength(3)
    reportAll(h)
    await idle()
    expect(h.result.current.syms).toEqual(['AAA', 'BBB', 'ZZZ'])
    reportAll(h)
    h.rerender({ ...base(), sym: 'ZZZ' })   // the member reversed: the row behind
    expect(h.result.current.front).toBe(2)
    expect(db.doubleBufferStats().flips).toBe(1)
    expect(h.result.current.handles[2].state).toBe('visible')
    expect(h.result.current.handles.filter((x) => x.state === 'hidden')).toHaveLength(2)
  })

  it('L2 a typed candidate takes a hidden pane at once, the row ahead stays; Enter on it flips', async () => {
    nf.publishScanNeighbors('AAA', ['BBB'], ['ZZZ'])
    const h = mount()
    reportAll(h)
    await idle()
    reportAll(h)
    act(() => { nf.publishTypedNext('AAA', 'NVDA') })
    expect(h.result.current.syms).toEqual(['AAA', 'BBB', 'NVDA'])   // the row ahead kept, the behind row's pane took NVDA
    reportAll(h)
    h.rerender({ ...base(), sym: 'NVDA' })
    expect(h.result.current.front).toBe(2)
    expect(db.doubleBufferStats().flips).toBe(1)
  })

  it('L6 typing on: a new candidate takes the ROW pane, the previous candidate pane is kept until the new one reports', async () => {
    nf.publishScanNeighbors('AAA', ['BBB'], ['ZZZ'])
    const h = mount()
    reportAll(h)
    await idle()
    reportAll(h)
    act(() => { nf.publishTypedNext('AAA', 'NVDA') })
    expect(h.result.current.syms).toEqual(['AAA', 'BBB', 'NVDA'])   // the behind row (ZZZ, lowest priority) made room
    act(() => { nf.publishTypedNext('AAA', 'NVAX') })                // the next keystroke, before NVDA's chart reported
    expect(h.result.current.syms).toEqual(['AAA', 'NVAX', 'NVDA'])   // NVDA kept: the ahead row's pane took NVAX
    act(() => { h.result.current.reporters[1]({ sym: 'NVAX', tf: 'D', ext: false, bars: bars.get(keyOf('NVAX', 'D')), cutoff: null }) })
    await idle()
    expect(h.result.current.syms).toEqual(['AAA', 'NVAX', 'BBB'])    // reported: the full retarget gives the row ahead back
  })

  it('L3 no list: the two habitual timeframes; either timeframe press flips', async () => {
    const h = mount()
    reportAll(h)
    await idle()
    expect(h.result.current.syms).toEqual(['AAA', 'AAA', 'AAA'])
    expect(h.result.current.tfs).toEqual(['D', 'W', '60'])
    reportAll(h)
    h.rerender({ ...base(), tf: '60' })
    expect(h.result.current.front).toBe(2)
    expect(db.doubleBufferStats().flips).toBe(1)
  })

  it('L4 planRetarget: a pane holding a target keeps it, an empty pane is filled first', () => {
    const b = { syms: ['AAA', 'XXX', null], tfs: ['D', 'D', null], front: 0 }
    expect(planRetarget(b, [{ sym: 'BBB', tf: 'D' }])).toEqual([[2, { sym: 'BBB', tf: 'D' }]])
    expect(planRetarget(b, [{ sym: 'XXX', tf: 'D' }, { sym: 'BBB', tf: 'D' }])).toEqual([[2, { sym: 'BBB', tf: 'D' }]])
    expect(planRetarget({ syms: ['AAA', 'BBB'], tfs: ['D', 'D'], front: 0 }, [{ sym: 'BBB', tf: 'D' }])).toEqual([])
  })

  it('L5 CONTROL: layers 2 (the default) is the two-layer widget, exactly as before', async () => {
    nf.publishScanNeighbors('AAA', ['BBB'], ['ZZZ'])
    const h = renderHook((p) => useDoubleBuffer(p), { initialProps: { ...base(), layers: undefined } })
    expect(h.result.current.handles).toHaveLength(2)
    reportAll(h)
    await idle()
    expect(h.result.current.syms).toEqual(['AAA', 'BBB'])
  })
})

describe('the third layer steps aside for a heavy front', () => {
  it('L7 zoomed out past THIRD_LAYER_MAX_SPAN: one hidden pane; back under it: two again', async () => {
    const { THIRD_LAYER_MAX_SPAN } = await import('./useDoubleBuffer')
    nf.publishScanNeighbors('AAA', ['BBB'], ['ZZZ'])
    const h = mount()
    reportAll(h)
    await idle()
    expect(h.result.current.syms).toEqual(['AAA', 'BBB', 'ZZZ'])
    const wide = THIRD_LAYER_MAX_SPAN + 200
    panes[0].m = { ...meta(), frame: { fromRight: wide - 8, toRight: -8, locked: false } }
    act(() => { h.result.current.viewChanged(0) })
    await idle()
    expect(h.result.current.syms).toEqual(['AAA', 'BBB', null])   // the third pane dropped, the row ahead kept
    panes[0].m = meta()
    act(() => { h.result.current.viewChanged(0) })
    await idle()
    expect(h.result.current.syms).toEqual(['AAA', 'BBB', 'ZZZ'])
  })

  it('L8 a custom timeframe (4h): one hidden pane', async () => {
    nf.publishScanNeighbors('AAA', ['BBB'], ['ZZZ'])
    const h = renderHook((p) => useDoubleBuffer(p), { initialProps: { ...base(), tf: '240', tfBar: ['60', '240', 'D'] } })
    act(() => { h.result.current.reporters[0]({ sym: 'AAA', tf: '240', ext: false, bars: bars.get(keyOf('AAA', 'D')), cutoff: null }) })
    await idle()
    expect(h.result.current.syms.filter(Boolean)).toHaveLength(2)   // the front and ONE hidden pane
  })

  it('L9 frontTooHeavyForThird', async () => {
    const { frontTooHeavyForThird, THIRD_LAYER_MAX_SPAN } = await import('./useDoubleBuffer')
    expect(frontTooHeavyForThird(meta(), 'D')).toBe(false)
    expect(frontTooHeavyForThird({ frame: { fromRight: THIRD_LAYER_MAX_SPAN + 10, toRight: 0 } }, 'D')).toBe(true)
    expect(frontTooHeavyForThird(meta(), '240')).toBe(true)
    expect(frontTooHeavyForThird(meta(), '60')).toBe(false)
    expect(frontTooHeavyForThird(null, 'D')).toBe(false)
  })
})

describe('thirdLayerOn', () => {
  afterEach(() => { vi.unstubAllGlobals(); try { localStorage.removeItem(db.THIRD_LAYER_KEY) } catch { /* none */ } })
  it('8 GB or more: on; less, or a browser that does not say: off; the localStorage switch turns it off', () => {
    db.__setDoubleBufferForTests(true)
    const at = (mem) => { vi.stubGlobal('navigator', { ...navigator, deviceMemory: mem }); db.__setThirdLayerForTests(null); return db.thirdLayerOn() }
    expect(at(8)).toBe(true)
    expect(at(4)).toBe(false)
    expect(at(undefined)).toBe(false)
    localStorage.setItem(db.THIRD_LAYER_KEY, '0')
    expect(at(8)).toBe(false)
    db.__setDoubleBufferForTests(null)
  })
})
