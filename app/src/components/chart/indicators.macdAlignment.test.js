// app/src/components/chart/indicators.macdAlignment.test.js
//
// ─── MACD's EMA ALIGNMENT, SWEPT ACROSS THE PARAMETER SPACE ─────────────────
//
// `computeMACD` aligned the two EMAs with a single subtraction:
//
//     const offset = slowPeriod - fastPeriod
//     const macdValues = slowEMA.map((s, i) => fastEMA[i + offset] - s)
//
// `_ema(v, p)[i]` corresponds to `v[p - 1 + i]`, so aligning the slow series'
// index `i` onto the fast one needs `j = i + (slow - fast)`. That is only a valid
// index while `slow >= fast`. Set Fast above Slow in the settings dialog — which
// the form permits, Fast's max is 100 and Slow's is 200 — and `offset` goes
// negative, `fastEMA[negative]` is `undefined`, and `undefined - s` is `NaN`.
//
// The damage is asymmetric and that is what made it hard to see on screen: only
// the first `fast - slow` entries of the MACD line are NaN, so THE LINE STILL
// DRAWS. But those NaNs are the seed window of the signal EMA — `_ema` starts
// from the mean of the first `period` values — so the signal seed is NaN and NaN
// propagates through every later value. Measured in production on WMT 1D:
// Fast 30 / Slow 26 printed `MACD 0.2008` beside a legend chip reading a bare
// `SIG` with no number at all, and no error anywhere.
//
// ⭐ THE ORACLE IS ANTISYMMETRY, NOT A GOLDEN FILE. MACD is
// `EMA(fast) - EMA(slow)`, so swapping the two periods must negate the line
// exactly, and the signal — an EMA of that line — must negate with it. That
// identity is a property of the definition rather than of this implementation, so
// it cannot be satisfied by copying whatever the code currently emits. It also
// pins the fix from both sides: `fast < slow` cases already pass today and must
// keep passing, so a fix that "handles" `fast > slow` by clamping or swapping the
// inputs fails here rather than looking green.
import { describe, it, expect } from 'vitest'
import { computeMACD } from './indicators'

/** Deterministic bars with genuine curvature — a flat or purely monotonic series
 *  makes EMA differences degenerate and would let a broken alignment look fine. */
function bars(n = 400) {
  const out = []
  let px = 100
  for (let i = 0; i < n; i++) {
    px += Math.sin(i / 7) * 1.4 + Math.cos(i / 23) * 0.9 + ((i * 37) % 11 - 5) * 0.12
    const c = Math.max(1, px)
    out.push({ t: 1600000000 + i * 86400, o: c * 0.995, h: c * 1.01, l: c * 0.99, c, v: 1e6 + (i % 50) * 1000 })
  }
  return out
}

const BARS = bars(400)
const finite = (series) => series.filter(p => Number.isFinite(p.value))
const firstFiniteIdx = (series) => series.findIndex(p => Number.isFinite(p.value))

// Deliberately straddles the boundary: pairs below, at, and above `fast === slow`.
const FAST = [3, 5, 8, 12, 17, 20, 26, 30, 40]
const SLOW = [5, 9, 12, 26, 35, 50]
const SIGNAL = [3, 9, 14]

const PAIRS = []
for (const f of FAST) for (const s of SLOW) if (f !== s) PAIRS.push([f, s])

describe('computeMACD — the signal line exists for every admissible parameter set', () => {
  for (const [f, s] of PAIRS) {
    for (const sig of SIGNAL) {
      it(`fast=${f} slow=${s} signal=${sig} produces a finite signal line`, () => {
        const { macd, signal, histogram } = computeMACD(BARS, f, s, sig)
        // The guard rejects only genuinely short inputs; 400 bars clears every combo.
        expect(finite(macd).length, 'MACD line had no finite values').toBeGreaterThan(0)
        expect(finite(signal).length, 'SIGNAL line had no finite values').toBeGreaterThan(0)
        expect(finite(histogram).length, 'HISTOGRAM had no finite values').toBeGreaterThan(0)
      })
    }
  }
})

