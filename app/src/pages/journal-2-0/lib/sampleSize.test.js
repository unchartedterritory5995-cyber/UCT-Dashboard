// Wave 13 lane 13B — R3's client home. Its PARITY with `sample_size.py` is held by
// tests/test_notebook_sample_size.py, which runs this very file under node; these cases hold the
// bands on their boundaries and the display contract every surface uses.
import { describe, it, expect } from 'vitest'
import { band, sample, wilson, tInterval, rateStat, meanStat, wordStat, WORDING, TOO_FEW_BELOW, NORMAL_FROM, roundHalfUp } from './sampleSize'

describe('sampleSize (R3)', () => {
  it('the bands sit on their boundaries: 9, 10, 24, 25', () => {
    expect([0, 9, 10, 24, 25, 100].map(band)).toEqual(['too_few', 'too_few', 'thin', 'thin', 'normal', 'normal'])
    expect([TOO_FEW_BELOW, NORMAL_FROM]).toEqual([10, 25])
    expect(sample(9)).toEqual({ n: 9, band: 'too_few', wording: 'too few to judge' })
    expect(sample(25)).toEqual({ n: 25, band: 'normal', wording: null })
  })

  it('a range rides in the thin band only', () => {
    expect(rateStat(5, 9).range).toBeNull()
    expect(rateStat(7, 12)).toEqual({ k: 7, n: 12, rate: 0.5833, band: 'thin', wording: 'thin sample', range: [0.32, 0.807] })
    expect(rateStat(12, 25).range).toBeNull()
    const v = [2.0, -1.0, 1.5, -1.0, 3.0, -0.5, 0.8, -1.0, 2.2, -1.0, 1.1, 0.4]
    expect(meanStat(v)).toEqual({ n: 12, mean: 0.5417, band: 'thin', wording: 'thin sample', range: [-0.374, 1.457] })
    expect(tInterval([1])).toBeNull()
    expect(wilson(0, 0)).toBeNull()
  })

  it('rounds half up, like the server', () => {
    expect(roundHalfUp(0.03125, 4)).toBe(0.0313)
  })

  it('wordStat: too few hides, thin carries its range, normal is plain', () => {
    const pct = (x) => `${Math.round(x * 100)}%`
    expect(wordStat(rateStat(5, 9), pct)).toEqual({ hidden: true, label: WORDING.too_few, rangeText: null })
    expect(wordStat(rateStat(7, 12), pct)).toEqual({ hidden: false, label: WORDING.thin, rangeText: '32% to 81%' })
    expect(wordStat(rateStat(12, 25), pct)).toEqual({ hidden: false, label: null, rangeText: null })
  })
})
