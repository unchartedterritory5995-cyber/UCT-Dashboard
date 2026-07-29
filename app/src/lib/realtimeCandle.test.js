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
