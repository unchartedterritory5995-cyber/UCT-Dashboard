// The double-buffered next row, the widget's two layers (chart/useDoubleBuffer.js, 2026-11-27):
//   H1 after the front shows a symbol, the hidden layer is set (in idle time) to the row ahead, and marked SET when the
//      store still holds the snapshot it read
//   H2 THE FLIP: a press to that row swaps the layers' roles (no layer's symbol changes), the handles follow (the shown
//      one mirrors the board, the other hidden), and the group member's paint is recorded as a 'flip'
//   H3 STALE REFUSED: the row's base snapshot moved after the shadow was set -> the normal switch of the front
//   H4 FALLBACK: a press to any other row is the normal switch of the front, exactly as before
//   H5 a widget the board cannot give a shadow (its budget taken) never flips
//   H6 not eligible: nothing moves but the symbol the hook was handed
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const snaps = new Map()
const fakeStore = { registry: { has: (k) => snaps.has(k) }, getBaseSnapshot: (k) => snaps.get(k) ?? null }
vi.mock('../../data/barStore/index', () => ({ getBarStore: () => fakeStore }))
vi.mock('./barStoreSwitch', () => ({ BARSTORE: true }))
vi.mock('../../utils/afterPaint', () => ({ afterPaint: (fn) => { fn(); return () => false } }))
const painted = vi.hoisted(() => [])
vi.mock('./paintLog', async (orig) => ({ ...(await orig()), recordPaint: (...a) => { painted.push(a) } }))

const { useDoubleBuffer } = await import('./useDoubleBuffer')
const { chartKeyFor } = await import('./useBarSnapshotBars')
const db = await import('./doubleBuffer')
const nf = await import('./neighborFrames')

const keyOf = (sym) => chartKeyFor({ sym, resolvedTf: 'D', showExtended: false, replayCutoff: null, hasOverride: false })
const put = (sym) => { const s = Object.freeze({ key: keyOf(sym), bars: [1, 2, 3] }); snaps.set(keyOf(sym), s); return s }
const settings = { look: 1 }
const extRef = { current: false }
let scope
const member = { m: 1 }
const idle = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(80) }) }

function mount(over = {}) {
  return renderHook((p) => useDoubleBuffer(p), {
    initialProps: { eligible: true, sym: 'AAA', tf: 'D', extRef, settings, scope, member, parentVis: null, ...over },
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('requestIdleCallback', undefined)
  snaps.clear(); painted.length = 0
  scope = {}
  nf.__setNeighborFramesForTests(true); nf.__resetScanForTests()
  db.__resetDoubleBufferStatsForTests()
  for (const s of ['AAA', 'BBB', 'CCC']) put(s)
  nf.publishScanNeighbors('AAA', ['BBB', 'CCC'], [])
  nf.publishScanNeighbors('BBB', ['CCC'], ['AAA'])
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); nf.__setNeighborFramesForTests(null) })

describe('useDoubleBuffer', () => {
  it('H1 the hidden layer takes the row ahead in idle time', async () => {
    const { result } = mount()
    expect(result.current.syms).toEqual(['AAA', null])
    await idle()
    expect(result.current.front).toBe(0)
    expect(result.current.syms).toEqual(['AAA', 'BBB'])
    expect(result.current.handles[0].state).toBe('visible')
    expect(result.current.handles[1].state).toBe('hidden')
    expect(db.doubleBufferStats().retargets).toBe(1)
  })

  it('H2 a press to that row FLIPS: roles swap, no layer changes symbol, handles follow, the paint is recorded', async () => {
    const { result, rerender } = mount()
    await idle()
    const handles = result.current.handles
    rerender({ eligible: true, sym: 'BBB', tf: 'D', extRef, settings, scope, member, parentVis: null })
    expect(result.current.front).toBe(1)
    expect(result.current.syms).toEqual(['AAA', 'BBB'])
    expect(handles[1].state).toBe('visible')
    expect(handles[0].state).toBe('hidden')
    expect(db.doubleBufferStats().flips).toBe(1)
    expect(painted.some((a) => a[0] === 'BBB' && a[3] === 'flip' && a[4] === member && a[2] > 0)).toBe(true)
    // …then the old front (hidden now) takes the next row ahead
    await idle()
    expect(result.current.syms).toEqual(['CCC', 'BBB'])
  })

  it('H3 a shadow whose row moved on (another base snapshot) is refused: the front switches', async () => {
    const { result, rerender } = mount()
    await idle()
    put('BBB')   // a new base snapshot of the row (deeper history, a seal, a status change)
    rerender({ eligible: true, sym: 'BBB', tf: 'D', extRef, settings, scope, member, parentVis: null })
    expect(result.current.front).toBe(0)
    expect(result.current.syms[0]).toBe('BBB')
    expect(db.doubleBufferStats().flips).toBe(0)
    expect(db.doubleBufferStats().why.stale).toBe(1)
  })

  it('H3b a timeframe or settings change since the shadow was set, with the store unchanged, re-sets it (it got the props)', async () => {
    const { result, rerender } = mount()
    await idle()
    const s2 = { look: 2 }
    rerender({ eligible: true, sym: 'AAA', tf: 'D', extRef, settings: s2, scope, member, parentVis: null })
    rerender({ eligible: true, sym: 'BBB', tf: 'D', extRef, settings: s2, scope, member, parentVis: null })
    expect(result.current.front).toBe(1)
  })

  it('H4 a press to another row is the normal switch of the front', async () => {
    const { result, rerender } = mount()
    await idle()
    rerender({ eligible: true, sym: 'CCC', tf: 'D', extRef, settings, scope, member, parentVis: null })
    expect(result.current.front).toBe(0)
    expect(result.current.syms[0]).toBe('CCC')
    expect(db.doubleBufferStats().why.sym).toBe(1)
    expect(painted.some((a) => a[3] === 'flip')).toBe(false)
  })

  it('H5 the board\'s budget taken: no flip, ever', async () => {
    db.acquireShadow(scope, {}); db.acquireShadow(scope, {})
    const { result, rerender } = mount()
    await idle()
    expect(result.current.syms[1]).toBe(null)
    rerender({ eligible: true, sym: 'BBB', tf: 'D', extRef, settings, scope, member, parentVis: null })
    expect(result.current.front).toBe(0)
    expect(result.current.syms[0]).toBe('BBB')
  })

  it('H6 the board handle hidden: the front mirrors it, the shadow stays hidden', async () => {
    const parent = { state: 'hidden', layer: true, subscribe: () => () => {} }
    const { result } = mount({ parentVis: parent })
    await idle()
    expect(result.current.handles[result.current.front].state).toBe('hidden')
  })
})
