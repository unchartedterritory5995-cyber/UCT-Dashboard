import { describe, it, expect } from 'vitest'
import {
  fmtAge, fmtEarnDate, fmtEps, fmtPct, fmtQuarter, fmtRevenue, fmtShares, fmtVol, pctCell, websiteDomain,
} from './profileFormat'
import { fmtDate, fmtMove } from './feedFormat'

describe('profileFormat — one grammar for the Profile widget and the modal section', () => {
  it('percent / volume / shares / revenue / eps', () => {
    expect(fmtPct(42.5)).toBe('+43%')
    expect(fmtPct(-63.2)).toBe('-63%')
    expect(fmtPct(null)).toBe('—')
    expect(fmtVol(25e9)).toBe('$25.0B')
    expect(fmtVol(11.8e6)).toBe('$11.8M')
    expect(fmtVol(0)).toBe('—')
    expect(fmtShares(23.5e9)).toBe('23.5B')
    expect(fmtShares(null)).toBe('—')
    expect(fmtRevenue(1.234e9)).toBe('$1.23B')
    expect(fmtRevenue(0)).toBe('—')
    expect(fmtEps(1.234)).toBe('1.23')
    expect(fmtEps('x')).toBe('—')
    expect(fmtEps(null)).toBe('—')          // not a phantom 0.00
    expect(fmtEps(0)).toBe('0.00')          // a real zero is a real zero
  })
  it('surprise cells carry a direction, and a missing one is neutral', () => {
    expect(pctCell(12.4)).toEqual({ text: '+12%', dir: 1 })
    expect(pctCell(-0.4)).toEqual({ text: '+0%', dir: -1 })   // rounds to 0, direction kept
    expect(pctCell(-3.46)).toEqual({ text: '-3%', dir: -1 })
    expect(pctCell(null)).toEqual({ text: '—', dir: 0 })
  })
  it('dates and ages', () => {
    expect(fmtEarnDate('2026-08-27')).toBe('8/27/26')
    expect(fmtEarnDate(null)).toBe('—')
    expect(fmtQuarter({ quarter: 2, year: 2026 })).toBe('Q2 2026')
    const now = Date.parse('2026-08-21T00:00:00Z')
    expect(fmtAge('2024-08-21', now)).toBe('2.0 years')
    expect(fmtAge('2026-08-14', now)).toBe('1.0 weeks')
    expect(fmtAge('not-a-date', now)).toBe('—')
    expect(websiteDomain('https://www.nvidia.com/')).toBe('nvidia.com')
  })
})

describe('feedFormat — one grammar for the News & Catalysts widget and the modal section', () => {
  it('dates and moves', () => {
    expect(fmtDate('2026-05-21')).toBe('May 21, 2026')
    expect(fmtDate('')).toBe('')
    expect(fmtDate('junk')).toBe('junk')
    expect(fmtMove(12)).toBe('+12%')
    expect(fmtMove(-3.46)).toBe('-3.5%')
    expect(fmtMove('x')).toBe('')
  })
})
