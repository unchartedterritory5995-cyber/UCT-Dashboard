import { describe, it, expect } from 'vitest'
import {
  toHeikinAshi,
  computeRSI,
  computeMACD,
  computeBB,
  computeVWAP,
  computeMFI,
  computeCCI,
  computeWilliamsR,
  computeADX,
  computeOBV,
  computeDonchian,
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

// ─── New indicators ─────────────────────────────────────────────────────────

describe('computeMFI', () => {
  it('returns empty for too-small input', () => {
    expect(computeMFI([], 14)).toEqual([])
    expect(computeMFI(null, 14)).toEqual([])
    const bars = Array.from({ length: 5 }, (_, i) => ({ t: i, h: 10, l: 9, c: 9.5, v: 100 }))
    expect(computeMFI(bars, 14)).toEqual([])
  })

  it('all-rising typical price produces MFI = 100', () => {
    // typical price rises every bar → all flow is positive → NMF=0 → MFI=100
    const bars = Array.from({ length: 20 }, (_, i) => ({
      t: i, h: 10 + i, l: 9 + i, c: 9.5 + i, v: 1000,
    }))
    const mfi = computeMFI(bars, 14)
    expect(mfi.length).toBe(20 - 14)
    mfi.forEach(({ value }) => expect(value).toBe(100))
  })

  it('values are bounded 0..100', () => {
    const bars = Array.from({ length: 50 }, (_, i) => ({
      t: i,
      h: 100 + Math.sin(i / 3) * 5 + 1,
      l: 100 + Math.sin(i / 3) * 5 - 1,
      c: 100 + Math.sin(i / 3) * 5,
      v: 1000 + Math.cos(i / 2) * 200,
    }))
    const mfi = computeMFI(bars, 14)
    expect(mfi.length).toBe(50 - 14)
    mfi.forEach(({ time, value }) => {
      expect(typeof time).toBe('number')
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(100)
    })
  })

  it('hand-computed sample value over 2-period window', () => {
    // tp values: b0=10, b1=12 (rising → positive), b2=11 (falling → negative)
    // window over period=2 looks at i=1 and i=2 relative to their prev:
    //   bar1 dir+ : flow = 12 * 1000 = 12000  → PMF
    //   bar2 dir- : flow = 11 * 500  = 5500   → NMF
    // MFI = 100 - 100 / (1 + 12000/5500) = 100 - 100/(1 + 2.18181818...)
    //     = 100 - 100/3.18181818 = 100 - 31.4285714... = 68.5714286
    const bars = [
      { t: 0, h: 11, l: 9,  c: 10, v: 1000 }, // tp=10
      { t: 1, h: 13, l: 11, c: 12, v: 1000 }, // tp=12, +
      { t: 2, h: 12, l: 10, c: 11, v: 500  }, // tp=11, -
    ]
    const mfi = computeMFI(bars, 2)
    expect(mfi.length).toBe(1)
    expect(mfi[0].value).toBeCloseTo(68.57, 2)
    expect(mfi[0].time).toBe(2)
  })
})

describe('computeCCI', () => {
  it('returns empty for too-small input', () => {
    expect(computeCCI([], 20)).toEqual([])
    expect(computeCCI(null, 20)).toEqual([])
    const bars = Array.from({ length: 5 }, (_, i) => ({ t: i, h: 10, l: 9, c: 9.5 }))
    expect(computeCCI(bars, 20)).toEqual([])
  })

  it('length equals N - period + 1', () => {
    const bars = Array.from({ length: 30 }, (_, i) => ({
      t: i, h: 10 + Math.sin(i) + 0.5, l: 10 + Math.sin(i) - 0.5, c: 10 + Math.sin(i),
    }))
    expect(computeCCI(bars, 20).length).toBe(11)
  })

  it('CCI is zero when typical price is constant', () => {
    const bars = Array.from({ length: 10 }, (_, i) => ({ t: i, h: 10, l: 10, c: 10 }))
    const cci = computeCCI(bars, 5)
    cci.forEach(({ value }) => expect(value).toBe(0))
  })

  it('hand-computed sample value', () => {
    // tp sequence: 10,11,12,13,14 — SMA(5) = 12, MAD = (2+1+0+1+2)/5 = 1.2
    // CCI = (14 - 12) / (0.015 * 1.2) = 2 / 0.018 = 111.111...
    const bars = [10, 11, 12, 13, 14].map((p, i) => ({ t: i, h: p, l: p, c: p }))
    const cci = computeCCI(bars, 5)
    expect(cci.length).toBe(1)
    expect(cci[0].value).toBeCloseTo(111.11, 1)
  })
})

describe('computeWilliamsR', () => {
  it('returns empty for too-small input', () => {
    expect(computeWilliamsR([], 14)).toEqual([])
    expect(computeWilliamsR(null, 14)).toEqual([])
  })

  it('values are bounded -100..0', () => {
    const bars = Array.from({ length: 30 }, (_, i) => ({
      t: i,
      h: 100 + Math.sin(i / 3) * 5 + 1,
      l: 100 + Math.sin(i / 3) * 5 - 1,
      c: 100 + Math.sin(i / 3) * 5,
    }))
    const r = computeWilliamsR(bars, 14)
    expect(r.length).toBe(30 - 13)
    r.forEach(({ value }) => {
      expect(value).toBeGreaterThanOrEqual(-100)
      expect(value).toBeLessThanOrEqual(0)
    })
  })

  it('hand-computed sample value', () => {
    // window of 3 bars; highs [10,12,11], lows [8,10,9], close at index 2 = 10
    // HH=12, LL=8, range=4. %R = -100 * (12-10)/4 = -50
    const bars = [
      { t: 0, h: 10, l: 8,  c: 9 },
      { t: 1, h: 12, l: 10, c: 11 },
      { t: 2, h: 11, l: 9,  c: 10 },
    ]
    const r = computeWilliamsR(bars, 3)
    expect(r.length).toBe(1)
    expect(r[0].value).toBeCloseTo(-50, 4)
    expect(r[0].time).toBe(2)
  })

  it('returns 0 (top of range) when close == highest high', () => {
    const bars = [
      { t: 0, h: 10, l: 8, c: 9 },
      { t: 1, h: 12, l: 10, c: 12 },
    ]
    const r = computeWilliamsR(bars, 2)
    expect(r[0].value).toBe(0)
  })
})

describe('computeADX', () => {
  it('returns empty for too-small input', () => {
    const r = computeADX([], 14)
    expect(r.adx).toEqual([])
    expect(r.plusDI).toEqual([])
    expect(r.minusDI).toEqual([])
    const small = Array.from({ length: 20 }, (_, i) => ({ t: i, h: 10, l: 9, c: 9.5 }))
    expect(computeADX(small, 14).adx).toEqual([])
  })

  it('returns adx/plusDI/minusDI all bounded 0..100', () => {
    const bars = Array.from({ length: 60 }, (_, i) => ({
      t: i,
      h: 100 + Math.sin(i / 4) * 3 + 1,
      l: 100 + Math.sin(i / 4) * 3 - 1,
      c: 100 + Math.sin(i / 4) * 3,
    }))
    const { adx, plusDI, minusDI } = computeADX(bars, 14)
    expect(adx.length).toBeGreaterThan(0)
    expect(plusDI.length).toBeGreaterThan(0)
    expect(minusDI.length).toBeGreaterThan(0)
    adx.forEach(({ value }) => {
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(100)
    })
    plusDI.forEach(({ value }) => {
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(100)
    })
    minusDI.forEach(({ value }) => {
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(100)
    })
  })

  it('strong uptrend → +DI > -DI', () => {
    // monotonically rising bars: +DM always positive, -DM always 0 → +DI >> -DI
    const bars = Array.from({ length: 40 }, (_, i) => ({
      t: i, h: 100 + i + 1, l: 100 + i - 1, c: 100 + i,
    }))
    const { plusDI, minusDI } = computeADX(bars, 14)
    expect(plusDI.at(-1).value).toBeGreaterThan(minusDI.at(-1).value)
    expect(minusDI.at(-1).value).toBeCloseTo(0, 1)
  })

  it('ADX starts at the correct bar index (2*period - 1)', () => {
    const bars = Array.from({ length: 50 }, (_, i) => ({
      t: i, h: 100 + i + 1, l: 100 + i - 1, c: 100 + i,
    }))
    const { adx } = computeADX(bars, 14)
    expect(adx[0].time).toBe(2 * 14 - 1) // = 27
  })
})

describe('computeOBV', () => {
  it('returns empty for empty input', () => {
    expect(computeOBV([])).toEqual([])
    expect(computeOBV(null)).toEqual([])
  })

  it('length equals input length, first value is 0', () => {
    const bars = Array.from({ length: 5 }, (_, i) => ({ t: i, c: 100 + i, v: 1000 }))
    const obv = computeOBV(bars)
    expect(obv.length).toBe(5)
    expect(obv[0].value).toBe(0)
  })

  it('accumulates volume on up days, subtracts on down days', () => {
    // closes: 100, 105 (up +1000), 103 (down -500), 103 (flat 0), 104 (up +200)
    // expected OBV: 0, 1000, 500, 500, 700
    const bars = [
      { t: 0, c: 100, v: 999  },
      { t: 1, c: 105, v: 1000 },
      { t: 2, c: 103, v: 500  },
      { t: 3, c: 103, v: 300  },
      { t: 4, c: 104, v: 200  },
    ]
    const obv = computeOBV(bars)
    expect(obv.map(p => p.value)).toEqual([0, 1000, 500, 500, 700])
  })
})

describe('computeDonchian', () => {
  it('returns empty for too-small input', () => {
    const r = computeDonchian([], 20)
    expect(r.upper).toEqual([])
    expect(r.middle).toEqual([])
    expect(r.lower).toEqual([])
  })

  it('upper >= middle >= lower for all valid samples', () => {
    const bars = Array.from({ length: 30 }, (_, i) => ({
      t: i,
      h: 100 + Math.sin(i) * 5 + 1,
      l: 100 + Math.sin(i) * 5 - 1,
      c: 100 + Math.sin(i) * 5,
    }))
    const { upper, middle, lower } = computeDonchian(bars, 10)
    expect(upper.length).toBe(30 - 9)
    upper.forEach((u, i) => {
      expect(u.value).toBeGreaterThanOrEqual(middle[i].value)
      expect(middle[i].value).toBeGreaterThanOrEqual(lower[i].value)
    })
  })

  it('hand-computed sample value', () => {
    // highs: [10, 12, 11], lows: [8, 10, 9]
    // upper = max(10,12,11) = 12, lower = min(8,10,9) = 8, middle = 10
    const bars = [
      { t: 0, h: 10, l: 8, c: 9 },
      { t: 1, h: 12, l: 10, c: 11 },
      { t: 2, h: 11, l: 9, c: 10 },
    ]
    const r = computeDonchian(bars, 3)
    expect(r.upper.length).toBe(1)
    expect(r.upper[0].value).toBe(12)
    expect(r.lower[0].value).toBe(8)
    expect(r.middle[0].value).toBe(10)
  })
})
