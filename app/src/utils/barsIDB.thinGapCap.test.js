// W-D (2026-11-10): two barsIDB rules the intraday scan depends on.
//
// 1. A same-day interior hole no longer DISCARDS the cache (thin names: a legitimate
//    20-minute no-trade stretch nulled the entry on every open → a cold full refetch
//    with nothing on screen, forever, because the hole came straight back). idbGet now
//    keeps the bars and reports `repairFromT`, and the chart's `since=` starts there.
// 2. idbPut persists what idbGet can read back (the newest INTRADAY_MAX_BARS) instead
//    of rewriting a 9k-32k scroll-back series on every poll merge.
import { describe, it, expect } from 'vitest'
import { _intradayGapStart, _capForWrite, INTRADAY_MAX_BARS } from './barsIDB'

const ET0 = Math.floor(Date.UTC(2026, 8, 15, 13, 30) / 1000)   // Tue 09:30 ET
const run = (start, n, step) => Array.from({ length: n }, (_, i) => ({ t: start + i * step, o: 1, h: 1, l: 1, c: 1, v: 1 }))

describe('_intradayGapStart', () => {
  it('returns null for a continuous series', () => {
    expect(_intradayGapStart(run(ET0, 50, 300), '5')).toBeNull()
  })
  it('returns the bar BEFORE a same-day hole, so since= re-asks the hole', () => {
    const a = run(ET0, 10, 300)                         // 09:30 .. 10:15
    const b = run(ET0 + 10 * 300 + 1800, 10, 300)       // 30-minute hole, then 10:45 ..
    expect(_intradayGapStart([...a, ...b], '5')).toBe(a[a.length - 1].t)
  })
  it('ignores an overnight boundary', () => {
    const a = run(ET0, 78, 300)
    const b = run(ET0 + 86400, 10, 300)
    expect(_intradayGapStart([...a, ...b], '5')).toBeNull()
  })
  it('is inert on D/W/M', () => {
    expect(_intradayGapStart(run(ET0, 10, 86400 * 3), 'D')).toBeNull()
  })
})

describe('_capForWrite', () => {
  it('caps intraday writes to the window idbGet reads back, keeping the NEWEST bars', () => {
    const deep = run(ET0, INTRADAY_MAX_BARS + 500, 60)
    const out = _capForWrite('1', deep)
    expect(out.length).toBe(INTRADAY_MAX_BARS)
    expect(out[out.length - 1].t).toBe(deep[deep.length - 1].t)
  })
  it('leaves D/W/M and short intraday series untouched', () => {
    const d = Array.from({ length: 5000 }, (_, i) => ({ t: `d${i}` }))
    expect(_capForWrite('D', d)).toBe(d)
    const s = run(ET0, 100, 300)
    expect(_capForWrite('5', s)).toBe(s)
  })
})
