import { describe, it, expect } from 'vitest'
import {
  toHeikinAshi,
  computeRSI,
  computeMACD,
  computeBB,
  computeVWAP,
} from './indicators'

describe('toHeikinAshi', () => {
  it('returns same length as input', () => {
    const bars = [
      { t: 1, o: 100, h: 102, l: 99, c: 101 },
      { t: 2, o: 101, h: 103, l: 100, c: 102 },
    ]
    expect(toHeikinAshi(bars).length).toBe(2)
  })

  it('handles empty input', () => {
    expect(toHeikinAshi([])).toEqual([])
  })

  it('first HA candle math matches spec', () => {
    const bars = [{ t: 1, o: 100, h: 110, l: 90, c: 105 }]
    const [ha] = toHeikinAshi(bars)
    // Seeds (computed before loop):
    //   prevHaOpen  = (o+c)/2 = (100+105)/2 = 102.5
    //   prevHaClose = (o+h+l+c)/4 = (100+110+90+105)/4 = 101.25
    // First iteration:
    //   haClose = (100+110+90+105)/4 = 101.25
    //   haOpen  = (102.5 + 101.25)/2 = 101.875
    //   haHigh  = max(110, 101.875, 101.25) = 110
    //   haLow   = min(90, 101.875, 101.25)  = 90
    expect(ha.c).toBeCloseTo(101.25, 5)
    expect(ha.o).toBeCloseTo(101.875, 5)
    expect(ha.h).toBe(110)
    expect(ha.l).toBe(90)
  })
})

describe('computeRSI', () => {
  it('returns empty for too-small input', () => {
    expect(computeRSI([{ c: 1 }, { c: 2 }], 14)).toEqual([])
    expect(computeRSI(null, 14)).toEqual([])
  })

  it('all-gain series produces RSI = 100', () => {
    const bars = Array.from({ length: 20 }, (_, i) => ({ t: i, c: 10 + i }))
    const rsi = computeRSI(bars, 14)
    expect(rsi.length).toBe(20 - 14)
    // every value should be 100 (no losses)
    rsi.forEach(({ value }) => expect(value).toBe(100))
  })

  it('returns {time, value} objects with reasonable RSI range', () => {
    const bars = Array.from({ length: 30 }, (_, i) => ({
      t: i,
      c: 100 + Math.sin(i / 3) * 5,
    }))
    const rsi = computeRSI(bars, 14)
    expect(rsi.length).toBe(16)
    rsi.forEach(({ time, value }) => {
      expect(typeof time).toBe('number')
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(100)
    })
  })
})

describe('computeMACD', () => {
  it('returns empty arrays for too-small input', () => {
    const bars = Array.from({ length: 10 }, (_, i) => ({ t: i, c: 100 + i }))
    const r = computeMACD(bars)
    expect(r.macd).toEqual([])
    expect(r.signal).toEqual([])
    expect(r.histogram).toEqual([])
  })

  it('returns 3 arrays of equal length when input is large enough', () => {
    const bars = Array.from({ length: 100 }, (_, i) => ({ t: i, c: 100 + i * 0.5 }))
    const { macd, signal, histogram } = computeMACD(bars)
    expect(macd.length).toBeGreaterThan(0)
    expect(macd.length).toBe(signal.length)
    expect(macd.length).toBe(histogram.length)
    // each entry has time + value
    macd.forEach(p => {
      expect(typeof p.time).toBe('number')
      expect(Number.isFinite(p.value)).toBe(true)
    })
  })

  it('histogram color is green when MACD >= signal, red otherwise', () => {
    const bars = Array.from({ length: 100 }, (_, i) => ({ t: i, c: 100 + i }))
    const { histogram } = computeMACD(bars)
    histogram.forEach(h => {
      expect(['rgba(76,175,80,0.75)', 'rgba(244,67,54,0.75)']).toContain(h.color)
    })
  })
})

describe('computeBB', () => {
  it('returns empty for too-small input', () => {
    const bars = Array.from({ length: 5 }, (_, i) => ({ t: i, c: 100 + i }))
    const r = computeBB(bars, 20, 2)
    expect(r.upper).toEqual([])
    expect(r.middle).toEqual([])
    expect(r.lower).toEqual([])
  })

  it('upper >= middle >= lower for all valid samples', () => {
    const bars = Array.from({ length: 50 }, (_, i) => ({
      t: i,
      c: 100 + Math.sin(i / 5) * 5,
    }))
    const { upper, middle, lower } = computeBB(bars, 20, 2)
    expect(upper.length).toBe(50 - 19)
    upper.forEach((u, i) => {
      expect(u.value).toBeGreaterThanOrEqual(middle[i].value)
      expect(middle[i].value).toBeGreaterThanOrEqual(lower[i].value)
    })
  })

  it('middle band equals SMA over period', () => {
    const bars = Array.from({ length: 20 }, (_, i) => ({ t: i, c: 100 + i }))
    const { middle } = computeBB(bars, 20, 2)
    // SMA of 100..119 = (100 + 119) / 2 = 109.5
    expect(middle[0].value).toBeCloseTo(109.5, 4)
  })
})

describe('computeVWAP', () => {
  it('returns array same length as bars (when volume > 0)', () => {
    const bars = [
      { t: 1715085600, h: 100.5, l: 99.5, c: 100, v: 1000 },
      { t: 1715085660, h: 100.6, l: 99.7, c: 100.2, v: 500 },
    ]
    const vwap = computeVWAP(bars)
    expect(vwap.length).toBe(2)
    vwap.forEach(p => expect(Number.isFinite(p.value)).toBe(true))
  })

  it('returns empty for empty input', () => {
    expect(computeVWAP([])).toEqual([])
    expect(computeVWAP(null)).toEqual([])
  })

  it('first bar VWAP equals typical price', () => {
    const bars = [{ t: 1715085600, h: 102, l: 98, c: 100, v: 1000 }]
    const [v] = computeVWAP(bars)
    // typical = (102 + 98 + 100) / 3 = 100
    expect(v.value).toBeCloseTo(100, 4)
  })

  it('resets cumulative on new UTC day', () => {
    // two bars on consecutive UTC days; second VWAP should equal that bar's typical price
    const day1 = 1715085600 // 2026-05-07 14:00 UTC (approx)
    const day2 = day1 + 86400
    const bars = [
      { t: day1, h: 110, l: 90, c: 100, v: 10000 },
      { t: day2, h: 220, l: 200, c: 210, v: 5000 },
    ]
    const vwap = computeVWAP(bars)
    expect(vwap.length).toBe(2)
    // day 2 typical = (220 + 200 + 210)/3 = 210
    expect(vwap[1].value).toBeCloseTo(210, 4)
  })
})
