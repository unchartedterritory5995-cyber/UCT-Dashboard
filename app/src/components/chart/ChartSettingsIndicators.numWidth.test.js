// An indicator's number field is wide enough for its whole value (owner, 2026-11-28: Fred RS's "For 99 stocks" 195.93
// showed as "195.9" in a 70px box). Short values keep the 70px floor (no inline width).
import { describe, it, expect } from 'vitest'
import { numFieldWidth } from './ChartSettingsIndicators'

describe('numFieldWidth', () => {
  it('keeps short values at the stylesheet width', () => {
    for (const v of [7200, 90, 30, 250, 1, '', null, undefined]) expect(numFieldWidth(v), String(v)).toBeUndefined()
  })
  it('widens for a longer value by its characters', () => {
    expect(numFieldWidth(195.93)).toEqual({ width: 'max(70px, calc(6ch + 34px))' })
    expect(numFieldWidth(1234567)).toEqual({ width: 'max(70px, calc(7ch + 34px))' })
  })
})
