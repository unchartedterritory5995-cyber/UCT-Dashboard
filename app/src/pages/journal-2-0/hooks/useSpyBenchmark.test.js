/** closeAtOrBefore — the date resolver behind the vs-SPY overlay. */
import { describe, it, expect } from 'vitest'
import { closeAtOrBefore } from './useSpyBenchmark'

const CLOSES = [
  ['2026-08-17', 772.67],
  ['2026-08-18', 767.45],
  ['2026-08-20', 762.6],
]

describe('closeAtOrBefore', () => {
  it('exact trading-day match', () => {
    expect(closeAtOrBefore(CLOSES, '2026-08-18')).toBe(767.45)
  })
  it('holiday/weekend carries the prior session close forward', () => {
    expect(closeAtOrBefore(CLOSES, '2026-08-19')).toBe(767.45)
    expect(closeAtOrBefore(CLOSES, '2026-08-23')).toBe(762.6)
  })
  it('date before all bars → null, never a fabricated value', () => {
    expect(closeAtOrBefore(CLOSES, '2026-08-16')).toBeNull()
  })
  it('empty/null input → null', () => {
    expect(closeAtOrBefore([], '2026-08-18')).toBeNull()
    expect(closeAtOrBefore(null, '2026-08-18')).toBeNull()
  })
})
