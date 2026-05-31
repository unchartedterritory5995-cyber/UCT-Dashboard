import { describe, it, expect } from 'vitest'
import { classifySession, computeSessionBands } from './sessionShadingPrimitive'

// Bar timestamps are ET-offset unix seconds, so a UTC date built from them
// reads the Eastern clock. Build helper times at a fixed day.
const DAY = Math.floor(Date.UTC(2026, 4, 29) / 1000) // 2026-05-29 00:00 "ET"
const at = (h, m = 0) => DAY + h * 3600 + m * 60

describe('classifySession', () => {
  it('classifies pre-market (04:00–09:30)', () => {
    expect(classifySession(at(4, 0))).toBe('pre')
    expect(classifySession(at(8, 0))).toBe('pre')
    expect(classifySession(at(9, 29))).toBe('pre')
  })
  it('classifies regular hours as null', () => {
    expect(classifySession(at(9, 30))).toBe(null)
    expect(classifySession(at(12, 0))).toBe(null)
    expect(classifySession(at(15, 59))).toBe(null)
  })
  it('classifies post-market (16:00–20:00)', () => {
    expect(classifySession(at(16, 0))).toBe('post')
    expect(classifySession(at(19, 59))).toBe('post')
  })
  it('classifies overnight as null', () => {
    expect(classifySession(at(2, 0))).toBe(null)
    expect(classifySession(at(21, 0))).toBe(null)
  })
})

describe('computeSessionBands', () => {
  it('groups consecutive shaded bars into bands and breaks on regular hours', () => {
    const bars = [
      { t: at(8, 0) },   // pre
      { t: at(8, 30) },  // pre
      { t: at(10, 0) },  // rth (break)
      { t: at(16, 30) }, // post
      { t: at(17, 0) },  // post
    ]
    const bands = computeSessionBands(bars)
    expect(bands).toHaveLength(2)
    expect(bands[0]).toMatchObject({ from: at(8, 0), to: at(8, 30), type: 'pre' })
    expect(bands[1]).toMatchObject({ from: at(16, 30), to: at(17, 0), type: 'post' })
  })
  it('returns no bands for an all-regular-hours session', () => {
    expect(computeSessionBands([{ t: at(11, 0) }, { t: at(13, 0) }])).toEqual([])
  })
  it('handles empty input', () => {
    expect(computeSessionBands([])).toEqual([])
    expect(computeSessionBands(null)).toEqual([])
  })
})
