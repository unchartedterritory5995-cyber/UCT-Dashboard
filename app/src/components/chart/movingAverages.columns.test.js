/**
 * ⚡ THE SHIPPED SMA AND EMA, STRAIGHT INTO A COLUMN (section 3.3 change 5 / Phase E4, 2026-11-28).
 *
 * `nativeRegistry.movingAverage` built one `{value}` point per bar per average (`smaOfSeries` / `emaOfSeries`) and
 * `toColumn` read them into a NaN-padded Float64Array: over every held bar, on every compute the neighbour frames had
 * not prepared (an intraday key holds 20-50k bars; a profiled warm 5m re-open spent 4.2 ms in computeFor + toColumn
 * for four averages). `smaColumn` / `emaColumn` run the shipped loops and write each value where the point went.
 *   M1 (red before the change: no such functions) bit for bit `toColumn(smaOfSeries(...))` and
 *      `toColumn(emaOfSeries(...))` over seeded series with gaps, every period from 1 to 250 that matters, short and
 *      long inputs (Object.is per element: -0 / NaN placement included)
 *   M2 the chart's Moving Average definition through `computeFor` gives exactly those columns (SMA, EMA, the default
 *      type), and a column of the input's length
 *   M3 a column is never another column's array: two computes return two arrays, and a source column handed in is
 *      never handed back
 *   M4 the other types still take their own path (WMA unchanged against the shipped maSeries)
 */
import { describe, it, expect } from 'vitest'
import { smaOfSeries, emaOfSeries, smaColumn, emaColumn, maSeries } from './movingAverages'
import * as registry from './engine/nativeRegistry'

/** What `toColumn` made of a native's points (its rule, restated for the reference). */
function refColumn(points, n) {
  const col = new Float64Array(n)
  col.fill(NaN)
  for (let i = 0; i < Math.min(points.length, n); i++) {
    const v = points[i] ? points[i].value : undefined
    if (Number.isFinite(v)) col[i] = v
  }
  return col
}
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) }
function series(n, seed, gaps = true) {
  const r = rng(seed)
  let x = 50 + r() * 100
  const out = []
  for (let i = 0; i < n; i++) {
    x = Math.max(0.01, x * (1 + (r() - 0.5) * 0.04))
    const cents = Math.round(x * 100) / 100
    const g = gaps ? r() : 1
    out.push(g < 0.004 ? NaN : g < 0.006 ? Infinity : g < 0.007 ? undefined : cents)
  }
  return out
}
const same = (a, b) => {
  expect(a.length).toBe(b.length)
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) throw new Error(`index ${i}: ${a[i]} != ${b[i]}`)
}

describe('the shipped SMA / EMA, written straight into a column', () => {
  it('M1 bit for bit the column toColumn made of the shipped points', () => {
    const periods = [1, 2, 3, 5, 9, 10, 20, 21, 50, 100, 200, 250, 0, -3, 2.7, NaN]
    for (const [n, seed, gaps] of [[0, 1, true], [1, 2, true], [7, 3, true], [260, 4, true], [3000, 5, true], [12000, 6, false], [12000, 7, true]]) {
      const src = series(n, seed, gaps)
      const f64 = Float64Array.from(src.map((v) => (v === undefined ? NaN : v)))
      for (const p of periods) {
        for (const s of [src, f64]) {
          same(smaColumn(s, p, n), refColumn(smaOfSeries(s, p, n), n))
          same(emaColumn(s, p, n), refColumn(emaOfSeries(s, p, n), n))
        }
        // a series shorter than n (the source still resolving): the same holes
        same(smaColumn(src.slice(0, n >> 1), p, n), refColumn(smaOfSeries(src.slice(0, n >> 1), p, n), n))
        same(emaColumn(src.slice(0, n >> 1), p, n), refColumn(emaOfSeries(src.slice(0, n >> 1), p, n), n))
      }
    }
  })

  it('M2 the Moving Average definition computes exactly those columns', () => {
    const def = registry.getDefinition('movingAverage')
    const src = series(5000, 11)
    const bars = src.map((c, i) => ({ t: 1_700_000_000 + i * 86400, o: c, h: c, l: c, c, v: 1 }))
    const source = Float64Array.from(src.map((v) => (v === undefined ? NaN : v)))
    for (const [maType, ref] of [[undefined, smaOfSeries], ['sma', smaOfSeries], ['ema', emaOfSeries]]) {
      for (const period of [9, 21, 50, 200]) {
        const cols = registry.computeFor(def, bars, { period, ...(maType ? { maType } : {}) }, { source })
        expect(cols.ma).toBeInstanceOf(Float64Array)
        expect(cols.ma.length).toBe(bars.length)
        same(cols.ma, refColumn(ref(source, period, bars.length), bars.length))
      }
    }
  })

  it('M3 a column is never another column\'s array', () => {
    const def = registry.getDefinition('movingAverage')
    const src = series(800, 12, false)
    const bars = src.map((c, i) => ({ t: 1_700_000_000 + i * 86400, o: c, h: c, l: c, c, v: 1 }))
    const source = Float64Array.from(src)
    const a = registry.computeFor(def, bars, { period: 20 }, { source }).ma
    const b = registry.computeFor(def, bars, { period: 20 }, { source }).ma
    expect(a).not.toBe(b)
    expect(a).not.toBe(source)
    same(a, b)
    // a period of 1 (the running sum of one value: the shipped arithmetic, not the source copied): a column of its own
    const one = registry.computeFor(def, bars, { period: 1 }, { source }).ma
    expect(one).not.toBe(source)
    same(one, refColumn(smaOfSeries(source, 1, bars.length), bars.length))
  })

  it('M4 the other types keep their own path', () => {
    const def = registry.getDefinition('movingAverage')
    const src = series(600, 13, false)
    const bars = src.map((c, i) => ({ t: 1_700_000_000 + i * 86400, o: c, h: c, l: c, c, v: 1 }))
    const source = Float64Array.from(src)
    const cols = registry.computeFor(def, bars, { period: 14, maType: 'wma' }, { source })
    const ref = maSeries('wma', Array.from(source), 14, null)
    for (let i = 0; i < bars.length; i++) expect(Object.is(cols.ma[i], Number.isFinite(ref[i]) ? ref[i] : NaN)).toBe(true)
  })
})
