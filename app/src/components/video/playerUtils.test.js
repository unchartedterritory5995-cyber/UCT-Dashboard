import { describe, it, expect } from 'vitest'
import { fmtTime, nextRate, RATES, clampMiniPos } from './playerUtils'

describe('fmtTime', () => {
  it('formats seconds as m:ss under an hour', () => {
    expect(fmtTime(0)).toBe('0:00')
    expect(fmtTime(9)).toBe('0:09')
    expect(fmtTime(75)).toBe('1:15')
    expect(fmtTime(605)).toBe('10:05')
  })
  it('formats with hours when ≥ 3600s', () => {
    expect(fmtTime(3661)).toBe('1:01:01')
  })
  it('guards against NaN / negative', () => {
    expect(fmtTime(NaN)).toBe('0:00')
    expect(fmtTime(-5)).toBe('0:00')
  })
})

describe('nextRate', () => {
  it('cycles through the rate ladder and wraps', () => {
    expect(nextRate(1)).toBe(1.25)
    expect(nextRate(2)).toBe(RATES[0])
  })
  it('falls back to 1x for an unknown rate', () => {
    expect(nextRate(0.7)).toBe(RATES[0])
  })
})

describe('clampMiniPos', () => {
  it('keeps the player fully on screen with margins', () => {
    // way off bottom-right → clamped inside
    const c = clampMiniPos({ x: 5000, y: 5000 }, 360, 202, 1280, 800, 18)
    expect(c.left).toBe(1280 - 360 - 8)
    expect(c.top).toBe(800 - 202 - 18 - 8)
  })
  it('clamps off-screen top-left back to the margin', () => {
    const c = clampMiniPos({ x: -100, y: -100 }, 360, 202, 1280, 800, 18)
    expect(c.left).toBe(8)
    expect(c.top).toBe(8)
  })
  it('respects bottom clearance (mobile tab bar)', () => {
    const c = clampMiniPos({ x: 10, y: 5000 }, 240, 135, 380, 700, 80)
    expect(c.top).toBe(700 - 135 - 80 - 8)
  })
})
