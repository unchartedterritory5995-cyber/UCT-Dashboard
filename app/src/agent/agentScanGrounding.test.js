// SG-1 / SG-2 (AUDIT live prod f591d31720, 2026-11-04) — the pure parts of the two scan fixes (capabilities/screener.js).
// SG-1: a distance from a HIGH is stored NEGATIVE (0 at the high, −5 five percent below), from a LOW positive; a threshold
// on the wrong side of zero is read on the field's own side. SG-2: a sector word is the sector field's value.
// The end-to-end proof (every returned row satisfies the condition) is capreg scan.near-high.* / scan.sector-word.
import { describe, it, expect } from 'vitest'
import { distanceSign, signedDistance, sectorNamed } from './capabilities/screener'

const HIGH = { key: 'dist_52w_high_pct', label: 'Dist from 52W High' }
const LOW = { key: 'dist_52w_low_pct', label: 'Dist from 52W Low' }
const f = (op, value, max = null) => ({ field: 'x', op, value, max, values: null })

describe('SG-1 distance sign', () => {
  it('knows each distance field family by its key', () => {
    for (const k of ['dist_52w_high_pct', 'dist_20d_high_pct', 'dist_ath_pct']) expect(distanceSign(k)).toBe('neg')
    expect(distanceSign('dist_52w_low_pct')).toBe('pos')
    for (const k of ['pct_vs_ema20', 'gap_pct', 'price', '', null]) expect(distanceSign(k)).toBeNull()
  })
  it('the live defect: "≤ 5" on the distance from the high is read as "≥ −5" (within 5% of the high), and said', () => {
    const r = signedDistance(f('lte', 5), HIGH)
    expect(r.x).toMatchObject({ op: 'gte', value: -5 })
    expect(r.note).toMatch(/measured below the high.*read as Dist from 52W High ≥ -5%/)
    expect(signedDistance(f('lt', 5), HIGH).x).toMatchObject({ op: 'gt', value: -5 })
    expect(signedDistance(f('gte', 20), HIGH).x).toMatchObject({ op: 'lte', value: -20 })      // "20%+ off the high"
    expect(signedDistance(f('between', 0, 5), HIGH).x).toMatchObject({ op: 'between', value: -5, max: 0 })
    expect(signedDistance(f('between', 2, 5), HIGH).x).toMatchObject({ value: -5, max: -2 })
  })
  it('a correctly signed filter, a zero, or a non-distance field is left exactly as it was', () => {
    for (const x of [f('gte', -5), f('lte', -20), f('gte', 0), f('between', -5, 0)]) expect(signedDistance(x, HIGH)).toEqual({ x, note: null })
    expect(signedDistance(f('lte', 5), { key: 'gap_pct', label: 'Gap %' })).toEqual({ x: f('lte', 5), note: null })
  })
  it('a distance from the LOW is positive: a negative threshold is mirrored', () => {
    expect(signedDistance(f('lte', -10), LOW).x).toMatchObject({ op: 'gte', value: 10 })
    expect(signedDistance(f('gte', 10), LOW)).toEqual({ x: f('gte', 10), note: null })
  })
})

describe('SG-2 sector words', () => {
  const SECTORS = ['Technology', 'Healthcare', 'Energy', 'Financial Services', 'Consumer Cyclical', 'Communication Services']
  it('maps common sector names to the value the sector field really holds', () => {
    expect(sectorNamed('tech', SECTORS)).toBe('Technology')
    expect(sectorNamed('technology', SECTORS)).toBe('Technology')
    expect(sectorNamed('Health Care', SECTORS)).toBe('Healthcare')
    expect(sectorNamed('financials', SECTORS)).toBe('Financial Services')
    expect(sectorNamed('consumer discretionary', SECTORS)).toBe('Consumer Cyclical')
    expect(sectorNamed('communications', SECTORS)).toBe('Communication Services')
    expect(sectorNamed('energy', SECTORS)).toBe('Energy')
  })
  it('an industry word, or a sector the field does not hold, is not a sector', () => {
    for (const w of ['semiconductors', 'software', 'banks', 'information technology services']) expect(sectorNamed(w, SECTORS)).toBeNull()
    // review #815: industry-level words keep their industry (never widened to a whole sector)
    for (const w of ['telecom', 'oil and gas', 'medical', 'reits', 'reit']) expect(sectorNamed(w, [...SECTORS, 'Real Estate'])).toBeNull()
    expect(sectorNamed('utilities', SECTORS)).toBeNull()
  })
})
