import { describe, it, expect } from 'vitest'
import { classifySession, computeSessionBands } from './sessionShadingPrimitive'

// classifySession was rewritten from `new Date(tSec*1000).getUTCHours()` to pure
// arithmetic — it runs once per bar per band pass on a chart that can hold 5000
// extended-hours bars, and the Date allocations were GC pressure mid-pan. These pin
// that the arithmetic form agrees with the Date form at and around every boundary.

// The reference implementation this replaced.
const viaDate = (tSec) => {
  if (!Number.isFinite(tSec)) return null
  const d = new Date(tSec * 1000)
  const m = d.getUTCHours() * 60 + d.getUTCMinutes()
  if (m >= 240 && m < 570) return 'pre'
  if (m >= 960 && m < 1200) return 'post'
  return null
}

const at = (h, m = 0) => 1750000000 - (1750000000 % 86400) + h * 3600 + m * 60

describe('classifySession', () => {
  it.each([
    ['03:59 — closed', at(3, 59), null],
    ['04:00 — pre opens', at(4, 0), 'pre'],
    ['09:29 — last pre minute', at(9, 29), 'pre'],
    ['09:30 — RTH, unshaded', at(9, 30), null],
    ['15:59 — still RTH', at(15, 59), null],
    ['16:00 — post opens', at(16, 0), 'post'],
    ['19:59 — last post minute', at(19, 59), 'post'],
    ['20:00 — closed', at(20, 0), null],
    ['00:00 — overnight', at(0, 0), null],
  ])('%s', (_label, t, expected) => {
    expect(classifySession(t)).toBe(expected)
  })

  it('agrees with the Date-based original across a full day, minute by minute', () => {
    for (let m = 0; m < 1440; m++) {
      const t = at(0, m)
      expect(classifySession(t), `minute ${m}`).toBe(viaDate(t))
    }
  })

  it('agrees across a week of arbitrary seconds (fractional + non-aligned)', () => {
    const base = at(0, 0)
    for (let i = 0; i < 2000; i++) {
      const t = base + i * 307 + 17   // deliberately co-prime with 60 and 86400
      expect(classifySession(t), `t=${t}`).toBe(viaDate(t))
    }
  })

  it('rejects non-finite input instead of throwing', () => {
    for (const bad of [NaN, Infinity, -Infinity, null, undefined, 'x']) {
      expect(classifySession(bad)).toBeNull()
    }
  })

  it('stays total for a negative (pre-1970) timestamp', () => {
    expect(() => classifySession(-86400 + at(5, 0) % 86400)).not.toThrow()
    expect(classifySession(-86400 * 3 + 5 * 3600)).toBe('pre')
  })
})

describe('computeSessionBands', () => {
  const bars = (times) => times.map((t) => ({ t }))

  it('groups consecutive same-session bars into one band', () => {
    const b = computeSessionBands(bars([at(4, 0), at(4, 5), at(4, 10), at(10, 0), at(16, 0), at(16, 5)]))
    expect(b).toEqual([
      { from: at(4, 0), to: at(4, 10), type: 'pre' },
      { from: at(16, 0), to: at(16, 5), type: 'post' },
    ])
  })

  it('applies the ET shift before classifying AND to the emitted band bounds', () => {
    const shift = (t) => t + 3600            // pretend offset
    // 03:30 raw shifts to 04:30 → inside pre.
    const b = computeSessionBands(bars([at(3, 30)]), shift)
    expect(b).toEqual([{ from: at(4, 30), to: at(4, 30), type: 'pre' }])
  })

  it('returns no bands for an all-RTH series or an empty input', () => {
    expect(computeSessionBands(bars([at(10, 0), at(11, 0)]))).toEqual([])
    expect(computeSessionBands([])).toEqual([])
    expect(computeSessionBands(null)).toEqual([])
  })
})
