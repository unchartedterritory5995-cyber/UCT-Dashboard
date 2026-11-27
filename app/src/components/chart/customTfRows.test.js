// customTfRows.deriveCustomTf, the review of #2909's rails (2026-11-27):
//   (a) the regular and the extended view of the SAME base rows are two questions: two filed arrays, each its own
//       view's resample (the spec's `anchorMin` is in the signature);
//   (b) an NYSE half-day (2026-11-27, 13:00 close) resamples the same filed or fresh, and no 4h bucket of that day
//       opens after the early close in the regular view.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { deriveCustomTf, customSpecOf } from './customTfRows'
import { resampleForSpec } from '../../utils/resampleBars'
import * as nf from './neighborFrames'

// 60m rows, EST (UTC-5): `day` in November 2026, hours from 04:30 to 19:30 ET (pre, regular and post market)
const et = (day, h, m) => Math.floor(Date.UTC(2026, 10, day, h + 5, m) / 1000)
function hourlyDays(days) {
  const out = []
  let c = 50
  for (const d of days) {
    for (let h = 4; h <= 19; h++) {
      c += Math.sin(out.length / 5) * 0.4
      out.push({ t: et(d, h, 30), o: c - 0.2, h: c + 0.6, l: c - 0.7, c, v: 1000 + (out.length * 53) % 777 })
    }
  }
  return out
}

beforeEach(() => { nf.__setNeighborFramesForTests(true); nf.__resetDerivedForTests() })
afterEach(() => nf.__setNeighborFramesForTests(null))

describe('(a) regular vs extended on the same base rows', () => {
  it('two filed arrays, each the resample of its own view', () => {
    const all = hourlyDays([23, 24, 25])
    const rth = customSpecOf('240', false)
    const eth = customSpecOf('240', true)
    expect(nf.stableSig(rth)).not.toBe(nf.stableSig(eth))
    const a = deriveCustomTf(all, rth)
    const b = deriveCustomTf(all, eth)
    expect(b).not.toBe(a)
    expect(a).toEqual(resampleForSpec(all, rth))
    expect(b).toEqual(resampleForSpec(all, eth))
    expect(a.map((x) => x.t)).not.toEqual(b.map((x) => x.t))   // 09:30 grid vs 04:00 clock grid
    // each asked again: its own filed array, never the other's
    expect(deriveCustomTf(all, rth)).toBe(a)
    expect(deriveCustomTf(all, eth)).toBe(b)
  })
})

describe('(b) an NYSE half-day (2026-11-27, 13:00 close)', () => {
  const all = hourlyDays([24, 25, 27])
  it.each([['240', false], ['120', false], ['240', true]])('%s extended=%s: filed equals fresh equals the switch off', (tf, ext) => {
    const spec = customSpecOf(tf, ext)
    const fresh = resampleForSpec(all, spec)
    const filed = deriveCustomTf(all, spec)
    expect(filed).toEqual(fresh)
    nf.__setNeighborFramesForTests(false)
    expect(deriveCustomTf(all, spec)).toEqual(filed)
  })
  it('regular 4h: the half-day has one bucket (09:30) and none opens at or after the 13:00 close', () => {
    const bars = deriveCustomTf(all, customSpecOf('240', false))
    const day = bars.filter((x) => x.t >= et(27, 0, 0))
    expect(day.map((x) => x.t)).toEqual([et(27, 9, 30)])
    // a full day keeps its two (09:30, 13:30)
    expect(bars.filter((x) => x.t >= et(25, 0, 0) && x.t < et(26, 0, 0)).map((x) => x.t)).toEqual([et(25, 9, 30), et(25, 13, 30)])
  })
})