describe('computeMACD — swapping fast and slow negates the result exactly', () => {
  for (const [f, s] of PAIRS) {
    it(`macd(${f},${s}) === -macd(${s},${f})`, () => {
      const a = computeMACD(BARS, f, s, 9)
      const b = computeMACD(BARS, s, f, 9)
      let compared = 0
      for (let i = 0; i < BARS.length; i++) {
        const x = a.macd[i].value
        const y = b.macd[i].value
        if (!Number.isFinite(x) && !Number.isFinite(y)) continue
        expect(Number.isFinite(x) && Number.isFinite(y),
          `bar ${i}: one side defined and the other not (${x} vs ${y})`).toBe(true)
        expect(x).toBeCloseTo(-y, 9)
        compared++
      }
      // Without this the test would pass on two all-NaN series.
      expect(compared, 'no overlapping finite bars were compared').toBeGreaterThan(50)
    })
  }
})

describe('computeMACD — the signal line negates with its line', () => {
  for (const [f, s] of PAIRS) {
    it(`signal(${f},${s}) === -signal(${s},${f})`, () => {
      const a = computeMACD(BARS, f, s, 9)
      const b = computeMACD(BARS, s, f, 9)
      let compared = 0
      for (let i = 0; i < BARS.length; i++) {
        const x = a.signal[i].value
        const y = b.signal[i].value
        if (!Number.isFinite(x) && !Number.isFinite(y)) continue
        expect(Number.isFinite(x) && Number.isFinite(y),
          `bar ${i}: signal defined on one side only (${x} vs ${y})`).toBe(true)
        expect(x).toBeCloseTo(-y, 9)
        compared++
      }
      expect(compared, 'no overlapping finite signal bars were compared').toBeGreaterThan(50)
    })
  }
})

describe('computeMACD — structural invariants hold either side of fast === slow', () => {
  for (const [f, s] of PAIRS) {
    it(`fast=${f} slow=${s}: the line starts at max(fast,slow) - 1`, () => {
      const { macd } = computeMACD(BARS, f, s, 9)
      expect(firstFiniteIdx(macd)).toBe(Math.max(f, s) - 1)
    })
  }

  for (const [f, s] of PAIRS) {
    it(`fast=${f} slow=${s}: histogram === macd - signal wherever both are finite`, () => {
      const { macd, signal, histogram } = computeMACD(BARS, f, s, 9)
      let checked = 0
      for (let i = 0; i < BARS.length; i++) {
        const m = macd[i].value, g = signal[i].value
        if (!Number.isFinite(m) || !Number.isFinite(g)) continue
        expect(histogram[i].value).toBeCloseTo(m - g, 9)
        checked++
      }
      expect(checked, 'no bars had both a line and a signal value').toBeGreaterThan(50)
    })
  }
})

describe('computeMACD — fast === slow is the zero line, not a special case', () => {
  for (const p of [5, 12, 26, 50]) {
    it(`fast=slow=${p} gives an identically zero MACD and signal`, () => {
      const { macd, signal } = computeMACD(BARS, p, p, 9)
      const m = finite(macd)
      const g = finite(signal)
      expect(m.length).toBeGreaterThan(50)
      expect(g.length).toBeGreaterThan(50)
      for (const pt of m) expect(pt.value).toBeCloseTo(0, 9)
      for (const pt of g) expect(pt.value).toBeCloseTo(0, 9)
    })
  }
})

describe('computeMACD — the length guard counts the LONGER period', () => {
  // The guard read `bars.length < slowPeriod + signalPeriod`, which ignores a fast
  // period longer than the slow one and lets a too-short input through to the
  // alignment maths.
  it('too few bars for a long FAST period returns empty series, not NaN-filled ones', () => {
    const short = bars(40)
    const { macd, signal, histogram } = computeMACD(short, 100, 26, 9)
    expect(finite(macd)).toHaveLength(0)
    expect(finite(signal)).toHaveLength(0)
    expect(finite(histogram)).toHaveLength(0)
  })

  it('exactly enough bars for a long FAST period does compute', () => {
    const n = 100 + 9 + 5
    const { macd, signal } = computeMACD(bars(n), 100, 26, 9)
    expect(finite(macd).length).toBeGreaterThan(0)
    expect(finite(signal).length).toBeGreaterThan(0)
  })

  it('the default 12/26/9 is unchanged by the fix — first finite bar is index 25', () => {
    const { macd, signal, histogram } = computeMACD(BARS, 12, 26, 9)
    expect(firstFiniteIdx(macd)).toBe(25)
    expect(firstFiniteIdx(signal)).toBe(33)
    expect(firstFiniteIdx(histogram)).toBe(33)
  })
})
