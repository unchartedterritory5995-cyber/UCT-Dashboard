import { describe, it, expect } from 'vitest'
import { shouldApplyRange, rangeFitsBars, rangeTimeSec, viewMostlyBars } from './rangeGuard'

describe('shouldApplyRange', () => {
  it('applies when there is no prior range', () => {
    expect(shouldApplyRange({ from: 100, to: 200 }, null)).toBe(true)
  })
  it('skips a near-identical range (within epsilon on both ends)', () => {
    expect(shouldApplyRange({ from: 101, to: 199 }, { from: 100, to: 200 }, 2)).toBe(false)
  })
  it('applies when either end moved beyond epsilon', () => {
    expect(shouldApplyRange({ from: 100, to: 260 }, { from: 100, to: 200 }, 2)).toBe(true)
    expect(shouldApplyRange({ from: 140, to: 200 }, { from: 100, to: 200 }, 2)).toBe(true)
  })
  it('rejects a malformed incoming range', () => {
    expect(shouldApplyRange(null, { from: 100, to: 200 })).toBe(false)
    expect(shouldApplyRange({ from: 'x', to: 200 }, null)).toBe(false)
  })
  it('reads a D/W/M range: its ends are dates, not numbers', () => {
    const r = { from: '2026-01-02', to: '2026-04-01' }
    expect(shouldApplyRange(r, null)).toBe(true)
    expect(shouldApplyRange(r, { from: '2026-01-02', to: '2026-04-01' })).toBe(false)
    expect(shouldApplyRange(r, { from: '2026-01-05', to: '2026-04-01' })).toBe(true)
  })
  it('compares a daily range with an intraday one in the same seconds', () => {
    const sec = Date.UTC(2026, 0, 2) / 1000
    expect(shouldApplyRange({ from: '2026-01-02', to: '2026-01-02' }, { from: sec + 1, to: sec })).toBe(false)
  })
})

describe('rangeTimeSec', () => {
  it('takes every time a chart can carry', () => {
    const sec = Date.UTC(2026, 2, 4) / 1000
    expect(rangeTimeSec(sec)).toBe(sec)
    expect(rangeTimeSec('2026-03-04')).toBe(sec)
    expect(rangeTimeSec({ year: 2026, month: 3, day: 4 })).toBe(sec)
  })
  it('refuses what is no time', () => {
    for (const bad of [NaN, Infinity, 'soon', null, undefined, {}]) expect(rangeTimeSec(bad)).toBe(null)
  })
})

describe('rangeFitsBars', () => {
  const first = '2025-02-01', last = '2025-12-31'
  it('takes a range inside the bars, or mostly inside', () => {
    expect(rangeFitsBars({ from: '2025-03-01', to: '2025-09-01' }, first, last)).toBe(true)
    expect(rangeFitsBars({ from: '2025-01-15', to: '2025-06-01' }, first, last)).toBe(true)
  })
  it('refuses a range the chart holds a sliver of, or none of', () => {
    expect(rangeFitsBars({ from: '2024-06-01', to: '2025-02-03' }, first, last)).toBe(false)
    expect(rangeFitsBars({ from: '2024-06-01', to: '2024-09-01' }, first, last)).toBe(false)
    expect(rangeFitsBars({ from: '2026-02-01', to: '2026-03-01' }, first, last)).toBe(false)
  })
})

describe('viewMostlyBars', () => {
  it('passes a normal view, gap to the right of the newest bar included', () => {
    expect(viewMostlyBars({ from: 300, to: 400 }, 500)).toBe(true)
    expect(viewMostlyBars({ from: 400, to: 507 }, 500)).toBe(true)
  })
  it('stops a view scrolled off the end of the history', () => {
    expect(viewMostlyBars({ from: -120, to: 12 }, 500)).toBe(false)
    expect(viewMostlyBars({ from: 490, to: 620 }, 500)).toBe(false)
  })
  it('stops when it cannot tell', () => {
    expect(viewMostlyBars(null, 500)).toBe(false)
    expect(viewMostlyBars({ from: 1, to: 2 }, 0)).toBe(false)
  })
})
