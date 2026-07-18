import { describe, it, expect } from 'vitest'
import { shouldApplyRange } from './rangeGuard'

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
})
