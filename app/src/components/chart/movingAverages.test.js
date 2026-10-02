// app/src/components/chart/movingAverages.test.js
//
// ─── THE SHIPPED SMA/EMA ARE BYTE-IDENTICAL AFTER THE MOVE (2026-10-01) ──────
//
// `smaOfSeries` / `emaOfSeries` drew every Moving Average on every saved chart
// from `engine/nativeRegistry.js`. They moved into `movingAverages.js` with seven
// new types beside them. The copies below are the ORIGINAL code, frozen verbatim
// from origin/master c75bf6ea0, and the moved functions must reproduce them
// IEEE-754 bit for bit — on clean data, on gappy data and at odd periods — or an
// existing chart would draw different numbers after this change.

import { describe, it, expect } from 'vitest'
import {
  smaOfSeries, emaOfSeries, maSeries, MA_TYPES, MA_TYPE_IDS,
} from './movingAverages'
import * as registry from './engine/nativeRegistry'

// ── the originals, verbatim ─────────────────────────────────────────────────
function ORIGINAL_smaOfSeries(src, period, n) {
  const out = new Array(n)
  const p = Math.max(1, Math.floor(period) || 1)
  let sum = 0
  let have = 0
  for (let i = 0; i < n; i++) {
    const v = src[i]
    if (Number.isFinite(v)) { sum += v; have++ } else { sum = 0; have = 0; continue }
    if (have > p) { const drop = src[i - p]; if (Number.isFinite(drop)) sum -= drop; have-- }
    if (have === p) out[i] = { value: sum / p }
  }
  return out
}
function ORIGINAL_emaOfSeries(src, period, n) {
  const out = new Array(n)
  const p = Math.max(1, Math.floor(period) || 1)
  const k = 2 / (p + 1)
  let prev = null
  let sum = 0
  let have = 0
  for (let i = 0; i < n; i++) {
    const v = src[i]
    if (!Number.isFinite(v)) { prev = null; sum = 0; have = 0; continue }
    if (prev === null) {
      sum += v; have++
      if (have === p) { prev = sum / p; out[i] = { value: prev } }
      continue
    }
    prev = v * k + prev * (1 - k)
    out[i] = { value: prev }
  }
  return out
}

const series = (n, gaps = []) => Array.from({ length: n }, (_, i) =>
  (gaps.includes(i) ? NaN : 100 + Math.sin(i / 3.7) * 9.123456789 + i * 0.0137))
const same = (a, b) => {
  expect(a.length).toBe(b.length)
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ? a[i].value : undefined
    const y = b[i] ? b[i].value : undefined
    expect(Object.is(x, y), `[${i}] ${x} vs ${y}`).toBe(true)
  }
}

describe('SMA and EMA are the shipped functions, bit for bit', () => {
  for (const [label, src] of [['clean', series(800)], ['gappy', series(800, [3, 40, 41, 300, 555])]]) {
    for (const p of [1, 2, 5, 9, 20, 50, 200, 500]) {
      it(`${label} · period ${p}`, () => {
        same(smaOfSeries(src, p, src.length), ORIGINAL_smaOfSeries(src, p, src.length))
        same(emaOfSeries(src, p, src.length), ORIGINAL_emaOfSeries(src, p, src.length))
      })
    }
  }

  it('…and the Moving Average definition still routes SMA/EMA through them', () => {
    const def = registry.getDefinition('movingAverage')
    const src = series(400, [120])
    const bars = src.map((c, i) => ({ t: 1_700_000_000 + i * 86400, o: c, h: c, l: c, c, v: 1 }))
    for (const [maType, orig] of [['sma', ORIGINAL_smaOfSeries], ['ema', ORIGINAL_emaOfSeries], [undefined, ORIGINAL_smaOfSeries]]) {
      const cols = registry.computeFor(def, bars, { period: 20, ...(maType ? { maType } : {}) }, { source: Float64Array.from(src) })
      const want = orig(src, 20, src.length)
      for (let i = 0; i < src.length; i++) {
        const w = want[i] ? want[i].value : NaN
        expect(Object.is(cols.ma[i], w) || (Number.isNaN(cols.ma[i]) && Number.isNaN(w)), `${maType}[${i}]`).toBe(true)
      }
    }
  })
})

describe('the nine types', () => {
  it('are offered in kit order, and every one computes', () => {
    expect(MA_TYPE_IDS).toEqual(['sma', 'ema', 'wma', 'vwma', 'hma', 'smma', 'dema', 'tema', 'lsma'])
    expect(MA_TYPES.map(([, l]) => l)).toEqual(['SMA', 'EMA', 'WMA', 'VWMA', 'HMA', 'SMMA', 'DEMA', 'TEMA', 'LSMA'])
    const src = series(300)
    const vol = src.map((_, i) => 1e6 + (i % 7) * 1e4)
    for (const t of MA_TYPE_IDS) {
      expect(maSeries(t, src, 21, vol).some(Number.isFinite), t).toBe(true)
    }
  })

  it('first valid bar, period 21: the documented warm-ups', () => {
    const src = series(300)
    const vol = src.map(() => 1)
    const first = (t) => maSeries(t, src, 21, vol).findIndex(Number.isFinite)
    expect(first('sma')).toBe(20)
    expect(first('ema')).toBe(20)
    expect(first('wma')).toBe(20)
    expect(first('vwma')).toBe(20)
    expect(first('smma')).toBe(20)
    expect(first('lsma')).toBe(20)
    expect(first('dema')).toBe(40)                 // 2n − 2
    expect(first('tema')).toBe(60)                 // 3n − 3
    expect(first('hma')).toBe(20 + 5 - 1)          // n − 1, then round(√21) = 5
  })

  it('a constant series is its own average, for every type', () => {
    const src = Array(200).fill(42)
    const vol = Array(200).fill(3)
    for (const t of MA_TYPE_IDS) {
      const out = maSeries(t, src, 10, vol).filter(Number.isFinite)
      expect(out.length, t).toBeGreaterThan(100)
      for (const x of out) expect(Math.abs(x - 42), t).toBeLessThan(1e-9)
    }
  })

  it('an unknown stored type falls back to SMA rather than drawing nothing', () => {
    const src = series(100)
    expect(maSeries('bogus', src, 10)).toEqual(maSeries('sma', src, 10))
  })

  it('VWMA refuses a source with no bar-aligned volume (a foreign symbol)', () => {
    const def = registry.getDefinition('movingAverage')
    const bars = series(100).map((c, i) => ({ t: i, o: c, h: c, l: c, c, v: 1000 }))
    const ctx = { source: Float64Array.from(series(100)) }
    const own = registry.computeFor(def, bars, { period: 10, maType: 'vwma', source: 'close' }, ctx)
    const foreign = registry.computeFor(def, bars, { period: 10, maType: 'vwma', source: 'sym:QQQ:close' }, ctx)
    expect(registry.hasAnyFinite(own.ma)).toBe(true)
    expect(registry.hasAnyFinite(foreign.ma), 'a QQQ VWMA weighted by this chart\'s volume drew').toBe(false)
  })
})
