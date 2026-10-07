import { describe, expect, it } from 'vitest'
import { authorityColumn, barDate, fundamentalColumnWithAuthority } from './marketCapAuthority'

const pts = [['2024-06-06', 2.97e12], ['2024-06-07', 2.96e12], ['2024-06-10', 2.97e12], ['2024-06-12', 3.1e12]]

describe('marketCapAuthority (dark thin consumer)', () => {
  it('normalizes bar times', () => {
    expect(barDate('2024-06-07')).toBe('2024-06-07')
    expect(barDate(1717718400)).toBe('2024-06-07')
    expect(barDate({ year: 2024, month: 6, day: 7 })).toBe('2024-06-07')
  })

  it('daily: exact date join, a missing authority day stays a gap (no forward fill)', () => {
    const bars = ['2024-06-07', '2024-06-10', '2024-06-11', '2024-06-12'].map((time) => ({ time }))
    const col = authorityColumn(pts, bars, 'D')
    expect(col[0]).toBe(2.96e12)
    expect(col[1]).toBe(2.97e12)
    expect(Number.isNaN(col[2])).toBe(true)
    expect(col[3]).toBe(3.1e12)
  })

  it('weekly: the last authority value inside each period', () => {
    const bars = [{ time: '2024-06-03' }, { time: '2024-06-10' }]
    expect(authorityColumn(pts, bars, 'W')).toEqual([2.96e12, 3.1e12])
  })

  it('intraday is not computable from a daily authority', () => {
    expect(authorityColumn(pts, [{ time: 1717767000 }], '5')).toBeNull()
  })

  it('market_cap uses the authority when supplied; never close x shares', () => {
    const bars = [{ time: '2024-06-07' }]
    const ctx = { bars, tf: 'D', sym: 'NVDA', marketCapAuthority: new Map([['NVDA', pts]]), fundamentals: new Map(), closeOf: () => [1] }
    expect(fundamentalColumnWithAuthority({ kind: 'fundamental', metric: 'market_cap' }, ctx)).toEqual([2.96e12])
  })

  it('without authority data it falls back to the existing path unchanged (null here: no fundamentals loaded)', () => {
    const ctx = { bars: [{ time: '2024-06-07' }], tf: 'D', sym: 'NVDA', fundamentals: new Map() }
    expect(fundamentalColumnWithAuthority({ kind: 'fundamental', metric: 'market_cap' }, ctx)).toBeNull()
  })
})
