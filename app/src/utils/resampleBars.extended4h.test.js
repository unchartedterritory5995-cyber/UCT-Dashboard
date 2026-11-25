// ⭐ EXTENDED-HOURS CUSTOM INTRADAY BARS START AT THE SESSION START, 04:00 ET (2026-11-25).
// Witness: TradingView's 4h bars in the Fred RS captures (runs/fred-4h-2026-11-24, layout 01f1AcIj, session 0400-2000):
// SPY (20,024 bars since 2007), RDDT (2,682) and ADT (7,459) start ONLY at 04:00 / 08:00 / 12:00 / 16:00 ET, every day,
// EST and EDT alike, half-days included. Anchored at 09:30, ours started at 01:30 / 05:30 / 09:30 / 13:30 / 17:30, so
// every extended-hours 4h candle differed in start, end and OHLC. The bar starts below are TradingView's own (SPY).
// The REGULAR-session 4h grid is NOT captured yet: it stays anchored at 09:30 (09:30-13:30, 13:30-16:00), railed equal.
import { describe, it, expect, afterEach } from 'vitest'
import { resampleForSpec } from './resampleBars'
import { resampleSpec } from '../components/chart/timeframes'
import { compareBarsRequest } from '../components/chart/useLegacyChartBars'
import { secondaryFetchOf, offSessionRowOf } from '../components/chart/engine/secondaryBars'
import { benchmarkTailUrl, tailBarsFromWire } from '../components/chart/engine/liveTail'
import { setViewShowExtended } from './viewSession'

afterEach(() => setViewShowExtended(false))

// TradingView's 04:00 ET bar start (unix s) on each witnessed day, and that day's four 4h starts.
const TV = {
  '2026-11-24 (EST)': 1795510800,
  '2026-10-14 (EDT)': 1791964800,
  '2025-03-07 (EST, Friday before the DST change)': 1741338000,
  '2025-03-10 (EDT, Monday after it)': 1741593600,
  '2025-11-28 (half-day)': 1764320400,
  '2025-12-24 (half-day)': 1766566800,
}
const tvStarts = (t0) => [t0, t0 + 4 * 3600, t0 + 8 * 3600, t0 + 12 * 3600]

/** The extended view's 60m base for a day: clock hours 04:00..19:00 ET (the `session=eth` grid), each row's values
 *  its index so membership is visible in the output (o = first member's, c = last's, h = max, l = min, v = sum). */
const clockHours = (t0, n = 16) => Array.from({ length: n }, (_, k) => ({ t: t0 + k * 3600, o: k, h: k + 0.5, l: k - 0.5, c: k + 0.25, v: 1 }))

describe('extended hours: 4h buckets on TradingView\'s grid', () => {
  it.each(Object.entries(TV))('%s: the bars start where TradingView\'s do (04:00 / 08:00 / 12:00 / 16:00 ET)', (_day, t0) => {
    const out = resampleForSpec(clockHours(t0), resampleSpec('240', { extended: true }))
    expect(out.map((b) => b.t)).toEqual(tvStarts(t0))
  })

  it('each bucket holds its four clock hours: open of the first, close of the last, high/low/volume over all four', () => {
    const t0 = TV['2026-11-24 (EST)']
    const out = resampleForSpec(clockHours(t0), resampleSpec('240', { extended: true }))
    expect(out).toEqual([0, 4, 8, 12].map((k, i) => ({ t: tvStarts(t0)[i], o: k, h: k + 3.5, l: k - 0.5, c: k + 3.25, v: 4 })))
  })

  it('a half-day\'s shorter evening still ends in the 16:00 bar', () => {
    const t0 = TV['2025-11-28 (half-day)']
    const out = resampleForSpec(clockHours(t0, 13), resampleSpec('240', { extended: true }))   // 04:00..16:00
    expect(out.map((b) => b.t)).toEqual(tvStarts(t0))
    expect(out[3]).toMatchObject({ o: 12, c: 12.25, v: 1 })
  })

  it('CONTROL (regular hours, unchanged until TradingView\'s regular 4h is captured): 09:30-13:30 and 13:30-16:00', () => {
    const open = TV['2026-11-24 (EST)'] + 330 * 60               // 09:30 ET
    const session = Array.from({ length: 7 }, (_, k) => ({ t: open + k * 3600, o: k, h: k, l: k, c: k, v: 1 }))   // 09:30..15:30
    expect(resampleForSpec(session, resampleSpec('240')).map((b) => b.t)).toEqual([open, open + 4 * 3600])
    expect(resampleSpec('240', { extended: false })).toEqual(resampleSpec('240'))
  })
})

describe('every reader of a custom timeframe builds it on the same grid in the extended view', () => {
  it('a Compare symbol: its 60m base on the extended grid, resampled at 04:00', () => {
    const r = compareBarsRequest('spy', '240', 900, '', true)
    expect(r.url).toContain('tf=60&')
    expect(r.url).toContain('&session=eth')
    expect(r.spec.anchorMin).toBe(240)
    expect(compareBarsRequest('spy', '240', 900, '').url).not.toContain('session=')   // the regular view: as before
  })

  it('another symbol\'s bars (a script\'s request.security): keyed and fetched with the session, built at 04:00', () => {
    setViewShowExtended(true)
    const w = secondaryFetchOf('SPX', '240', 500)
    expect(w.url).toContain('tf=240&')
    expect(w.url).toContain('&session=eth')
    expect(w.fetchUrl).toContain('tf=60&')
    expect(w.fetchUrl).toContain('&session=eth')
    expect(w.spec.anchorMin).toBe(240)
    // the extended grid's clock hours are on the session it is built on (before: "a 60-minute bar at 04:00 ET")
    expect(offSessionRowOf(clockHours(TV['2026-11-24 (EST)']), w.spec)).toBeNull()
    setViewShowExtended(false)
    expect(secondaryFetchOf('SPX', '240', 500).url).not.toContain('session=')
  })

  it('a benchmark tail: its base on the extended grid, its rows at 04:00 / 08:00 / 12:00 / 16:00', () => {
    setViewShowExtended(true)
    expect(benchmarkTailUrl('SPX', '240')).toContain('&session=eth')
    const t0 = TV['2026-11-24 (EST)']
    const rows = tailBarsFromWire({ bars: clockHours(t0) }, '240')
    expect(rows.map((r) => r.t)).toEqual(tvStarts(t0).slice(1))   // (its first bucket may be partial: dropped)
  })
})
