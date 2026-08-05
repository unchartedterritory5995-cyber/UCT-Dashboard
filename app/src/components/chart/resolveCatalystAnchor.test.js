import { describe, it, expect } from 'vitest'
import { resolveCatalystAnchor } from './ChartDrawingOverlay'

// Build a day of 5-minute intraday bars (numeric ET-anchored unix seconds).
function intradayDay(day, { bigAt = [], bigVol = 1000, baseVol = 100 } = {}) {
  const t0 = Math.floor(Date.parse(`${day}T13:30:00Z`) / 1000) // 9:30 ET (EDT)
  const bars = []
  for (let i = 0; i < 80; i++) {
    bars.push({ t: t0 + i * 300, o: 100, h: 101, l: 99, c: 100, v: baseVol })
  }
  bigAt.forEach((i, k) => { bars[i].v = Array.isArray(bigVol) ? bigVol[k] : bigVol })
  return bars
}

describe('resolveCatalystAnchor', () => {
  it('daily/weekly (string bar times) defers to nearestIndex', () => {
    const bars = [{ t: '2026-08-04' }, { t: '2026-08-05' }, { t: '2026-08-06' }]
    const nearest = () => 1
    expect(resolveCatalystAnchor('2026-08-05', bars, nearest)).toBe(1)
  })

  it('intraday: snaps a date anchor to the FIRST big-volume candle of that session', () => {
    // Peak volume at index 31; index 30 is the first candle >= 50% of the peak.
    const bars = intradayDay('2026-08-05', { bigAt: [30, 31], bigVol: [800, 1000] })
    const idx = resolveCatalystAnchor('2026-08-05', bars, () => null)
    expect(idx).toBe(30)
  })

  it('intraday: falls back to the max-volume candle when nothing crosses the threshold', () => {
    // All equal except one slightly higher → that one is both the first >=50% and the max.
    const bars = intradayDay('2026-08-05', { bigAt: [42], bigVol: 250, baseVol: 100 })
    const idx = resolveCatalystAnchor('2026-08-05', bars, () => null)
    expect(idx).toBe(42)
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
