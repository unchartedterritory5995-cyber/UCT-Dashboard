import { describe, it, expect } from 'vitest'
import { FIRST_PAINT_BARS, fullBarsFor, shouldBackfill } from './barsBackfill'

describe('barsBackfill', () => {
  it('FIRST_PAINT_BARS is a small shallow window', () => {
    expect(FIRST_PAINT_BARS).toBe(600)
  })

  it('fullBarsFor: 8000 for D/W, 5000 otherwise', () => {
    expect(fullBarsFor('D')).toBe(8000)
    expect(fullBarsFor('W')).toBe(8000)
    expect(fullBarsFor('M')).toBe(5000)
    expect(fullBarsFor('60')).toBe(5000)
    expect(fullBarsFor('5')).toBe(5000)
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
