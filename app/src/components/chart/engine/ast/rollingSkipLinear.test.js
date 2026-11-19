// ─── ⭐⭐ NA.SKIP IS ONE FORWARD PASS (2026-11-19): the ring is byte-identical to the backward gather it replaced, and its
// cost does not depend on how long the gaps are.
//
// ⚰️ MEASURED on production e86 (Fred RS on RDDT, a 1D -> 5m switch, a CDP trace with the V8 CPU profiler): 16.1 s of a
// 21.9 s main-thread freeze was ONE function, `windowOperands`' SKIP branch, called by `rolling` for `ta.sma` over a
// series `na` for its first 19,864 of 28,006 bars. It walked back over every `na` before it, on every bar (~2e8 steps).
// The same switch without the script had 1.6 s of long tasks. `interpret.js::rollingSkip` keeps the last n finite values
// in a ring; the Python twin is `ast_interpret._rolling_skip` (tests/test_ast_rolling_skip_linear.py).
//   1. IDENTITY: randomized series (an `na` prefix, interior holes, sparse values, all `na`, all finite, shorter than the
//      window) x window sizes 1..300 x every reducer the table runs under NA.SKIP (mean, sum, stdev, median): `rolling`
//      equals the old gather loop bit for bit, and hands `reduce` the same operand lists on the same bars.
//   2. STEP COUNT (never a wall clock): a 6,000-bar series `na` for its first 4,000 bars and across a 1,000-bar interior
//      hole is read at most 3 times per bar. A mutant run (the ring's `return` removed) goes RED.
import { describe, it, expect } from 'vitest'
import { __rollingForTests as R } from './interpret.js'

const { rolling, windowOperands, NA } = R
const REDUCERS = { mean: R.windowMean, sum: R.windowSum, stdev: R.windowStdev, median: R.windowMedian }

/** The gather this replaced: `rolling`'s loop over `windowOperands(…, NA.SKIP)`. */
function oldSkip(series, n, reduce) {
  const out = new Float64Array(series.length).fill(NaN)
  for (let i = n - 1; i < series.length; i++) {
    const w = windowOperands(series, n, i, NA.SKIP)
    if (w) out[i] = reduce(w.buf, w.lo, w.hi)
  }
  return out
}

// a seeded generator: the same series on every run
function rng(seed) {
  let s = seed >>> 0
  return () => { s = (Math.imul(s ^ (s >>> 15), 2246822519) + 0x9e3779b9) >>> 0; return s / 4294967296 }
}
const int = (r, a, b) => a + Math.floor(r() * (b - a + 1))

function seriesOf(r, length, shape) {
  const xs = Array.from({ length }, () => -50 + r() * 200)
  if (shape === 'prefix') { const cut = int(r, 0, length); for (let i = 0; i < cut; i++) xs[i] = NaN }
  if (shape === 'holes') {
    for (let h = int(r, 1, 6); h > 0; h--) {
      const a = int(r, 0, length); const b = Math.min(length, a + int(r, 1, Math.max(1, Math.floor(length / 3))))
      for (let i = a; i < b; i++) xs[i] = NaN
    }
  }
  if (shape === 'sparse') for (let i = 0; i < length; i++) if (r() >= 0.15) xs[i] = NaN
  if (shape === 'allna') xs.fill(NaN)
  return Float64Array.from(xs)
}

const sameBits = (a, b) => a.length === b.length && a.every((x, i) => Object.is(x, b[i]))

describe('NA.SKIP: the ring equals the gather it replaced', () => {
  it('byte-identical over randomized series, window sizes and every SKIP reducer', () => {
    const r = rng(20261119)
    let cases = 0
    for (const shape of ['prefix', 'holes', 'sparse', 'allna', 'finite']) {
      for (let k = 0; k < 12; k++) {
        const length = int(r, 0, 900)
        const series = seriesOf(r, length, shape)
        const sizes = [...new Set([1, 2, 3, int(r, 1, 50), int(r, 1, 300), Math.max(1, length), length + 5])]
        for (const n of sizes) {
          for (const [name, red] of Object.entries(REDUCERS)) {
            const got = rolling(series, n, red, NA.SKIP)
            const want = oldSkip(series, n, red)
            expect(sameBits(Array.from(got), Array.from(want)), `${shape} len ${length} n ${n} ${name}`).toBe(true)
            cases += 1
          }
        }
      }
    }
    expect(cases).toBeGreaterThan(1000)
  })

  it('hands reduce the same operands, oldest first, on the same bars', () => {
    const r = rng(7)
    for (const shape of ['prefix', 'holes', 'sparse']) {
      const series = seriesOf(r, 700, shape)
      for (const n of [1, 5, 40, 250]) {
        const got = []
        const want = []
        rolling(series, n, (b, lo, hi) => { got.push(Array.from(b.slice(lo, hi + 1)).join(',')); return 0 }, NA.SKIP)
        oldSkip(series, n, (b, lo, hi) => { want.push(Array.from(b.slice(lo, hi + 1)).join(',')); return 0 })
        expect(got, `${shape} n ${n}`).toEqual(want)
      }
    }
  })
})

describe('NA.SKIP: the cost does not depend on how long the gaps are', () => {
  it('a 6,000-bar series with a 4,000-bar na prefix and a 1,000-bar hole is read at most 3 times per bar', () => {
    const xs = [...Array(4000).fill(NaN), ...Array.from({ length: 1000 }, (_, i) => 100 + (i % 17)), ...Array(1000).fill(NaN)]
    let reads = 0
    const counted = new Proxy(xs, {
      get(t, p) {
        if (typeof p === 'string' && /^\d+$/.test(p)) reads += 1
        return Reflect.get(t, p)
      },
    })
    const out = rolling(counted, 50, R.windowMean, NA.SKIP)
    expect(reads, `${reads} reads for ${xs.length} bars: the gather is back`).toBeLessThanOrEqual(3 * xs.length)
    // CONTROL: the answers are there (from the bar holding the 50th finite value, the hole answering)
    expect(Number.isNaN(out[4048]) && Number.isFinite(out[4049]) && Number.isFinite(out[5999])).toBe(true)
  })
})
