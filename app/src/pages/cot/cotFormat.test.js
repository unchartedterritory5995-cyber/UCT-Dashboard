import { describe, it, expect } from 'vitest'
import { fmtDate, fmtNum, fmtCompact, fmtSignedCompact, fmtPct } from './cotFormat'

describe('fmtDate', () => {
  it('renders ISO as M/D/YYYY without zero padding', () => {
    expect(fmtDate('2025-11-07')).toBe('11/7/2025')
  })
})

describe('fmtNum', () => {
  it('uses thousands separators and parentheses for negatives', () => {
    expect(fmtNum(113553)).toBe('113,553')
    expect(fmtNum(-113553)).toBe('(113,553)')
    expect(fmtNum(null)).toBe('')
  })
})

describe('fmtCompact', () => {
  it('compacts to K and M', () => {
    expect(fmtCompact(2072358)).toBe('2.07M')
    expect(fmtCompact(10560)).toBe('11K')
    expect(fmtCompact(512)).toBe('512')
  })
})

describe('fmtSignedCompact', () => {
  it('prefixes an arrow by direction and compacts the magnitude', () => {
    expect(fmtSignedCompact(5210)).toBe('▲ 5K')
    expect(fmtSignedCompact(-5210)).toBe('▼ 5K')
  })
  it('renders zero and null as a dash', () => {
    expect(fmtSignedCompact(0)).toBe('—')
    expect(fmtSignedCompact(null)).toBe('—')
  })
})

describe('fmtPct', () => {
  it('renders one decimal with a sign and a dash for null', () => {
    expect(fmtPct(-5.48)).toBe('−5.5%')
    expect(fmtPct(0.04)).toBe('+0.0%')
    expect(fmtPct(null)).toBe('—')
  })
})
