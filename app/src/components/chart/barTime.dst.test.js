// barTime — per-instant ET chart time + the TradingView 60m grid.
//
// ⛔ THE DEFECT (2026-11-10): the intraday display offset was ONE constant read at
// module load, so after the Nov 1 DST change every pre-Nov-1 bar was labelled an
// hour early. These cases run on any box, any season: each expectation is
// derived from Intl (the IANA database) per instant, never from "now".
import { describe, it, expect } from 'vitest'
import {
  etOffsetSec, toChartTime, fromChartTime, etMinuteOfDay, etDateOf,
  bucketStartUnix, computeBarTime, sixtyMinGridFor, SIXTY_MIN_GRID_BY_SESSION,
  rthCloseMinuteOf, bucketEndUnix, bucketEndChartTime,
} from './barTime'

const NY = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
})
// The ET wall clock of `u`, as "UTC seconds" (what a chart time must equal).
function wallAsUtc(u) {
  const p = {}
  for (const x of NY.formatToParts(new Date(u * 1000))) if (x.type !== 'literal') p[x.type] = Number(x.value)
  return Date.UTC(p.year, p.month - 1, p.day, p.hour === 24 ? 0 : p.hour, p.minute, p.second) / 1000
}
const utc = (y, mo, d, h = 0, mi = 0) => Date.UTC(y, mo - 1, d, h, mi) / 1000
// unix second of an ET wall time (test-side, independent of barTime).
function et(y, mo, d, h, mi = 0) {
  for (const off of [4, 5]) {
    const u = utc(y, mo, d, h + off, mi)
    if (wallAsUtc(u) === utc(y, mo, d, h, mi)) return u
  }
  throw new Error('no such ET wall time')
}
const hhmm = (u) => {
  const m = etMinuteOfDay(u)
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

// Both 2026 transitions, three days either side, every minute.
const WINDOWS = [
  [utc(2026, 3, 5), utc(2026, 3, 12)],    // spring forward Sun Mar 8 02:00 EST -> 03:00 EDT
  [utc(2026, 10, 29), utc(2026, 11, 5)],  // fall back    Sun Nov 1 02:00 EDT -> 01:00 EST
]
const everyMinute = (fn) => { for (const [a, b] of WINDOWS) for (let u = a; u < b; u += 60) fn(u) }

describe('etOffsetSec / toChartTime — per instant, both 2026 DST transitions', () => {
  it('chart time equals the ET wall clock for EVERY minute (incl. the transition minutes)', () => {
    let n = 0
    everyMinute((u) => { expect(toChartTime(u)).toBe(wallAsUtc(u)); n++ })
    expect(n).toBe(2 * 7 * 1440)
  })

  it('a pre-Nov-1 bar keeps its EDT label, a post-Nov-1 bar its EST label (the reported bug)', () => {
    const oct30open = utc(2026, 10, 30, 13, 30)   // 09:30 EDT
    const nov2open = utc(2026, 11, 2, 14, 30)     // 09:30 EST
    expect(etOffsetSec(oct30open)).toBe(-14400)
    expect(etOffsetSec(nov2open)).toBe(-18000)
    expect(hhmm(oct30open)).toBe('09:30')
    expect(hhmm(nov2open)).toBe('09:30')
    // A module-load constant would have put one of these at 08:30 or 10:30.
    expect(toChartTime(oct30open) % 86400).toBe(toChartTime(nov2open) % 86400)
  })

  it('switches at exactly the transition second', () => {
    const spring = utc(2026, 3, 8, 7)   // 02:00 EST == 07:00 UTC
    expect(etOffsetSec(spring - 1)).toBe(-18000)
    expect(etOffsetSec(spring)).toBe(-14400)
    const fall = utc(2026, 11, 1, 6)    // 02:00 EDT == 06:00 UTC
    expect(etOffsetSec(fall - 1)).toBe(-14400)
    expect(etOffsetSec(fall)).toBe(-18000)
  })

  it('fractional seconds (Date.now()/1000) resolve like their whole second', () => {
    const u = utc(2026, 11, 1, 6)
    expect(etOffsetSec(u - 0.5)).toBe(-14400)
    expect(etOffsetSec(u + 0.5)).toBe(-18000)
  })
})

describe('fromChartTime — the matching inverse', () => {
  it('round-trips every minute except the repeated fall-back hour', () => {
    const fallRepeatStart = utc(2026, 11, 1, 6)   // 01:00 EST, the second 01:00
    const fallRepeatEnd = utc(2026, 11, 1, 7)
    everyMinute((u) => {
      if (u >= fallRepeatStart && u < fallRepeatEnd) return
      expect(fromChartTime(toChartTime(u))).toBe(u)
    })
  })

  it('the repeated 01:xx wall hour resolves to the EARLIER (EDT) instant; no session trades then', () => {
    const second = utc(2026, 11, 1, 6, 30)        // 01:30 EST
    expect(fromChartTime(toChartTime(second))).toBe(second - 3600)
  })

  it('round-trips every 1m bar of a regular + extended session on both sides of both transitions', () => {
    for (const [y, mo, d] of [[2026, 3, 6], [2026, 3, 9], [2026, 10, 30], [2026, 11, 2]]) {
      for (let u = et(y, mo, d, 4); u < et(y, mo, d, 20); u += 60) expect(fromChartTime(toChartTime(u))).toBe(u)
    }
  })

  it('refuses a non-number', () => {
    expect(fromChartTime('2026-11-02')).toBeNaN()
    expect(fromChartTime(NaN)).toBeNaN()
  })
})

describe('chart time is strictly increasing across both transitions (04:00-20:00 ET sessions)', () => {
  it('every 1m bar time of every session day in both windows', () => {
    const times = []
    for (const [a, b] of WINDOWS) {
      for (let u = a; u < b; u += 60) {
        const m = etMinuteOfDay(u)
        const wd = new Date(toChartTime(u) * 1000).getUTCDay()
        if (wd === 0 || wd === 6 || m < 240 || m >= 1200) continue
        times.push(toChartTime(u))
      }
    }
    expect(times.length).toBeGreaterThan(8 * 960)
    for (let i = 1; i < times.length; i++) expect(times[i]).toBeGreaterThan(times[i - 1])
  })

  it('every minute of both windows, except only the repeated fall-back hour', () => {
    for (const [a, b] of WINDOWS) {
      let prev = -Infinity, back = 0
      for (let u = a; u < b; u += 60) {
        const c = toChartTime(u)
        if (c <= prev) back++
        prev = c
      }
      expect(back).toBe(a === WINDOWS[1][0] ? 1 : 0)   // one step back, at 06:00 UTC Nov 1 (a Sunday)
    }
  })

  it('every 60m / 30m bucket time is strictly increasing across both transitions', () => {
    for (const tf of ['60', '30', '15', '5']) {
      for (const [a, b] of WINDOWS) {
        let prev = -Infinity
        for (let u = a; u < b; u += 60) {
          const wd = new Date(toChartTime(u) * 1000).getUTCDay()
          const m = etMinuteOfDay(u)
          if (wd === 0 || wd === 6 || m < 240 || m >= 1200) continue
          const c = computeBarTime(tf, u)
          expect(c).toBeGreaterThanOrEqual(prev)
          prev = c
        }
      }
    }
  })
})

// The 60m buckets of one ET day, as wall-clock labels, from every 1m bar 04:00-19:59.
function hourlyLabels(y, mo, d, grid) {
  const out = []
  for (let u = et(y, mo, d, 4); u < et(y, mo, d, 20); u += 60) {
    const s = hhmm(bucketStartUnix(u, 60, { grid }))
    if (out[out.length - 1] !== s) out.push(s)
  }
  return out
}
const SESSION_GRID_REGULAR = ['04:00', '05:00', '06:00', '07:00', '08:00', '09:00',
  '09:30', '10:30', '11:30', '12:30', '13:30', '14:30', '15:30',
  '16:00', '17:00', '18:00', '19:00']
const CLOCK_GRID = ['04:00', '05:00', '06:00', '07:00', '08:00', '09:00', '10:00', '11:00',
  '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00']

describe('60m grid — TradingView session alignment', () => {
  it("'session' grid: RTH 09:30 … 15:30 (the vendor capture), pre/post clock hours", () => {
    expect(hourlyLabels(2026, 9, 28, 'session')).toEqual(SESSION_GRID_REGULAR)
    // tests/fixtures/vendor/harness/vw-time-session-spy-60-rth-2026-09-28.json
    const rth = hourlyLabels(2026, 9, 28, 'session').filter((s) => s >= '09:30' && s < '16:00')
    expect(rth).toEqual(['09:30', '10:30', '11:30', '12:30', '13:30', '14:30', '15:30'])
  })

  it("'clock' grid: 04:00 … 19:00, the 09:00 bar spans the open (the vendor's extended capture)", () => {
    // tests/fixtures/vendor/harness/vw-time-session-spy-60-ext-2026-09-28.json
    expect(hourlyLabels(2026, 9, 28, 'clock')).toEqual(CLOCK_GRID)
    expect(hhmm(bucketStartUnix(et(2026, 9, 28, 9, 45), 60, { grid: 'clock' }))).toBe('09:00')
  })

  it('bucket edges: 09:00-09:29 pre bar, 09:30 opens a bucket, 10:29 still in it, 15:59 in the 15:30 half bar', () => {
    const at = (h, m) => hhmm(bucketStartUnix(et(2026, 11, 9, h, m), 60, { grid: 'session' }))
    expect(at(9, 29)).toBe('09:00')
    expect(at(9, 30)).toBe('09:30')
    expect(at(10, 29)).toBe('09:30')
    expect(at(10, 30)).toBe('10:30')
    expect(at(15, 29)).toBe('14:30')
    expect(at(15, 30)).toBe('15:30')
    expect(at(15, 59)).toBe('15:30')
    expect(at(16, 0)).toBe('16:00')
  })

  it('identical grids on the DST-change weekdays (EDT Friday / EST Monday, both transitions)', () => {
    for (const [y, mo, d] of [[2026, 3, 6], [2026, 3, 9], [2026, 10, 30], [2026, 11, 2]]) {
      expect(hourlyLabels(y, mo, d, 'session')).toEqual(SESSION_GRID_REGULAR)
      expect(hourlyLabels(y, mo, d, 'clock')).toEqual(CLOCK_GRID)
    }
  })

  it('half-day (Fri 2026-11-27, 13:00 close): 09:30, 10:30, 11:30, 12:30 (30-min) then post clock hours', () => {
    expect(rthCloseMinuteOf(et(2026, 11, 27, 10))).toBe(780)
    const labels = hourlyLabels(2026, 11, 27, 'session')
    expect(labels).toEqual(['04:00', '05:00', '06:00', '07:00', '08:00', '09:00',
      '09:30', '10:30', '11:30', '12:30', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00'])
    // 13:00-13:29 is POST-market: never fused into the 12:30 regular bar.
    expect(hhmm(bucketStartUnix(et(2026, 11, 27, 13, 15), 60, { grid: 'session' }))).toBe('13:00')
    expect(hhmm(bucketStartUnix(et(2026, 11, 27, 12, 59), 60, { grid: 'session' }))).toBe('12:30')
  })

  it('30m / 15m / 5m are the same on every grid and on half-days (09:30 is on the half hour)', () => {
    for (const [h, m, want] of [[9, 29, '09:00'], [9, 30, '09:30'], [12, 59, '12:30'], [13, 0, '13:00'], [15, 59, '15:30']]) {
      expect(hhmm(bucketStartUnix(et(2026, 11, 27, h, m), 30))).toBe(want)
    }
    expect(hhmm(bucketStartUnix(et(2026, 11, 2, 9, 44), 15))).toBe('09:30')
    expect(hhmm(bucketStartUnix(et(2026, 10, 30, 9, 44), 5))).toBe('09:40')
  })
})

describe('the policy is one switch', () => {
  it('both views read the stored session grid today', () => {
    expect(SIXTY_MIN_GRID_BY_SESSION).toEqual({ rth: 'session', extended: 'session' })
    expect(sixtyMinGridFor('rth')).toBe('session')
    expect(sixtyMinGridFor('extended')).toBe('session')
    expect(sixtyMinGridFor()).toBe('session')
  })
  it('a TradingView-extended policy routes the extended view to the clock grid', () => {
    const tv = { rth: 'session', extended: 'clock' }
    expect(sixtyMinGridFor('extended', tv)).toBe('clock')
    expect(sixtyMinGridFor('rth', tv)).toBe('session')
  })
})

describe('computeBarTime (the live writers\' bucket key)', () => {
  it('60m: the session-grid bucket as chart time, on either side of DST', () => {
    const oct = et(2026, 10, 30, 10, 45), nov = et(2026, 11, 2, 10, 45)
    expect(computeBarTime('60', oct)).toBe(toChartTime(et(2026, 10, 30, 10, 30)))
    expect(computeBarTime('60', nov)).toBe(toChartTime(et(2026, 11, 2, 10, 30)))
    expect(computeBarTime('60', et(2026, 11, 2, 9, 40))).toBe(toChartTime(et(2026, 11, 2, 9, 30)))
  })
  it('5m: floor + per-instant shift; D unchanged', () => {
    const u = et(2026, 10, 30, 15, 57)
    expect(computeBarTime('5', u)).toBe(toChartTime(et(2026, 10, 30, 15, 55)))
    expect(computeBarTime('D', u)).toBe('2026-10-30')
    expect(etDateOf(u)).toBe('2026-10-30')
  })
})

describe('bucket END (client twin of bar_rollup.tv_bucket_bounds[1])', () => {
  const end = (y, mo, d, h, m, grid) => hhmm(bucketEndUnix(et(y, mo, d, h, m), 60, { grid }))
  it('session/rth grid: 09:00 stub ends at the open, 15:30 at the close, others +1h', () => {
    expect(end(2026, 11, 9, 9, 10, 'rth')).toBe('09:30')
    expect(end(2026, 11, 9, 9, 30, 'rth')).toBe('10:30')
    expect(end(2026, 11, 9, 14, 45, 'rth')).toBe('15:30')
    expect(end(2026, 11, 9, 15, 45, 'rth')).toBe('16:00')
    expect(end(2026, 11, 9, 16, 10, 'rth')).toBe('17:00')
    expect(end(2026, 11, 9, 4, 0, 'session')).toBe('05:00')
  })
  it('half-day: the 12:30 bar ends at 13:00', () => {
    expect(end(2026, 11, 27, 12, 40, 'rth')).toBe('13:00')
    expect(end(2026, 11, 27, 13, 5, 'rth')).toBe('14:00')
  })
  it('eth/clock grid: clock hours; 09:00 spans the open', () => {
    expect(end(2026, 11, 9, 9, 10, 'eth')).toBe('10:00')
    expect(end(2026, 11, 9, 15, 45, 'clock')).toBe('16:00')
  })
  it('every bucket ends where the next one starts (both grids, both DST sides)', () => {
    for (const grid of ['session', 'clock']) {
      for (const [y, mo, d] of [[2026, 10, 30], [2026, 11, 2], [2026, 11, 27]]) {
        for (let u = et(y, mo, d, 4); u < et(y, mo, d, 19); u += 60) {
          const e = bucketEndUnix(u, 60, { grid })
          expect(bucketStartUnix(e, 60, { grid })).toBe(e)
          expect(bucketStartUnix(e - 60, 60, { grid })).toBe(bucketStartUnix(u, 60, { grid }))
        }
      }
    }
  })
  it('chart-time variant + computeBarTime accept the wire session names', () => {
    const t = toChartTime(et(2026, 10, 30, 9, 30))
    expect(bucketEndChartTime(t, '60', 'rth')).toBe(toChartTime(et(2026, 10, 30, 10, 30)))
    expect(bucketEndChartTime(toChartTime(et(2026, 10, 30, 9, 0)), '60', 'eth')).toBe(toChartTime(et(2026, 10, 30, 10, 0)))
    expect(bucketEndChartTime(t, '5', 'rth')).toBe(t + 300)
    expect(computeBarTime('60', et(2026, 11, 2, 9, 45), { session: 'eth' })).toBe(toChartTime(et(2026, 11, 2, 9, 0)))
    expect(computeBarTime('60', et(2026, 11, 2, 9, 45), { session: 'rth' })).toBe(toChartTime(et(2026, 11, 2, 9, 30)))
  })
})
