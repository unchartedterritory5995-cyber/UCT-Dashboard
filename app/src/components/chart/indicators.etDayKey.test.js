// The ET calendar day behind the session VWAP, read without one Intl call per bar (2026-11-20).
// The IANA database stays the authority: the fast path must agree with one formatter call per instant on every
// UTC hour of 1990-2040 (both DST transitions of every year included), and a VWAP over a deep 60m series must
// not call the formatter once per bar; a second symbol over the same calendar must not call it at all.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { etDayKey, etDayKeyIntl, computeVWAP } from './indicators'

afterEach(() => { vi.restoreAllMocks() })

describe('etDayKey', () => {
  // FIRST: the per-year zone cache is module state, and the exhaustive test below fills it
  it('a VWAP over a deep 60m series reads the zone per YEAR, and a second symbol not at all', () => {
    // 45,000 hourly bars (~5 years of 24h, the shape that cost 71 ms: every bar a new UTC hour)
    const t0 = Date.UTC(2021, 0, 4, 14) / 1000
    const bars = Array.from({ length: 45000 }, (_, i) => ({ t: t0 + i * 3600, o: 10, h: 11, l: 9, c: 10, v: 100 }))
    const spy = vi.spyOn(Intl.DateTimeFormat.prototype, 'formatToParts')
    computeVWAP(bars)
    const first = spy.mock.calls.length
    expect(first).toBeLessThan(600)                        // a few dozen per year, never one per bar
    spy.mockClear()
    computeVWAP(bars.map((b) => ({ ...b, c: 20 })))         // another symbol, the same calendar
    expect(spy.mock.calls.length).toBe(0)
  })
  it('agrees with the IANA reading on every UTC hour of 1990-2040', () => {
    const from = Date.UTC(1990, 0, 1) / 3600000
    const to = Date.UTC(2041, 0, 1) / 3600000
    let bad = null
    for (let h = from; h < to && !bad; h++) {
      const ms = h * 3600000 + 1234                        // inside the hour, not on its edge
      if (etDayKey(ms) !== etDayKeyIntl(ms)) bad = new Date(ms).toISOString()
    }
    expect(bad).toBe(null)
  })

  it('agrees on the DST edges themselves, minute by minute (2025 spring and fall, 1990s rule years)', () => {
    const edges = [Date.UTC(2025, 2, 9, 6), Date.UTC(2025, 10, 2, 5), Date.UTC(1999, 3, 4, 6), Date.UTC(1999, 9, 31, 5)]
    for (const e of edges) {
      for (let m = 0; m < 180; m++) {
        const ms = e + m * 60000
        expect(etDayKey(ms), new Date(ms).toISOString()).toBe(etDayKeyIntl(ms))
      }
    }
  })

})
