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
  computeStochastic,
  computeATR,
  computeIchimoku,
  computeParabolicSAR,
} from './indicators'

// ─── shared helpers for the bar-aligned, NaN-padded output contract ──────────
// See the indicators.js module docstring: output index i describes bars[i], and
// positions before the first computable bar are NaN (rendered as LWC whitespace).

/** Index of the first computable point, or -1. */
const firstValue = (arr) => arr.findIndex(p => Number.isFinite(p.value))
/** Only the computable points. */
const values = (arr) => arr.filter(p => Number.isFinite(p.value)).map(p => p.value)

/**
 * Assert the padding contract: input-length, a contiguous NaN prefix, then
 * values with no holes, starting exactly at `expectedFirst`.
 */
const expectPadded = (arr, bars, expectedFirst) => {
  expect(arr.length).toBe(bars.length)
  expect(firstValue(arr)).toBe(expectedFirst)
  arr.slice(0, expectedFirst).forEach(p => expect(Number.isNaN(p.value)).toBe(true))
  arr.slice(expectedFirst).forEach(p => expect(Number.isFinite(p.value)).toBe(true))
  arr.forEach((p, i) => expect(p.time).toBe(bars[i].t))
}

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
    // Empty (not an all-NaN array) is the renderer's "no pane" signal — every
    // indicator block in StockChart keys off data.length.
    expect(computeRSI([{ c: 1 }, { c: 2 }], 14)).toEqual([])
    expect(computeRSI(null, 14)).toEqual([])
  })

  it('is bar-aligned and NaN-padded up to the first computable bar', () => {
    const bars = Array.from({ length: 20 }, (_, i) => ({ t: i, c: 10 + i }))
    expectPadded(computeRSI(bars, 14), bars, 14)
  })

  it('all-gain series produces RSI = 100', () => {
    const bars = Array.from({ length: 20 }, (_, i) => ({ t: i, c: 10 + i }))
    const rsi = computeRSI(bars, 14)
    expect(values(rsi).length).toBe(20 - 14)
    values(rsi).forEach(v => expect(v).toBe(100))
  })

  it('does not round: values keep full double precision', () => {
    // 2dp rounding used to be baked in here, which made agreement with the
    // Python lane at 1e-9 arithmetically impossible.
    const bars = Array.from({ length: 40 }, (_, i) => ({ t: i, c: 100 + Math.sin(i / 3) * 5 }))
    const vs = values(computeRSI(bars, 14))
    expect(vs.some(v => Math.abs(v - Number(v.toFixed(2))) > 1e-9)).toBe(true)
  })

  it('returns {time, value} objects with reasonable RSI range', () => {
    const bars = Array.from({ length: 30 }, (_, i) => ({
      t: i,
      c: 100 + Math.sin(i / 3) * 5,
    }))
    const rsi = computeRSI(bars, 14)
    expect(rsi.length).toBe(30)
    values(rsi).forEach(v => {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(100)
    })
    rsi.forEach(({ time }) => expect(typeof time).toBe('number'))
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

  it('returns 3 bar-aligned arrays; the line starts before the signal', () => {
    const bars = Array.from({ length: 100 }, (_, i) => ({ t: i, c: 100 + i * 0.5 }))
    const { macd, signal, histogram } = computeMACD(bars)
    // The MACD line exists as soon as both EMAs do — bar slow-1 = 25. Signal and
    // histogram need `signal` more bars: 25 + 8 = 33. The line used to be
    // trimmed to 33 to match, which put this lane 8 bars out of step with
    // api/services/indicator_compute.py. (StockChart masks the head back to 33
    // so the drawn chart is unchanged — see the note there.)
    expectPadded(macd, bars, 25)
    expectPadded(signal, bars, 33)
    expectPadded(histogram, bars, 33)
  })

  it('histogram carries NO colour — that is a render concern now', () => {
    // computeMACD used to bake an rgba string into every histogram point. The
    // renderer derives it from the sign instead (StockChart's indicatorData
    // memo), which is exactly the old `m >= s` test.
    const bars = Array.from({ length: 100 }, (_, i) => ({ t: i, c: 100 + i }))
    const { macd, signal, histogram } = computeMACD(bars)
    histogram.forEach(h => expect(h.color).toBeUndefined())
    // …and the sign the renderer keys on still matches macd-vs-signal.
    histogram.forEach((h, i) => {
      if (!Number.isFinite(h.value)) return
      expect(h.value >= 0).toBe(macd[i].value >= signal[i].value)
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
    expectPadded(upper, bars, 19)
    expectPadded(middle, bars, 19)
    expectPadded(lower, bars, 19)
    upper.forEach((u, i) => {
      if (!Number.isFinite(u.value)) return
      expect(u.value).toBeGreaterThanOrEqual(middle[i].value)
      expect(middle[i].value).toBeGreaterThanOrEqual(lower[i].value)
    })
  })

  it('middle band equals SMA over period', () => {
    const bars = Array.from({ length: 20 }, (_, i) => ({ t: i, c: 100 + i }))
    const { middle } = computeBB(bars, 20, 2)
    // SMA of 100..119 = (100 + 119) / 2 = 109.5
    expect(middle[19].value).toBeCloseTo(109.5, 10)
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
    expect(v.value).toBeCloseTo(100, 10)
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
    expect(vwap[1].value).toBeCloseTo(210, 10)
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
    expectPadded(mfi, bars, 14)
    values(mfi).forEach(v => expect(v).toBe(100))
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
    expectPadded(mfi, bars, 14)
    values(mfi).forEach(v => {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(100)
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
    expectPadded(mfi, bars, 2)
    // Unrounded now: the full double, not the old 2dp value.
    expect(mfi[2].value).toBeCloseTo(100 - 100 / (1 + 12000 / 5500), 10)
    expect(mfi[2].time).toBe(2)
  })
})

describe('computeCCI', () => {
  it('returns empty for too-small input', () => {
    expect(computeCCI([], 20)).toEqual([])
    expect(computeCCI(null, 20)).toEqual([])
    const bars = Array.from({ length: 5 }, (_, i) => ({ t: i, h: 10, l: 9, c: 9.5 }))
    expect(computeCCI(bars, 20)).toEqual([])
  })

  it('is input-length with period-1 leading NaNs', () => {
    const bars = Array.from({ length: 30 }, (_, i) => ({
      t: i, h: 10 + Math.sin(i) + 0.5, l: 10 + Math.sin(i) - 0.5, c: 10 + Math.sin(i),
    }))
    expectPadded(computeCCI(bars, 20), bars, 19)
  })

  it('CCI is zero when typical price is constant', () => {
    const bars = Array.from({ length: 10 }, (_, i) => ({ t: i, h: 10, l: 10, c: 10 }))
    values(computeCCI(bars, 5)).forEach(v => expect(v).toBe(0))
  })

  it('hand-computed sample value', () => {
    // tp sequence: 10,11,12,13,14 — SMA(5) = 12, MAD = (2+1+0+1+2)/5 = 1.2
    // CCI = (14 - 12) / (0.015 * 1.2) = 2 / 0.018 = 111.111...
    const bars = [10, 11, 12, 13, 14].map((p, i) => ({ t: i, h: p, l: p, c: p }))
    const cci = computeCCI(bars, 5)
    expectPadded(cci, bars, 4)
    expect(cci[4].value).toBeCloseTo(2 / 0.018, 10)
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
    expectPadded(r, bars, 13)
    values(r).forEach(v => {
      expect(v).toBeGreaterThanOrEqual(-100)
      expect(v).toBeLessThanOrEqual(0)
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
    expectPadded(r, bars, 2)
    expect(r[2].value).toBeCloseTo(-50, 10)
    expect(r[2].time).toBe(2)
  })

  it('returns 0 (top of range) when close == highest high', () => {
    const bars = [
      { t: 0, h: 10, l: 8, c: 9 },
      { t: 1, h: 12, l: 10, c: 12 },
    ]
    const r = computeWilliamsR(bars, 2)
    // Unrounded this is -0 (`-100 * 0 / range`); the old toFixed collapsed it to
    // +0. -0 === 0, it renders as 0, and it now matches what the Python lane has
    // always returned for this branch.
    expect(r[1].value === 0).toBe(true)
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
    ;[adx, plusDI, minusDI].forEach(series => {
      expect(values(series).length).toBeGreaterThan(0)
      values(series).forEach(v => {
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThanOrEqual(100)
      })
    })
  })

  it('adx and the DIs are the same length — they used to differ', () => {
    // adx was trimmed to start at 2*period-1 while the DIs started at period,
    // so the three arrays came back at different lengths and nothing could
    // index them together at a bar.
    const bars = Array.from({ length: 60 }, (_, i) => ({
      t: i, h: 100 + i + 1, l: 100 + i - 1, c: 100 + i,
    }))
    const { adx, plusDI, minusDI } = computeADX(bars, 14)
    expectPadded(plusDI, bars, 14)
    expectPadded(minusDI, bars, 14)
    expectPadded(adx, bars, 2 * 14 - 1)
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
    expect(firstValue(adx)).toBe(2 * 14 - 1) // = 27
    expect(adx[2 * 14 - 1].time).toBe(27)
  })
})

describe('computeOBV', () => {
  it('returns empty for empty input', () => {
    expect(computeOBV([])).toEqual([])
    expect(computeOBV(null)).toEqual([])
  })

  it('length equals input length, first value is 0', () => {
    // OBV seeds bar 0 with 0 rather than a NaN pad — preserved deliberately.
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
    expectPadded(upper, bars, 9)
    expectPadded(middle, bars, 9)
    expectPadded(lower, bars, 9)
    upper.forEach((u, i) => {
      if (!Number.isFinite(u.value)) return
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
    expectPadded(r.upper, bars, 2)
    expect(r.upper[2].value).toBe(12)
    expect(r.lower[2].value).toBe(8)
    expect(r.middle[2].value).toBe(10)
  })
})

// ─── The four natives that had no tests at all ──────────────────────────────
//
// computeStochastic, computeATR, computeIchimoku and computeParabolicSAR were
// imported by nothing in this file: four of the fifteen would have entered the
// B2/B3 migration with no parity baseline whatsoever. Each gets the same three
// things the eleven above have — a hand-computed known value, the
// bar-alignment/NaN-padding contract, and one behavioural invariant.
//
// Ichimoku's and SAR's tests PIN TODAY'S BEHAVIOUR, including the two
// documented deviations from the textbook (see the indicators.js docstring):
// the cloud is not forward-displaced, and SAR carries a third `isUptrend`
// field. Those are B3 decisions with owner sign-off, not bugs to fix in
// passing — and a test that pins today is exactly what makes a future
// correction visible instead of silent.

describe('computeStochastic', () => {
  it('returns empty arrays for too-small input', () => {
    // Empty (not all-NaN) is the renderer's "no pane" signal.
    expect(computeStochastic([], 14, 3)).toEqual({ k: [], d: [] })
    expect(computeStochastic(null, 14, 3)).toEqual({ k: [], d: [] })
    const bars = Array.from({ length: 5 }, (_, i) => ({ t: i, h: 10, l: 9, c: 9.5 }))
    expect(computeStochastic(bars, 14, 3)).toEqual({ k: [], d: [] })
  })

  it('hand-computed %K and %D over a 5-bar series', () => {
    // kPeriod = 3, dPeriod = 2.
    //   bar2 window 0..2: HH = max(10,12,11) = 12, LL = min(8,9,7) = 7,
    //                     range 5, close 8  → (8-7)/5*100  = 20
    //   bar3 window 1..3: HH = max(12,11,13) = 13, LL = min(9,7,10) = 7,
    //                     range 6, close 12 → (12-7)/6*100 = 83.333…
    //   bar4 window 2..4: HH = max(11,13,12) = 13, LL = min(7,10,9) = 7,
    //                     range 6, close 10 → (10-7)/6*100 = 50
    //   %D = SMA(2) of %K → d[3] = (20+83.333…)/2, d[4] = (83.333…+50)/2
    const bars = [
      { t: 0, h: 10, l: 8,  c: 9  },
      { t: 1, h: 12, l: 9,  c: 11 },
      { t: 2, h: 11, l: 7,  c: 8  },
      { t: 3, h: 13, l: 10, c: 12 },
      { t: 4, h: 12, l: 9,  c: 10 },
    ]
    const { k, d } = computeStochastic(bars, 3, 2)
    expectPadded(k, bars, 2)          // first %K at kPeriod-1
    expectPadded(d, bars, 3)          // first %D dPeriod-1 bars later
    expect(k[2].value).toBeCloseTo(20, 10)
    expect(k[3].value).toBeCloseTo((5 / 6) * 100, 10)
    expect(k[4].value).toBeCloseTo(50, 10)
    expect(d[3].value).toBeCloseTo((20 + (5 / 6) * 100) / 2, 10)
    expect(d[4].value).toBeCloseTo(((5 / 6) * 100 + 50) / 2, 10)
    expect(k[4].time).toBe(4)
  })

  it('%K and %D are bar-aligned, same length, with the documented offsets', () => {
    // These two used to come back at DIFFERENT lengths (d was dPeriod-1 shorter),
    // so nothing could read %K and %D together at a given bar.
    const bars = Array.from({ length: 40 }, (_, i) => ({
      t: i,
      h: 100 + Math.sin(i / 4) * 5 + 1,
      l: 100 + Math.sin(i / 4) * 5 - 1,
      c: 100 + Math.sin(i / 4) * 5,
    }))
    const { k, d } = computeStochastic(bars, 14, 3)
    expect(k.length).toBe(d.length)
    expectPadded(k, bars, 13)
    expectPadded(d, bars, 15)
  })

  it('INVARIANT: 0 <= %K <= 100 for every computable bar', () => {
    const bars = Array.from({ length: 80 }, (_, i) => ({
      t: i,
      h: 100 + Math.sin(i / 3) * 8 + Math.cos(i / 7) * 2 + 1.5,
      l: 100 + Math.sin(i / 3) * 8 + Math.cos(i / 7) * 2 - 1.5,
      c: 100 + Math.sin(i / 3) * 8 + Math.cos(i / 7) * 2,
    }))
    const { k } = computeStochastic(bars, 14, 3)
    const vs = values(k)
    expect(vs.length).toBe(80 - 13)
    vs.forEach(v => {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(100)
    })
    // …and the closes really do visit both ends of the window, so the bound is
    // being exercised rather than trivially satisfied by a flat series.
    expect(Math.max(...vs)).toBeGreaterThan(90)
    expect(Math.min(...vs)).toBeLessThan(10)
  })

  it('a flat window (zero range) yields the 50 midpoint, not a divide-by-zero', () => {
    const bars = Array.from({ length: 4 }, (_, i) => ({ t: i, h: 10, l: 10, c: 10 }))
    const { k } = computeStochastic(bars, 3, 2)
    values(k).forEach(v => expect(v).toBe(50))
  })
})

describe('computeATR', () => {
  it('returns empty for too-small input', () => {
    expect(computeATR([], 14)).toEqual([])
    expect(computeATR(null, 14)).toEqual([])
    // needs period + 1 bars (the first TR needs a previous close)
    const bars = Array.from({ length: 14 }, (_, i) => ({ t: i, h: 10, l: 9, c: 9.5 }))
    expect(computeATR(bars, 14)).toEqual([])
  })

  it('hand-computed Wilder seed and one smoothing step', () => {
    // period = 2. True range needs the PREVIOUS close, so trs[j] describes bars[j+1]:
    //   bar1: max(11-9.5, |11-9.5|, |9.5-9.5|)   = max(1.5, 1.5, 0)   = 1.5
    //   bar2: max(12-10,  |12-10.5|, |10-10.5|)  = max(2,   1.5, 0.5) = 2
    //   bar3: max(11-9,   |11-10.5|, |9-10.5|)   = max(2,   0.5, 1.5) = 2
    // seed  = mean of the first 2 TRs = (1.5 + 2) / 2 = 1.75  → lands on bars[2]
    // step  = (1.75 * (2-1) + 2) / 2  = 1.875              → lands on bars[3]
    const bars = [
      { t: 0, h: 10, l: 9,   c: 9.5  },
      { t: 1, h: 11, l: 9.5, c: 10.5 },
      { t: 2, h: 12, l: 10,  c: 10.5 },
      { t: 3, h: 11, l: 9,   c: 9.5  },
    ]
    const atr = computeATR(bars, 2)
    expectPadded(atr, bars, 2)        // first value on bars[period]
    expect(atr[2].value).toBeCloseTo(1.75, 10)
    expect(atr[3].value).toBeCloseTo(1.875, 10)
    expect(atr[3].time).toBe(3)
  })

  it('is bar-aligned with `period` leading NaNs', () => {
    const bars = Array.from({ length: 30 }, (_, i) => ({
      t: i,
      h: 100 + Math.sin(i / 3) * 4 + 1,
      l: 100 + Math.sin(i / 3) * 4 - 1,
      c: 100 + Math.sin(i / 3) * 4,
    }))
    expectPadded(computeATR(bars, 14), bars, 14)
  })

  it('INVARIANT: ATR > 0 whenever any bar has range', () => {
    const bars = Array.from({ length: 60 }, (_, i) => ({
      t: i,
      h: 100 + Math.sin(i / 5) * 6 + 1.2,
      l: 100 + Math.sin(i / 5) * 6 - 1.2,
      c: 100 + Math.sin(i / 5) * 6,
    }))
    const vs = values(computeATR(bars, 14))
    expect(vs.length).toBeGreaterThan(0)
    vs.forEach(v => expect(v).toBeGreaterThan(0))
  })

  it('a gap beyond the bar\'s own range widens ATR (true range, not high-low)', () => {
    // Identical 1-wide bars, except bar 3 gaps 10 points down: its high-low is
    // still 1, but |low - prevClose| is ~10, so TR must pick the gap. If the
    // true-range max were reduced to the intrabar range, ATR here would stay 1.
    const flat = [
      { t: 0, h: 100.5, l: 99.5, c: 100 },
      { t: 1, h: 100.5, l: 99.5, c: 100 },
      { t: 2, h: 100.5, l: 99.5, c: 100 },
      { t: 3, h: 90.5,  l: 89.5, c: 90  },
    ]
    const atr = computeATR(flat, 3)
    // TRs: 1, 1, max(1, |90.5-100|, |89.5-100|) = 10.5 → seed = (1+1+10.5)/3
    expect(atr[3].value).toBeCloseTo((1 + 1 + 10.5) / 3, 10)
    expect(atr[3].value).toBeGreaterThan(1)
  })
})

describe('computeIchimoku', () => {
  it('returns empty arrays for too-small input', () => {
    const empty = { tenkan: [], kijun: [], spanA: [], spanB: [], chikou: [] }
    expect(computeIchimoku([], 9, 26, 52)).toEqual(empty)
    expect(computeIchimoku(null, 9, 26, 52)).toEqual(empty)
    const bars = Array.from({ length: 51 }, (_, i) => ({ t: i, h: 10, l: 9, c: 9.5 }))
    expect(computeIchimoku(bars, 9, 26, 52)).toEqual(empty)
  })

  it('hand-computed lines over a 6-bar series (tenkan 2 / kijun 3 / senkouB 4)', () => {
    // Every line starts at senkouBPeriod-1 = 3, because the single loop is
    // gated on the LONGEST period (not each line's own).
    //   bar3: tenkan = mid(bars 2..3) = (max 13 + min 7)/2  = 10
    //         kijun  = mid(bars 1..3) = (max 13 + min 7)/2  = 10
    //         spanA  = (10 + 10)/2                          = 10
    //         spanB  = mid(bars 0..3) = (max 13 + min 7)/2  = 10
    //   bar4: tenkan = mid(3..4) = (13 + 9)/2  = 11
    //         kijun  = mid(2..4) = (13 + 7)/2  = 10
    //         spanA  = 10.5 ;   spanB = mid(1..4) = (13 + 7)/2 = 10
    //   bar5: tenkan = mid(4..5) = (14 + 9)/2  = 11.5
    //         kijun  = mid(3..5) = (14 + 9)/2  = 11.5
    //         spanA  = 11.5 ;   spanB = mid(2..5) = (14 + 7)/2 = 10.5
    //   chikou (displacement = kijunPeriod = 3): close of bar i written to i-3
    //         → chikou[0] = 12, chikou[1] = 10, chikou[2] = 13
    const bars = [
      { t: 0, h: 10, l: 8,  c: 9  },
      { t: 1, h: 12, l: 9,  c: 11 },
      { t: 2, h: 11, l: 7,  c: 8  },
      { t: 3, h: 13, l: 10, c: 12 },
      { t: 4, h: 12, l: 9,  c: 10 },
      { t: 5, h: 14, l: 11, c: 13 },
    ]
    const { tenkan, kijun, spanA, spanB, chikou } = computeIchimoku(bars, 2, 3, 4)

    expectPadded(tenkan, bars, 3)
    expectPadded(kijun, bars, 3)
    expectPadded(spanA, bars, 3)
    expectPadded(spanB, bars, 3)

    expect(tenkan.slice(3).map(p => p.value)).toEqual([10, 11, 11.5])
    expect(kijun.slice(3).map(p => p.value)).toEqual([10, 10, 11.5])
    expect(spanA.slice(3).map(p => p.value)).toEqual([10, 10.5, 11.5])
    expect(spanB.slice(3).map(p => p.value)).toEqual([10, 10, 10.5])

    // chikou is the only line with a NaN pad at BOTH ends — the last
    // `displacement` slots can never be filled.
    expect(chikou.map(p => p.value).slice(0, 3)).toEqual([12, 10, 13])
    chikou.slice(3).forEach(p => expect(Number.isNaN(p.value)).toBe(true))
    chikou.forEach((p, i) => expect(p.time).toBe(bars[i].t))
  })

  it('all five lines are input-length; chikou is shifted back kijunPeriod bars', () => {
    const bars = Array.from({ length: 90 }, (_, i) => ({
      t: i,
      h: 100 + Math.sin(i / 6) * 7 + 1,
      l: 100 + Math.sin(i / 6) * 7 - 1,
      c: 100 + Math.sin(i / 6) * 7,
    }))
    const { tenkan, kijun, spanA, spanB, chikou } = computeIchimoku(bars, 9, 26, 52)
    ;[tenkan, kijun, spanA, spanB, chikou].forEach(s => expect(s.length).toBe(bars.length))

    // The four forward lines all start together at senkouBPeriod - 1 = 51.
    ;[tenkan, kijun, spanA, spanB].forEach(s => expectPadded(s, bars, 51))

    // chikou[i] holds bars[i + 26].c, defined for i in [51-26, 89-26] = [25, 63].
    expect(firstValue(chikou)).toBe(25)
    for (let i = 25; i <= 63; i++) {
      expect(chikou[i].value).toBeCloseTo(bars[i + 26].c, 12)
    }
    chikou.slice(0, 25).forEach(p => expect(Number.isNaN(p.value)).toBe(true))
    chikou.slice(64).forEach(p => expect(Number.isNaN(p.value)).toBe(true))
  })

  it('PINS TODAY: spanA/spanB are NOT forward-displaced (non-standard, by design)', () => {
    // Standard Ichimoku plots the cloud 26 bars into the FUTURE — spanA at bar i
    // would be built from tenkan/kijun at bar i-26, and the newest 26 slots would
    // hold values with no bars under them yet. This implementation puts the cloud
    // directly over the price that produced it, and Phase B1 keeps it that way so
    // the migration is pixel-identical.
    //
    // ⚠️ When B3 corrects this (an owner-visible decision), THIS TEST FAILS. That
    // is the point: the correction has to be an explicit edit here, not a silent
    // pixel shift on somebody's chart.
    const bars = Array.from({ length: 90 }, (_, i) => ({
      t: i,
      h: 100 + Math.sin(i / 6) * 7 + 1,
      l: 100 + Math.sin(i / 6) * 7 - 1,
      c: 100 + Math.sin(i / 6) * 7,
    }))
    const { tenkan, kijun, spanA } = computeIchimoku(bars, 9, 26, 52)
    // Same-bar relationship, everywhere it is computable.
    spanA.forEach((p, i) => {
      if (!Number.isFinite(p.value)) return
      expect(p.value).toBeCloseTo((tenkan[i].value + kijun[i].value) / 2, 12)
    })
    // Displaced, the newest 26 slots would be pad; here the last bar has a value.
    expect(Number.isFinite(spanA.at(-1).value)).toBe(true)
    expect(spanA.at(-1).time).toBe(bars.at(-1).t)
  })
})

describe('computeParabolicSAR', () => {
  it('returns empty for too-small input', () => {
    expect(computeParabolicSAR([], 0.02, 0.2)).toEqual([])
    expect(computeParabolicSAR(null, 0.02, 0.2)).toEqual([])
    expect(computeParabolicSAR([{ t: 0, h: 10, l: 9, c: 9.5 }], 0.02, 0.2)).toEqual([])
  })

  it('hand-computed SAR through the two-prior-lows clamp', () => {
    // Seed (consumes bar 0, which is why index 0 is the NaN pad):
    //   isUptrend = c1 > c0 = true ; sar = l0 = 9 ; ep = h0 = 10 ; af = 0.02
    //   i=1: raw = 9 + 0.02*(10-9) = 9.02, clamped to min(9.02, l0=9) = 9
    //        l1=10 >= 9 → no flip; h1=11 > ep → ep=11, af=0.04     → sar 9
    //   i=2: raw = 9 + 0.04*(11-9) = 9.08, clamped to min(9.08, l1=10, l0=9) = 9
    //        l2=11 >= 9 → no flip; h2=12 > ep → ep=12, af=0.06     → sar 9
    //   i=3: raw = 9 + 0.06*(12-9) = 9.18, clamp min(9.18, l2=11, l1=10) = 9.18
    //        l3=12 >= 9.18 → no flip                                → sar 9.18
    const bars = [
      { t: 0, h: 10, l: 9,  c: 9.5  },
      { t: 1, h: 11, l: 10, c: 10.5 },
      { t: 2, h: 12, l: 11, c: 11.5 },
      { t: 3, h: 13, l: 12, c: 12.5 },
    ]
    const sar = computeParabolicSAR(bars, 0.02, 0.2)
    expectPadded(sar, bars, 1)
    expect(sar[1].value).toBeCloseTo(9, 10)
    expect(sar[2].value).toBeCloseTo(9, 10)
    expect(sar[3].value).toBeCloseTo(9.18, 10)
    sar.slice(1).forEach(p => expect(p.isUptrend).toBe(true))
  })

  it('PINS TODAY: computed points carry a third `isUptrend` field', () => {
    // Not part of the {time, value} contract every other native honours — the
    // consumer strips it before handing data to Lightweight Charts. Preserved
    // deliberately (see the indicators.js docstring); B2's binding layer is
    // where it becomes a declared output rather than a smuggled property.
    const bars = Array.from({ length: 10 }, (_, i) => ({
      t: i, h: 100 + i + 1, l: 100 + i - 1, c: 100 + i,
    }))
    const sar = computeParabolicSAR(bars)
    expect(sar[0].isUptrend).toBeUndefined()   // the pad carries nothing
    sar.slice(1).forEach(p => expect(typeof p.isUptrend).toBe('boolean'))
  })

  it('INVARIANT: flips isUptrend on a reversal, and stays on the right side of price', () => {
    // 12 bars up, then 12 bars down hard enough to take out the trailing stop.
    const up = Array.from({ length: 12 }, (_, i) => ({
      t: i, h: 100 + i * 2 + 1, l: 100 + i * 2 - 1, c: 100 + i * 2,
    }))
    const down = Array.from({ length: 12 }, (_, i) => ({
      t: 12 + i, h: 124 - i * 3 + 1, l: 124 - i * 3 - 1, c: 124 - i * 3,
    }))
    const bars = [...up, ...down]
    const sar = computeParabolicSAR(bars, 0.02, 0.2)
    expectPadded(sar, bars, 1)

    const flips = sar.filter((p, i) => i > 1 && p.isUptrend !== sar[i - 1].isUptrend)
    expect(flips.length).toBeGreaterThan(0)
    // It starts long (the seed reads bar1 > bar0) and ends short.
    expect(sar[1].isUptrend).toBe(true)
    expect(sar.at(-1).isUptrend).toBe(false)

    sar.forEach((p, i) => {
      if (!Number.isFinite(p.value)) return
      if (p.isUptrend) expect(p.value).toBeLessThanOrEqual(bars[i].h)
      else             expect(p.value).toBeGreaterThanOrEqual(bars[i].l)
    })
  })

  it('maxStep really caps the acceleration factor', () => {
    // Asserted by COMPARING two caps rather than by inspecting one run: with
    // `af` capped tighter the SAR converges on price more slowly, so the two
    // series must diverge. Drop the cap (af += step, unbounded) and the two
    // runs become identical — which is what makes this assertion able to fail.
    //
    // Note the ordering claim is the interesting half: an incidental "SAR stays
    // below the low" check would NOT catch a missing cap here, because the
    // two-prior-lows clamp pins SAR to bars[i-2].l for the first few bars and
    // hides `af` entirely while it binds.
    const bars = Array.from({ length: 40 }, (_, i) => ({
      t: i, h: 100 + i * 2 + 1, l: 100 + i * 2 - 1, c: 100 + i * 2,
    }))
    const tight = computeParabolicSAR(bars, 0.02, 0.06)   // af pinned after 2 steps
    const std   = computeParabolicSAR(bars, 0.02, 0.2)
    expect(tight.some((p, i) => Number.isFinite(p.value)
      && Math.abs(p.value - std[i].value) > 1e-9)).toBe(true)
    tight.forEach((p, i) => {
      if (!Number.isFinite(p.value)) return
      expect(p.value).toBeLessThanOrEqual(std[i].value + 1e-9)
    })
  })

  it('a monotonic uptrend never flips and SAR trails below every low', () => {
    const bars = Array.from({ length: 40 }, (_, i) => ({
      t: i, h: 100 + i * 2 + 1, l: 100 + i * 2 - 1, c: 100 + i * 2,
    }))
    const sar = computeParabolicSAR(bars, 0.02, 0.2)
    sar.forEach((p, i) => {
      if (!Number.isFinite(p.value)) return
      expect(p.isUptrend).toBe(true)
      expect(p.value).toBeLessThan(bars[i].l)
    })
  })
})
