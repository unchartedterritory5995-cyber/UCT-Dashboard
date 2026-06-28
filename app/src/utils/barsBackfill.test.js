import { describe, it, expect } from 'vitest'
import { FIRST_PAINT_BARS, fullBarsFor, shouldBackfill } from './barsBackfill'

describe('barsBackfill', () => {
  it('FIRST_PAINT_BARS is a small shallow window', () => {
    expect(FIRST_PAINT_BARS).toBe(600)
  })

  it('fullBarsFor: deep per-timeframe history targets', () => {
    // Daily reaches IPO for any US equity; W/M decades; intraday multi-year.
    expect(fullBarsFor('D')).toBe(20000)
    expect(fullBarsFor('W')).toBe(4000)
    expect(fullBarsFor('M')).toBe(1200)
    expect(fullBarsFor('60')).toBe(22000)
    expect(fullBarsFor('30')).toBe(28000)
    expect(fullBarsFor('15')).toBe(26000)
    expect(fullBarsFor('5')).toBe(26000)
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
