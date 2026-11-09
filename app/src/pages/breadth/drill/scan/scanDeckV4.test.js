import { describe, it, expect } from 'vitest'
import { dayContext, describeReading } from './scanDeckModel'
import { sortGridRows } from './gridSort'

// Newest first, the way Breadth.jsx holds rows. 300 settled sessions whose
// count climbs 1, 2, 3… going back in time.
const rows = Array.from({ length: 300 }, (_, i) => ({
  date: `2026-${String(12 - Math.floor(i / 28)).padStart(2, '0')}-${String(28 - (i % 28)).padStart(2, '0')}`,
  up: i === 0 ? 30 : i,
  breadth_score: 50,
}))

describe('the masthead reading, in words', () => {
  it('gives the past-year range and the typical day', () => {
    const ctx = dayContext(rows, 'up', rows[0].date)
    expect(ctx.sample).toBe(252)
    expect(ctx.min).toBe(1)
    expect(ctx.max).toBe(251)
    expect(ctx.median).toBeGreaterThan(100)
  })
  it('a low day reads as "Fewer than on N% of days in the past year"', () => {
    const r = describeReading(dayContext(rows, 'up', rows[0].date))
    expect(r.label).toBe('Below normal')
    expect(r.sentence).toMatch(/^Fewer than on 88% of days in the past year$/)
  })
  it('a high day reads as "More than on N%"', () => {
    const r = describeReading({ value: 9, pctile: 95, sample: 252 })
    expect(r).toMatchObject({ tone: 'hot', label: 'Unusually high', sentence: 'More than on 95% of days in the past year' })
  })
  it('a short history names its window instead of claiming a year', () => {
    expect(describeReading({ value: 9, pctile: 50, sample: 40 }).sentence).toBe('More than on 50% of days in the last 40 sessions')
  })
  it('says nothing rather than guess without a ranking', () => {
    expect(describeReading({ value: 9, pctile: null, sample: 5 })).toBeNull()
    expect(describeReading(null)).toBeNull()
  })
})

describe('Grid sort', () => {
  const g = [
    { sym: 'BBB', pct: -9, rvol: 1 },
    { sym: 'AAA', pct: 12, rvol: null },
    { sym: 'CCC', pct: -4, rvol: 3 },
  ]
  it('% change leads with the biggest mover in the list direction', () => {
    expect(sortGridRows(g, 'pct', 1).map(r => r.sym)).toEqual(['AAA', 'CCC', 'BBB'])
    expect(sortGridRows(g, 'pct', -1).map(r => r.sym)).toEqual(['BBB', 'CCC', 'AAA'])
  })
  it('a missing value sorts last, never first', () => {
    expect(sortGridRows(g, 'rvol').map(r => r.sym)).toEqual(['CCC', 'BBB', 'AAA'])
  })
  it('symbol sorts A→Z and never mutates the input', () => {
    expect(sortGridRows(g, 'sym').map(r => r.sym)).toEqual(['AAA', 'BBB', 'CCC'])
    expect(g[0].sym).toBe('BBB')
  })
})
