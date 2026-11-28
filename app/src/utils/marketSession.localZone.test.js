// ⛔ THE SESSION FRONTIER IS READ ON THE ET CALENDAR, IN ANY BROWSER TIME ZONE (2026-11-28, found while tracing B9).
// expectedLatestCompletedBar and expectedFormingBar took the WEEKDAY (and the holiday / early-close date) from
// `new Date(nowMs)`, the browser's LOCAL calendar. East of New York the ET evening is already the next day locally: at
// 20:49 ET on Friday 2026-11-27 a Berlin or Tokyo page reads Saturday, the frontier reads null, and expectedBarsBehind then
// says "no expectation", so NO intraday copy counts as behind: a stale chart can paint as current. And at 10:30 ET on
// Wednesday 11-25, Tokyo is already Thursday 11-26 (Thanksgiving): the frontier read null in the middle of the session.
// Every other reader in the module takes etWallDate(nowMs); these two now do too. Each case runs under several real
// time zones (Node re-reads process.env.TZ at runtime).
import { describe, it, expect, afterEach } from 'vitest'
import { expectedLatestCompletedBar, expectedFormingBar, expectedBarsBehind } from './marketSession'

const ZONES = ['America/New_York', 'America/Los_Angeles', 'UTC', 'Europe/Berlin', 'Asia/Tokyo']
const TZ0 = process.env.TZ
afterEach(() => { if (TZ0 == null) delete process.env.TZ; else process.env.TZ = TZ0 })

const et = (iso, hh, mm, ss = 0) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d, hh + 5, mm, ss) / 1000 }   // EST

describe('the session frontier reads the ET calendar whatever the browser zone', () => {
  for (const tz of ZONES) {
    it(`${tz}: after the 11-27 half day (20:49 ET) the newest closed 1m bucket is 12:59, and a 12:56 tail is 3 behind`, () => {
      process.env.TZ = tz
      const now = et('2026-11-27', 20, 49, 30) * 1000
      expect(expectedLatestCompletedBar('1', now)).toBe(et('2026-11-27', 12, 59))
      expect(expectedLatestCompletedBar('15', now)).toBe(et('2026-11-27', 12, 45))
      expect(expectedBarsBehind(et('2026-11-27', 12, 56), '1', now)).toBe(3)
      expect(expectedFormingBar('1', now)).toBe(null)                      // nothing forms after the close
    })

    it(`${tz}: mid-session Wednesday 11-25 10:30 ET (Thanksgiving already in Tokyo) has a frontier and a forming bar`, () => {
      process.env.TZ = tz
      const now = et('2026-11-25', 10, 30, 30) * 1000
      expect(expectedLatestCompletedBar('5', now)).toBe(et('2026-11-25', 10, 25))
      expect(expectedFormingBar('5', now)).toBe(et('2026-11-25', 10, 30))
    })

    it(`${tz}: Thanksgiving itself (11-26 11:00 ET) has none`, () => {
      process.env.TZ = tz
      const now = et('2026-11-26', 11, 0) * 1000
      expect(expectedLatestCompletedBar('5', now)).toBe(null)
      expect(expectedFormingBar('5', now)).toBe(null)
    })
  }

  it('(control) the zone really changes the local calendar in this runner', () => {
    const t = et('2026-11-27', 20, 49) * 1000
    process.env.TZ = 'Asia/Tokyo'
    const tokyo = new Date(t).getDay()
    process.env.TZ = 'America/New_York'
    const ny = new Date(t).getDay()
    expect([ny, tokyo]).toEqual([5, 6])
  })
})
