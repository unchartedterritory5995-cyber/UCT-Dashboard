// Off-grid intraday bars never draw as their own candle (prod 2026-11-10: SPY 5m
// 16:35:50 beside 16:35:00). Invented round-number prices only.
import { describe, it, expect } from 'vitest'
import { foldOffGridBars } from './offGridBars'

// 2026-11-06 16:35:00 ET (EST, UTC-5) = 21:35:00Z
const B = Date.UTC(2026, 10, 6, 21, 35) / 1000
const bar = (t, o = 10, h = 11, l = 9, c = 10, v = 100) => ({ t, o, h, l, c, v })

describe('foldOffGridBars', () => {
  it('drops a trade-time stamped row beside its bucket row — the bucket row wins untouched', () => {
    const twin = bar(B)
    const out = foldOffGridBars([bar(B - 300), twin, bar(B + 50, 10, 12, 8, 11, 7), bar(B + 300)], '5')
    expect(out.map(b => b.t)).toEqual([B - 300, B, B + 300])
    expect(out[1]).toBe(twin)   // no double-counted volume, no foreign close / wick
  })

  it('two strays of one empty bucket: open earliest, H/L extremes, close AND volume latest', () => {
    const out = foldOffGridBars([bar(B - 300), bar(B + 20, 10, 11, 9, 10, 40), bar(B + 50, 10.5, 12, 9.5, 11, 55)], '5')
    expect(out[1]).toEqual({ t: B, o: 10, h: 12, l: 9, c: 11, v: 55 })
  })

  it('re-keys a lone off-grid row to its bucket start', () => {
    const out = foldOffGridBars([bar(B - 300), bar(B + 41)], '5')
    expect(out.map(b => b.t)).toEqual([B - 300, B])
  })

  it('handles 1m / 15m and 60m seconds', () => {
    expect(foldOffGridBars([bar(B), bar(B + 33)], '1').map(b => b.t)).toEqual([B])
    expect(foldOffGridBars([bar(B - 1200), bar(B - 1200 + 31)], '15').map(b => b.t)).toEqual([B - 1200])
    const H = Date.UTC(2026, 10, 5, 22, 0) / 1000   // 17:00 ET
    expect(foldOffGridBars([bar(H), bar(H + 41)], '60').map(b => b.t)).toEqual([H])
  })

  it('60m: a minute-aligned stray is caught too (session + clock grid aware)', () => {
    const et = (h, m) => Date.UTC(2026, 10, 5, h + 5, m) / 1000   // EST
    // 10:47 is no bucket start; its 10:30 session bucket exists → dropped (RTH view:
    // the series is on the session grid).
    expect(foldOffGridBars([bar(et(10, 30)), bar(et(10, 47))], '60', { showExtended: false }).map(b => b.t)).toEqual([et(10, 30)])
    // ETH view (#1061): the series is the clock grid, so the stray's bucket is 10:00.
    expect(foldOffGridBars([bar(et(10, 0)), bar(et(10, 47))], '60', { showExtended: true }).map(b => b.t)).toEqual([et(10, 0)])
    // 17:30 is not a start on either grid (post-market is clock hours) → 17:00.
    expect(foldOffGridBars([bar(et(16, 0)), bar(et(17, 30))], '60').map(b => b.t)).toEqual([et(16, 0), et(17, 0)])
    // Valid starts on both grids are untouched.
    const ok = [bar(et(9, 0)), bar(et(9, 30)), bar(et(10, 30)), bar(et(15, 30)), bar(et(16, 0))]
    expect(foldOffGridBars(ok, '60')).toBe(ok)
  })

  it('returns the same array for a clean series and ignores daily', () => {
    const clean = [bar(B), bar(B + 300)]
    expect(foldOffGridBars(clean, '5')).toBe(clean)
    const daily = [{ t: '2026-11-06', o: 1, h: 1, l: 1, c: 1 }]
    expect(foldOffGridBars(daily, 'D')).toBe(daily)
  })
})
