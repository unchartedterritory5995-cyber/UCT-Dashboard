import { describe, it, expect } from 'vitest'
import {
  computeDefaultShares,
  computeSuggestedTarget,
  computeImpliedRiskPct,
} from './disciplineGuards'

describe('computeDefaultShares', () => {
  it('returns null when any input missing', () => {
    expect(computeDefaultShares({ accountSize: null, defaultSizePct: 5, entryPrice: 100 })).toBeNull()
    expect(computeDefaultShares({ accountSize: 100_000, defaultSizePct: null, entryPrice: 100 })).toBeNull()
    expect(computeDefaultShares({ accountSize: 100_000, defaultSizePct: 5, entryPrice: 0 })).toBeNull()
  })
  it('returns floor(positionDollars / entryPrice)', () => {
    expect(computeDefaultShares({ accountSize: 100_000, defaultSizePct: 5, entryPrice: 100 })).toBe(50)
    expect(computeDefaultShares({ accountSize: 100_000, defaultSizePct: 5, entryPrice: 33 })).toBe(151)
  })
})

describe('computeSuggestedTarget', () => {
  it('returns null when any input missing', () => {
    expect(computeSuggestedTarget({ side: 'Long', entryPrice: 100, stopPrice: 95, rMultiple: null })).toBeNull()
    expect(computeSuggestedTarget({ side: 'Long', entryPrice: 100, stopPrice: null, rMultiple: 2 })).toBeNull()
  })
  it('long: target = entry + R × (entry - stop)', () => {
    expect(computeSuggestedTarget({ side: 'Long', entryPrice: 100, stopPrice: 95, rMultiple: 2 })).toBeCloseTo(110)
  })
  it('short: target = entry - R × (stop - entry)', () => {
    expect(computeSuggestedTarget({ side: 'Short', entryPrice: 100, stopPrice: 105, rMultiple: 2 })).toBeCloseTo(90)
  })
})

describe('computeImpliedRiskPct', () => {
  it('returns null when any input missing or zero', () => {
    expect(computeImpliedRiskPct({ accountSize: null, shares: 50, entryPrice: 100, stopPrice: 95, side: 'Long' })).toBeNull()
    expect(computeImpliedRiskPct({ accountSize: 100_000, shares: 0, entryPrice: 100, stopPrice: 95, side: 'Long' })).toBeNull()
  })
  it('long: risk% = shares × (entry - stop) / accountSize × 100', () => {
    expect(computeImpliedRiskPct({ accountSize: 100_000, shares: 50, entryPrice: 100, stopPrice: 95, side: 'Long' })).toBeCloseTo(0.25)
  })
  it('short: risk% = shares × (stop - entry) / accountSize × 100', () => {
    expect(computeImpliedRiskPct({ accountSize: 100_000, shares: 50, entryPrice: 100, stopPrice: 105, side: 'Short' })).toBeCloseTo(0.25)
  })
  it('returns null when stop on wrong side of entry (long stop above)', () => {
    expect(computeImpliedRiskPct({ accountSize: 100_000, shares: 50, entryPrice: 100, stopPrice: 105, side: 'Long' })).toBeNull()
  })
})
