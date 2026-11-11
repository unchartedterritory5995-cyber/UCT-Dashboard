import { describe, it, expect, beforeEach } from 'vitest'
import * as rc from './realtimeCandle'

const T = 1_800_000_000            // some minute boundary
const inMinute = (n) => T + n      // seconds inside the same 1-min bucket

describe('applyTick volume — the tick carries the bar CUMULATIVE, not a delta', () => {
  beforeEach(() => rc._reset())

  it('does not compound successive cumulative values', () => {
    // api/services/realtime_candle.py does `cur["v"] += size` per trade and
    // api/routers/stream.py emits that running total as the tick's `vol`.
    rc.applyTick('SOXL', 105.0, 1_000, inMinute(1))
    rc.applyTick('SOXL', 105.1, 2_500, inMinute(20))
    rc.applyTick('SOXL', 105.2, 4_000, inMinute(50))
    // Summing these gave 7,500 — and on a busy name, tens of millions within a
    // single bar: the phantom volume spike on the most recent candle.
    expect(rc.getCandle('SOXL', '1').v).toBe(4_000)
  })

  it('a new minute restarts from that minute own cumulative', () => {
    rc.applyTick('SOXL', 105.0, 9_000, inMinute(30))
    rc.applyTick('SOXL', 105.5, 120, T + 60 + 5)
    const c = rc.getCandle('SOXL', '1')
    expect(c.t).toBe(T + 60)
    expect(c.v).toBe(120)
  })

  it('stays monotonic if a tick arrives out of order', () => {
    rc.applyTick('SOXL', 105.0, 5_000, inMinute(10))
    rc.applyTick('SOXL', 105.1, 3_000, inMinute(20))   // stale/reordered
    expect(rc.getCandle('SOXL', '1').v).toBe(5_000)
  })

  it('still tracks o/h/l/c normally', () => {
    rc.applyTick('SOXL', 105.0, 100, inMinute(1))
    rc.applyTick('SOXL', 106.0, 200, inMinute(2))
    rc.applyTick('SOXL', 104.0, 300, inMinute(3))
    const c = rc.getCandle('SOXL', '1')
    expect(c).toMatchObject({ o: 105.0, h: 106.0, l: 104.0, c: 104.0, v: 300 })
  })
})

describe('applyBarClose — D1: the 1m bar_close payload carries {t,c,v} and NO o/h/l', () => {
  beforeEach(() => rc._reset())

  it('merges with the developing candle so o/h/l are never undefined', () => {
    rc.applyTick('SYN', 50.0, 100, inMinute(1))
    rc.applyTick('SYN', 51.0, 200, inMinute(10))
    rc.applyTick('SYN', 49.5, 300, inMinute(40))
    rc.applyBarClose('SYN', '1', { t: T, c: 50.2, v: 350 })   // server shape, stream.py:243-249
    const c = rc.getCandle('SYN', '1')
    expect(c).toMatchObject({ t: T, o: 50.0, h: 51.0, l: 49.5, c: 50.2, v: 350 })
    for (const k of ['o', 'h', 'l', 'c']) expect(Number.isFinite(c[k])).toBe(true)
  })

  it('with nothing to merge from, the close stands in for missing extremes (never undefined)', () => {
    rc.applyBarClose('SYN', '1', { t: T, c: 50.2, v: 10 })
    const c = rc.getCandle('SYN', '1')
    expect(c).toMatchObject({ o: 50.2, h: 50.2, l: 50.2, c: 50.2 })
  })

  it('a close for an OLDER minute never clobbers the developing one', () => {
    rc.applyTick('SYN', 50.0, 100, T + 60 + 2)
    rc.applyBarClose('SYN', '1', { t: T, c: 49.0, v: 999 })
    expect(rc.getCandle('SYN', '1')).toMatchObject({ t: T + 60, c: 50.0, v: 100 })
  })

  it('payload fields that ARE present win (full bar / correction)', () => {
    rc.applyTick('SYN', 50.0, 100, inMinute(1))
    rc.applyCorrection('SYN', '1', { t: T, o: 49.9, h: 50.6, l: 49.8, c: 50.1, v: 400 })
    expect(rc.getCandle('SYN', '1')).toMatchObject({ o: 49.9, h: 50.6, l: 49.8, c: 50.1, v: 400 })
  })
})

describe('applyTick — late prior-minute print at the boundary', () => {
  beforeEach(() => rc._reset())

  it('does not reset the developing minute back to the older bucket', () => {
    rc.applyTick('SYN', 50.0, 100, T + 60 + 1)       // new minute opened
    rc.applyTick('SYN', 49.0, 5_000, inMinute(59))   // late print from the previous minute
    const c = rc.getCandle('SYN', '1')
    expect(c.t).toBe(T + 60)
    expect(c).toMatchObject({ o: 50.0, h: 50.0, l: 50.0, c: 50.0, v: 100 })
  })

  it('records the tick receipt time per symbol for fallback arbitration', () => {
    expect(rc.getLastTickAt('syn')).toBe(0)
    rc.applyTick('SYN', 50.0, 1, inMinute(1))
    expect(rc.getLastTickAt('syn')).toBeGreaterThan(0)
  })
})
