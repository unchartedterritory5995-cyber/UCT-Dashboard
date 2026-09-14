// app/src/pages/breadth/percentile.test.js
import { describe, it, expect } from 'vitest'
import { percentileOf, latestValue, latestPoint, comparableCount } from './percentile'

describe('percentileOf', () => {
  it('reports the share of observations at or below the value', () => {
    expect(percentileOf([1, 2, 3, 4], 3)).toBe(75)
    expect(percentileOf([1, 2, 3, 4], 4)).toBe(100)
    expect(percentileOf([1, 2, 3, 4], 1)).toBe(25)
  })

  it('ignores nulls and non-numbers rather than counting them as zero', () => {
    expect(percentileOf([1, null, 2, undefined, 3, 'x', 4], 3)).toBe(75)
  })

  // A percentile from one point is not a percentile. Showing 100 would read as
  // an extreme when it only means there is nothing to compare against.
  it('refuses to invent a percentile from too few points', () => {
    expect(percentileOf([5], 5)).toBeNull()
    expect(percentileOf([], 1)).toBeNull()
    expect(percentileOf(undefined, 1)).toBeNull()
    expect(percentileOf([1, 2], null)).toBeNull()
  })
})

describe('latestValue', () => {
  const rows = [
    { date: 'a', vix: 15 },
    { date: 'b', vix: 16 },
    { date: 'c', vix: null },
  ]

  it('takes the last non-null value, not the last row', () => {
    expect(latestValue(rows, 'vix')).toBe(16)
  })

  it('returns null when the metric is absent everywhere', () => {
    expect(latestValue(rows, 'nope')).toBeNull()
    expect(latestValue([], 'vix')).toBeNull()
  })
})

describe('latestPoint', () => {
  const rows = [
    { date: '2026-08-06', vix: 15 },
    { date: '2026-08-07', vix: 16 },
    { date: '2026-08-10', vix: null },
  ]

  it('carries the row index and date of the newest numeric reading', () => {
    expect(latestPoint(rows, 'vix')).toEqual({ value: 16, index: 1, date: '2026-08-07' })
  })

  it('returns null when nothing is numeric', () => {
    expect(latestPoint(rows, 'nope')).toBeNull()
    expect(latestPoint([], 'vix')).toBeNull()
  })
})

describe('comparableCount', () => {
  it('counts only the observations a percentile can compare against', () => {
    expect(comparableCount([1, null, 2, undefined, NaN, 'x', 3])).toBe(3)
    expect(comparableCount(undefined)).toBe(0)
  })
})
