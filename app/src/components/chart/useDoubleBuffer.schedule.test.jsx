// The double buffer's retarget scheduling with the REAL afterPaint (review of #2930), on a visible document and a fake
// animation frame:
//   S1 (LOW-1) a list that republishes its neighbours twice before the frame (two presses, a live re-sort) retargets
//      ONCE: one pending schedule at a time, the newest
//   S2 (LOW-2) at mount the retarget waits for the FRONT chart's first pass, then the frame: nothing is retargeted
//      before the front has drawn, and the first press still finds the shadow
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

vi.mock('./barStoreSwitch', () => ({ BARSTORE: true }))

const { useDoubleBuffer } = await import('./useDoubleBuffer')
const db = await import('./doubleBuffer')
const nf = await import('./neighborFrames')

let frames
const flushFrame = () => act(() => {
  const fs = frames.splice(0)
  for (const f of fs) if (f) f(performance.now())
  vi.advanceTimersByTime(1)
})
const settings = { look: 1 }
const member = { m: 1 }
let scope
const base = () => ({ eligible: true, sym: 'AAA', settings, replay: false, scope, member, parentVis: null, panes: () => [], layerEls: () => [] })
const reportFront = (h) => act(() => { h.result.current.reporters[h.result.current.front]({ sym: 'AAA', tf: 'D', ext: false, bars: [1] }) })

beforeEach(() => {
  vi.useFakeTimers()
  frames = []
  vi.stubGlobal('requestAnimationFrame', (cb) => { frames.push(cb); return frames.length })
  vi.stubGlobal('cancelAnimationFrame', (h) => { frames[h - 1] = null })
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false })
  scope = {}
  nf.__setNeighborFramesForTests(true); nf.__resetScanForTests()
  db.__resetDoubleBufferStatsForTests()
  nf.publishScanNeighbors('AAA', ['BBB', 'CCC'], [])
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); delete document.hidden; nf.__setNeighborFramesForTests(null) })

describe('useDoubleBuffer retarget scheduling (real afterPaint)', () => {
  it('S2 (LOW-2) the mount retarget waits for the front chart\'s first pass, then the frame', () => {
    const h = renderHook((p) => useDoubleBuffer(p), { initialProps: base() })
    flushFrame()
    expect(h.result.current.syms).toEqual(['AAA', null])       // the front has not drawn: nothing yet
    expect(db.doubleBufferStats().retargets).toBe(0)
    reportFront(h)
    flushFrame()
    expect(h.result.current.syms).toEqual(['AAA', 'BBB'])
    expect(db.doubleBufferStats().retargets).toBe(1)
  })

  it('S1 (LOW-1) two republishes before the frame retarget ONCE', () => {
    const h = renderHook((p) => useDoubleBuffer(p), { initialProps: base() })
    reportFront(h)                                              // the mount's retarget is scheduled (one frame away)
    act(() => {
      nf.publishScanNeighbors('AAA', ['BBB', 'CCC'], [])     // a press's republish…
      nf.publishScanNeighbors('AAA', ['BBB', 'CCC'], [])     // …and a re-sort's, before the frame
    })
    flushFrame()
    expect(db.doubleBufferStats().retargets).toBe(1)
    expect(h.result.current.syms).toEqual(['AAA', 'BBB'])
  })
})
