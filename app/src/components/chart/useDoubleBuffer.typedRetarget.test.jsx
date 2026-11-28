// ⭐ (lane C, typed Enter on a predicted cold ticker: the typed-pool measurement 2026-11-28, ab1: the data in memory at
// Enter, yet most presses refused 'shadow-other-row' — the hidden pane still on the list's row or another candidate)
// A TYPED NEXT SYMBOL RETARGETS THE HIDDEN PANE AT ONCE (useDoubleBuffer):
//   Y1 each keystroke's top candidate (publishTypedNext) moves the hidden pane in the publishing task: no frame waited
//      for (afterPaint), no transition a keystroke render abandons
//   Y2 a newer candidate replaces a stale one; Enter on the newest (its chart reported) flips
//   Y3 CONTROL: a list's rows still wait for the frame after the paint (afterPaint), as before
//   Y5 the retargeted layer's first pass is rendered in its own task (promptUntil) until its chart reports
//   Y6 the same candidate published again holds: no restart, Enter flips
//   Y4 the typed name cleared (a prefix that is no ticker): the hidden pane goes back to the list's row ahead
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

vi.mock('./barStoreSwitch', () => ({ BARSTORE: true }))
const frames = vi.hoisted(() => [])
vi.mock('../../utils/afterPaint', () => ({ afterPaint: (fn) => { frames.push(fn); return () => { const i = frames.indexOf(fn); if (i >= 0) frames.splice(i, 1); return true } } }))
vi.mock('./paintLog', async (orig) => ({ ...(await orig()), recordPaint: () => {} }))
vi.mock('../../data/barStore/prefetch', async (orig) => ({ ...(await orig()), heldRows: () => 0, deepPending: () => true, lakePending: () => true }))

const { useDoubleBuffer, __setDoubleBufferBarsSourceForTests } = await import('./useDoubleBuffer')
const { chartKeyFor } = await import('./useBarSnapshotBars')
const db = await import('./doubleBuffer')
const nf = await import('./neighborFrames')

const SYMS = ['AAA', 'BBB', 'NVDA', 'NVAX']
const keyOf = (sym) => chartKeyFor({ sym, resolvedTf: 'D', showExtended: false, replayCutoff: null, hasOverride: false })
const bars = {}
const settings = { look: 1 }
const meta = () => ({ frame: { fromRight: 152, toRight: -8, locked: false }, activeRange: null, priceAuto: true, replay: { on: false }, plotWidthPx: 1000 })
let panes
const base = () => ({ eligible: true, sym: 'AAA', tf: 'D', settings, cutoff: null, scope: {}, member: {}, parentVis: null, panes: () => panes, layerEls: () => [] })
const report = (h, i, sym) => act(() => { h.result.current.reporters[i]({ sym, tf: 'D', ext: false, bars: bars[sym], cutoff: null }) })
const flushFrames = () => act(() => { for (const f of frames.splice(0)) f() })

beforeEach(() => {
  frames.length = 0
  for (const s of SYMS) bars[s] = Object.freeze([s])
  const byKey = new Map(SYMS.map((s) => [keyOf(s), s]))
  __setDoubleBufferBarsSourceForTests((k) => (byKey.has(k) ? bars[byKey.get(k)] : null))
  panes = [0, 1].map(() => { const p = { m: meta(), focus: () => {} }; p.getDateMeta = () => p.m; p.viewDo = () => {}; return p })
  nf.__setNeighborFramesForTests(true); nf.__resetScanForTests()
  db.__resetDoubleBufferStatsForTests()
  nf.publishScanNeighbors('AAA', ['BBB'], [])
})
afterEach(() => { nf.__setNeighborFramesForTests(null); __setDoubleBufferBarsSourceForTests(null) })

async function ready() {
  const h = renderHook((p) => useDoubleBuffer(p), { initialProps: base() })
  report(h, 0, 'AAA')
  flushFrames()
  expect(h.result.current.syms).toEqual(['AAA', 'BBB'])
  report(h, 1, 'BBB')
  return h
}

describe('useDoubleBuffer: a typed next symbol retargets at once', () => {
  it('Y1 a keystroke candidate moves the hidden pane in the publishing task, no frame waited for', async () => {
    const h = await ready()
    act(() => { nf.publishTypedNext('AAA', 'NVAX') })
    expect(frames).toHaveLength(0)
    expect(h.result.current.syms[1]).toBe('NVAX')
  })

  it('Y2 a newer candidate replaces the stale one; Enter on it (reported) flips', async () => {
    const h = await ready()
    act(() => { nf.publishTypedNext('AAA', 'NVAX') })
    act(() => { nf.publishTypedNext('AAA', 'NVDA') })
    expect(h.result.current.syms[1]).toBe('NVDA')
    report(h, 1, 'NVDA')
    h.rerender({ ...base(), sym: 'NVDA' })
    expect(h.result.current.front).toBe(1)
    expect(db.doubleBufferStats().flips).toBe(1)
  })

  it('Y3 CONTROL: a list publishing its rows still waits for the frame after the paint', async () => {
    const h = await ready()
    act(() => { nf.publishScanNeighbors('AAA', ['NVDA'], []) })
    expect(h.result.current.syms[1]).toBe('BBB')
    flushFrames()
    expect(h.result.current.syms[1]).toBe('NVDA')
  })

  it('Y5 the retargeted layer renders its first pass in its own task (promptUntil) until its chart reports', async () => {
    const h = await ready()
    act(() => { nf.publishTypedNext('AAA', 'NVDA') })
    const hid = h.result.current.handles[1]
    expect(hid.promptUntil).toBeGreaterThan(performance.now())
    report(h, 1, 'NVDA')
    expect(hid.promptUntil).toBe(0)
  })

  it('Y6 the same candidate published again does not restart the hidden chart', async () => {
    const h = await ready()
    act(() => { nf.publishTypedNext('AAA', 'NVDA') })
    report(h, 1, 'NVDA')
    const before = db.doubleBufferStats().retargets
    act(() => { nf.publishTypedNext('AAA', 'NVDA') })
    expect(db.doubleBufferStats().retargets).toBe(before)
    h.rerender({ ...base(), sym: 'NVDA' })
    expect(h.result.current.front).toBe(1)
  })

  it('Y4 the typed name cleared: back to the list row ahead (after the frame)', async () => {
    const h = await ready()
    act(() => { nf.publishTypedNext('AAA', 'NVAX') })
    act(() => { nf.publishTypedNext('AAA', null) })
    flushFrames()
    expect(h.result.current.syms[1]).toBe('BBB')
  })
})
