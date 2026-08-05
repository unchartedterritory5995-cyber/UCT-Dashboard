import { describe, it, expect } from 'vitest'
import { resolveCatalystAnchor } from './ChartDrawingOverlay'

// Build a day of 5-minute intraday bars (numeric ET-anchored unix seconds).
// bigVolAt/bigRangeAt inject volume / range expansion at specific indices.
function intradayDay(day, {
  bigVolAt = [], bigVol = 1000, baseVol = 100,
  bigRangeAt = [], bigRange = 20,
} = {}) {
  const t0 = Math.floor(Date.parse(`${day}T13:30:00Z`) / 1000) // 9:30 ET (EDT)
  const bars = []
  for (let i = 0; i < 80; i++) {
    bars.push({ t: t0 + i * 300, o: 100, h: 101, l: 99, c: 100, v: baseVol }) // range = 2
  }
  bigVolAt.forEach((i, k) => { bars[i].v = Array.isArray(bigVol) ? bigVol[k] : bigVol })
  bigRangeAt.forEach((i, k) => {
    const r = Array.isArray(bigRange) ? bigRange[k] : bigRange
    bars[i].h = 100 + r / 2
    bars[i].l = 100 - r / 2
  })
  return bars
}

describe('resolveCatalystAnchor', () => {
  it('daily/weekly (string bar times) defers to nearestIndex', () => {
    const bars = [{ t: '2026-08-04' }, { t: '2026-08-05' }, { t: '2026-08-06' }]
    const nearest = () => 1
    expect(resolveCatalystAnchor('2026-08-05', bars, nearest)).toBe(1)
  })

  it('intraday: snaps to the FIRST candle expanding on BOTH range and volume', () => {
    // Index 10 = a big-VOLUME-only open surge (small range) — must be SKIPPED.
    // Index 30 = big volume AND big range = where the news broke → expected.
    const bars = intradayDay('2026-08-05', {
      bigVolAt: [10, 30], bigVol: 1500, bigRangeAt: [30], bigRange: 20,
    })
    expect(resolveCatalystAnchor('2026-08-05', bars, () => null)).toBe(30)
  })

  it('intraday: falls back to the greatest combined range×volume expansion', () => {
    // Nothing crosses 2× both, but index 42 is elevated on both → highest product.
    const bars = intradayDay('2026-08-05', {
      bigVolAt: [42], bigVol: 150, bigRangeAt: [42], bigRange: 3,
    })
    expect(resolveCatalystAnchor('2026-08-05', bars, () => null)).toBe(42)
  })

  it('intraday: returns null (defers) when the anchor day is not in the loaded bars', () => {
    const bars = intradayDay('2026-08-04')
    expect(resolveCatalystAnchor('2026-08-05', bars, () => null)).toBe(null)
  })

  it('ignores a non-date anchor / empty bars gracefully', () => {
    expect(resolveCatalystAnchor(null, [], () => null)).toBe(null)
    const bars = intradayDay('2026-08-05')
    // A numeric anchor that equals a bar time defers to nearestIndex.
    expect(resolveCatalystAnchor(bars[5].t, bars, () => 5)).toBe(5)
  })
})
