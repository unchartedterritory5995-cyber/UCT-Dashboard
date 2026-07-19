import { describe, it, expect } from 'vitest'
import { FIRST_PAINT_BARS, fullBarsFor, shouldBackfill, nextBackfillDepth } from './barsBackfill'

describe('nextBackfillDepth (progressive deep-pan)', () => {
  it('first step from the 600 shallow window lands a fast intermediate chunk', () => {
    // 600*8=4800 >= 600+4000=4600 -> 4800. Fast (~5s) vs the full 20000 (~20s).
    expect(nextBackfillDepth(600, 20000)).toBe(4800)
  })

  it('second pan reaches (and caps at) the full target', () => {
    // 4800*8 = 38400, capped to 20000.
    expect(nextBackfillDepth(4800, 20000)).toBe(20000)
  })

  it('small targets (W/M) reach full in one step — no visible progression', () => {
    expect(nextBackfillDepth(600, 4000)).toBe(4000)   // 600->4000 directly
    expect(nextBackfillDepth(600, 1200)).toBe(1200)
  })

  it('never exceeds the target and is idempotent at/above it', () => {
    expect(nextBackfillDepth(20000, 20000)).toBe(20000)
    expect(nextBackfillDepth(25000, 20000)).toBe(20000)
  })

  it('degenerate inputs fall back to the full target', () => {
    expect(nextBackfillDepth(0, 20000)).toBe(20000)
    expect(nextBackfillDepth(600, 0)).toBe(0)
  })

  it('reaches full for the deepest intraday targets within a few steps', () => {
    // 5m target 26000: 600 -> 4800 -> 26000 (4800*8=38400 capped).
    let d = 600, steps = 0
    while (d < 26000 && steps < 10) { d = nextBackfillDepth(d, 26000); steps++ }
    expect(d).toBe(26000)
    expect(steps).toBeLessThanOrEqual(3)
  })
})

describe('barsBackfill', () => {
  it('FIRST_PAINT_BARS is a small shallow window', () => {
    expect(FIRST_PAINT_BARS).toBe(600)
  })

  it('fullBarsFor: deep per-timeframe history targets', () => {
    // Daily reaches ~50yr (matches deep_history_warm _DEEP_TARGET['D']);
    // W/M decades; intraday multi-year.
    expect(fullBarsFor('D')).toBe(12500)
    expect(fullBarsFor('W')).toBe(4000)
    expect(fullBarsFor('M')).toBe(1200)
    expect(fullBarsFor('60')).toBe(32000)
    expect(fullBarsFor('30')).toBe(32000)
    expect(fullBarsFor('15')).toBe(30000)
    expect(fullBarsFor('5')).toBe(30000)
    expect(fullBarsFor('1')).toBe(20000)
    // Every target must exceed the shallow first-paint window and stay within
    // the API's 60000-bar ceiling.
    for (const tf of ['D', 'W', 'M', '1', '5', '15', '30', '60']) {
      expect(fullBarsFor(tf)).toBeGreaterThan(FIRST_PAINT_BARS)
      expect(fullBarsFor(tf)).toBeLessThanOrEqual(60000)
    }
  })

  const base = { fromIndex: 10, toIndex: 210, loadedCount: 600, fullTarget: 5000 }

  it('triggers when panned to the left edge while zoomed in', () => {
    expect(shouldBackfill(base)).toBe(true)
  })

  it('does NOT trigger on the initial full-series view (width ≈ loadedCount)', () => {
    expect(shouldBackfill({ ...base, fromIndex: 0, toIndex: 600 })).toBe(false)
  })

  it('does NOT trigger at the default right-edge view (left edge not in view)', () => {
    expect(shouldBackfill({ ...base, fromIndex: 400, toIndex: 600 })).toBe(false)
  })

  it('does NOT trigger once loaded depth has reached the full target', () => {
    expect(shouldBackfill({ ...base, loadedCount: 5000 })).toBe(false)
  })

  it('respects the edge threshold boundary', () => {
    expect(shouldBackfill({ ...base, fromIndex: 50, toIndex: 250 })).toBe(true)
    expect(shouldBackfill({ ...base, fromIndex: 51, toIndex: 251 })).toBe(false)
  })
})
