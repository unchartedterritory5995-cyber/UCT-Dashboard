// computeBarTime W/M must not depend on the BROWSER's time zone (a Sydney / Auckland member
// saw the weekly bar labelled Thursday for a morning-ET tick). Runs the same instants under
// several process time zones; the label is an ET-calendar fact.
import { describe, it, expect, afterEach } from 'vitest'
import { computeBarTime, etWeekCloseLabel, fromChartTime } from './barTime'

const ORIG_TZ = process.env.TZ
afterEach(() => { if (ORIG_TZ === undefined) delete process.env.TZ; else process.env.TZ = ORIG_TZ })

// ET wall clock → unix (TZ-independent: chart time is ET wall read as UTC).
const et = (iso, hh, mm = 0) => fromChartTime(Date.UTC(...iso.split('-').map((x, i) => (i === 1 ? x - 1 : +x))) / 1000 + hh * 3600 + mm * 60)

const CASES = [
  // [ET date, hour, minute, weekly label, monthly label]
  ['2026-11-10', 9, 35, '2026-11-13', '2026-11-01'],   // Tuesday morning
  ['2026-11-13', 4, 5, '2026-11-13', '2026-11-01'],    // Friday pre-market
  ['2026-11-15', 23, 30, '2026-11-13', '2026-11-01'],  // Sunday late → previous Friday
  ['2026-11-30', 8, 0, '2026-12-04', '2026-11-01'],    // Monday, week ends in December
  ['2026-03-09', 9, 30, '2026-03-13', '2026-03-01'],   // first day after spring-forward
  ['2026-11-02', 19, 59, '2026-11-06', '2026-11-01'],  // first day after fall-back
  ['2027-01-01', 10, 0, '2027-01-01', '2027-01-01'],   // Friday, new year
]

describe('computeBarTime W/M is browser-time-zone independent', () => {
  for (const tz of ['America/New_York', 'UTC', 'Australia/Sydney', 'Pacific/Auckland', 'America/Los_Angeles', 'Asia/Kolkata']) {
    it(`labels the ET week / month correctly with TZ=${tz}`, () => {
      process.env.TZ = tz
      for (const [iso, h, m, w, mo] of CASES) {
        const t = et(iso, h, m)
        expect(computeBarTime('W', t), `${iso} ${h}:${m} W`).toBe(w)
        expect(etWeekCloseLabel(t)).toBe(w)
        expect(computeBarTime('M', t), `${iso} ${h}:${m} M`).toBe(mo)
        expect(computeBarTime('D', t)).toBe(iso)
      }
    })
  }
})
