/**
 * NEXT-ROW KEY TASK HELPERS, ITEM (1): THE ET WALL CLOCK WITHOUT A FORMATTER PER CALL (2026-11-23).
 *
 * A next-row press spent ~3 ms (profiled) in marketSession's ET helpers (expectedLatestDailySessionET,
 * expectedDailyTailForPaintET, _etDateOfUnix, classifyIntradayTail): each re-parsed
 * `new Date(ms).toLocaleString('en-US', { timeZone: 'America/New_York' })`, and `toLocaleString` with a timeZone builds
 * a date formatter on every call. They now share `etWall.etWallDate`.
 *   W1 etWallDate(ms) is the SAME instant as the re-parse (so every getter reads the same), for every minute across the
 *      2026 and 2027 US DST changes, the 2026 European and Australian ones, whole ET days (midnight, Saturday, Sunday,
 *      Thanksgiving, the early close after it, year end), and 2,000 seeded random instants, in FIVE process time zones
 *      (UTC, New York, Chicago, London, Sydney: a re-parsed wall time that falls in the LOCAL zone's own DST gap or
 *      overlap is resolved by the local zone, and must stay so); NaN and a Date argument too
 *   W2 the exported helpers return exactly what they returned before (verbatim copies below), on the same instants
 *   W3 none of them calls toLocaleString any more (red before the change)
 */
import { describe, it, expect, afterAll, vi } from 'vitest'
import { etWallDate } from './etWall'
import {
  expectedLatestDailySessionET, expectedDailyTailForPaintET, isDailyTodayCloseProvisionalForPaint,
  isDailyTodayBarStaleForPaint, isTradingSessionTodayET, classifyIntradayTail,
} from './marketSession'
import { hasCoverage, holidayOn, earlyCloseOn } from '../lib/marketClock/nyseCalendar'

// ── the reference: marketSession.js as it was (8d50b2813f), verbatim but for the names ──────────────────────────────
const reparse = (ms) => new Date(new Date(ms).toLocaleString('en-US', { timeZone: 'America/New_York' }))
const _pad = (n) => String(n).padStart(2, '0')
function _isoOfET(d) { return `${d.getFullYear()}-${_pad(d.getMonth() + 1)}-${_pad(d.getDate())}` }
function _isNonTradingDayET(d) {
  const dow = d.getDay()
  if (dow === 0 || dow === 6) return true
  const iso = _isoOfET(d)
  return hasCoverage(d.getFullYear()) && !!holidayOn(iso)
}
function _effectiveCloseMinutesET(d) {
  if (!hasCoverage(d.getFullYear())) return 960
  const earlyClose = earlyCloseOn(_isoOfET(d))
  return earlyClose ? earlyClose.closeHour * 60 + earlyClose.closeMinute : 960
}
function refExpectedLatestDailySessionET(nowMs = Date.now()) {
  const nowET = new Date(new Date(nowMs).toLocaleString('en-US', { timeZone: 'America/New_York' }))
  const dow = nowET.getDay()
  const mins = nowET.getHours() * 60 + nowET.getMinutes()
  const d = new Date(nowET)
  const isTradingDayToday = dow >= 1 && dow <= 5 && !_isNonTradingDayET(nowET)
  const closeThresholdMin = _effectiveCloseMinutesET(nowET)
  if (!(isTradingDayToday && mins >= closeThresholdMin)) {
    do { d.setDate(d.getDate() - 1) } while (_isNonTradingDayET(d))
  }
  return _isoOfET(d)
}
function refExpectedDailyTailForPaintET(nowMs = Date.now()) {
  const nowET = new Date(new Date(nowMs).toLocaleString('en-US', { timeZone: 'America/New_York' }))
  const dow = nowET.getDay()
  const mins = nowET.getHours() * 60 + nowET.getMinutes()
  if (dow >= 1 && dow <= 5 && mins >= 570 && mins < _effectiveCloseMinutesET(nowET)) {
    const p = (n) => String(n).padStart(2, '0')
    return `${nowET.getFullYear()}-${p(nowET.getMonth() + 1)}-${p(nowET.getDate())}`
  }
  return refExpectedLatestDailySessionET(nowMs)
}
const DAILY_CLOSE_SETTLE_MS = 5 * 60_000
function refIsDailyTodayCloseProvisionalForPaint(isoTail, savedAtMs = null, nowMs = Date.now()) {
  if (typeof isoTail !== 'string' || !isoTail) return false
  const nowET = new Date(new Date(nowMs).toLocaleString('en-US', { timeZone: 'America/New_York' }))
  const dow = nowET.getDay()
  const mins = nowET.getHours() * 60 + nowET.getMinutes()
  const closeMin = _effectiveCloseMinutesET(nowET)
  if (!(dow >= 1 && dow <= 5 && mins >= closeMin)) return false
  const todayISO = _isoOfET(nowET)
  if (isoTail.slice(0, 10) !== todayISO) return false
  if (Number.isFinite(savedAtMs) && savedAtMs > 0) {
    const savedET = new Date(new Date(savedAtMs - DAILY_CLOSE_SETTLE_MS).toLocaleString('en-US', { timeZone: 'America/New_York' }))
    const savedMins = savedET.getHours() * 60 + savedET.getMinutes()
    if (_isoOfET(savedET) === todayISO && savedMins >= closeMin) return false
  }
  return true
}
const DAILY_TODAY_MAX_AGE_MS = 90_000
function refIsDailyTodayBarStaleForPaint(isoTail, savedAtMs, nowMs = Date.now()) {
  if (typeof isoTail !== 'string' || isoTail.length < 10) return false
  const nowET = new Date(new Date(nowMs).toLocaleString('en-US', { timeZone: 'America/New_York' }))
  const dow = nowET.getDay()
  const mins = nowET.getHours() * 60 + nowET.getMinutes()
  if (!(dow >= 1 && dow <= 5 && mins >= 570 && mins < _effectiveCloseMinutesET(nowET))) return false
  if (isoTail.slice(0, 10) !== _isoOfET(nowET)) return false
  if (!Number.isFinite(savedAtMs) || savedAtMs <= 0) return true
  return (nowMs - savedAtMs) > DAILY_TODAY_MAX_AGE_MS
}

// ── the instants ──────────────────────────────────────────────────────────────────────────────────────────────────
const MIN = 60_000
const H = 60 * MIN
const everyMinuteAround = (iso, hours = 3) => {
  const c = Date.parse(iso)
  const out = []
  for (let t = c - hours * H; t <= c + hours * H; t += MIN) out.push(t)
  return out
}
const everyQuarterOfEtDays = (fromIso, days) => {
  const s = Date.parse(fromIso)            // a UTC instant a few hours before the ET midnight it is meant for
  const out = []
  for (let t = s; t < s + days * 24 * H; t += 15 * MIN) out.push(t)
  return out
}
function seeded(n, seed = 20261123) {
  let s = seed
  const lo = Date.UTC(2024, 0, 1), hi = Date.UTC(2028, 11, 31)
  const out = []
  for (let i = 0; i < n; i++) {
    s = (s * 1103515245 + 12345) % 2147483648
    const r = s / 2147483648
    s = (s * 1103515245 + 12345) % 2147483648
    out.push(Math.floor(lo + r * (hi - lo)) + (s % 1000))   // with milliseconds
  }
  return out
}
const INSTANTS = [
  ...everyMinuteAround('2026-03-08T07:00:00Z'),   // US spring forward 2026 (02:00 EST -> 03:00 EDT)
  ...everyMinuteAround('2026-11-01T06:00:00Z'),   // US fall back 2026 (02:00 EDT -> 01:00 EST)
  ...everyMinuteAround('2027-03-14T07:00:00Z'),   // US spring forward 2027
  ...everyMinuteAround('2026-03-29T01:00:00Z'),   // Europe/London forward (a local gap)
  ...everyMinuteAround('2026-10-25T01:00:00Z'),   // Europe/London back (a local overlap)
  ...everyMinuteAround('2026-04-04T16:00:00Z'),   // Australia/Sydney back
  ...everyMinuteAround('2026-10-03T16:00:00Z'),   // Australia/Sydney forward
  ...everyQuarterOfEtDays('2026-11-21T03:00:00Z', 2),   // Saturday, Sunday (ET), midnights
  ...everyQuarterOfEtDays('2026-11-26T03:00:00Z', 2),   // Thanksgiving, and the 13:00 early close after it
  ...everyQuarterOfEtDays('2026-12-31T03:00:00Z', 2),   // year end
  ...seeded(2000),
]
const ZONES = ['UTC', 'America/New_York', 'America/Chicago', 'Europe/London', 'Australia/Sydney']
const TZ0 = process.env.TZ
const inZone = (tz, fn) => { process.env.TZ = tz; try { fn() } finally { process.env.TZ = TZ0 } }
afterAll(() => { process.env.TZ = TZ0 })
const same = (a, b) => (Number.isNaN(a) && Number.isNaN(b)) || a === b

describe('etWallDate is the re-parse, instant for instant', () => {
  it('W1 every instant, in five process time zones (and NaN, and a Date argument)', () => {
    let checked = 0
    for (const tz of ZONES) {
      inZone(tz, () => {
        // the zone took (or this proves nothing for it)
        expect(new Date(Date.UTC(2026, 6, 1, 12)).getTimezoneOffset()).toBe({ UTC: 0, 'America/New_York': 240, 'America/Chicago': 300, 'Europe/London': -60, 'Australia/Sydney': -600 }[tz])
        for (const t of INSTANTS) {
          const a = etWallDate(t).getTime()
          const b = reparse(t).getTime()
          if (!same(a, b)) expect({ tz, t, got: a }).toEqual({ tz, t, got: b })
          checked += 1
        }
        expect(Number.isNaN(etWallDate(NaN).getTime())).toBe(true)
        const d = new Date(Date.UTC(2026, 10, 23, 18, 4, 5, 678))
        expect(etWallDate(d).getTime()).toBe(reparse(d).getTime())
      })
    }
    expect(checked).toBe(ZONES.length * INSTANTS.length)
  }, 120_000)
})

describe('the helpers return what they returned before', () => {
  it('W2 expectedLatestDailySessionET, expectedDailyTailForPaintET, the two today-bar paint gates, isTradingSessionTodayET', () => {
    for (const tz of ['UTC', 'Europe/London']) {
      inZone(tz, () => {
        for (let i = 0; i < INSTANTS.length; i++) {
          const t = INSTANTS[i]
          expect(expectedLatestDailySessionET(t)).toBe(refExpectedLatestDailySessionET(t))
          expect(expectedDailyTailForPaintET(t)).toBe(refExpectedDailyTailForPaintET(t))
          if (i % 3) continue                       // the two paint gates on every third instant (still every hour of each sweep)
          const today = refExpectedDailyTailForPaintET(t)
          for (const iso of [today, refExpectedLatestDailySessionET(t), '2026-11-27']) {
            for (const saved of [null, t - 30_000, t - 3 * H, t - 26 * H]) {
              expect(isDailyTodayCloseProvisionalForPaint(iso, saved, t)).toBe(refIsDailyTodayCloseProvisionalForPaint(iso, saved, t))
              expect(isDailyTodayBarStaleForPaint(iso, saved, t)).toBe(refIsDailyTodayBarStaleForPaint(iso, saved, t))
            }
          }
        }
      })
    }
    // the instants cover every answer the gates give (or this proves little)
    const seen = new Set(INSTANTS.map((t) => refIsDailyTodayCloseProvisionalForPaint(refExpectedDailyTailForPaintET(t), null, t)))
    expect(seen.size).toBe(2)
    // isTradingSessionTodayET reads the clock
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      for (const t of INSTANTS.filter((_, i) => i % 7 === 0)) {
        vi.setSystemTime(t)
        expect(isTradingSessionTodayET()).toBe(!_isNonTradingDayET(reparse(t)))
      }
    } finally { vi.useRealTimers() }
  }, 120_000)
})

describe('no formatter per call', () => {
  it('W3 none of the helpers calls toLocaleString', () => {
    const spy = vi.spyOn(Date.prototype, 'toLocaleString')
    let n = -1
    try {
      const t0 = Date.UTC(2026, 10, 23, 23, 30)
      for (let i = 0; i < 200; i++) {
        const t = t0 + i * 61_000
        expectedLatestDailySessionET(t)
        expectedDailyTailForPaintET(t)
        isDailyTodayCloseProvisionalForPaint('2026-11-23', t - 60_000, t)
        isDailyTodayBarStaleForPaint('2026-11-23', t - 60_000, t)
        classifyIntradayTail(Math.floor(t / 1000) - 3600, '5')
        etWallDate(t)
      }
      n = spy.mock.calls.length          // read BEFORE mockRestore, which resets it
    } finally { spy.mockRestore() }
    expect(n).toBe(0)
  })
  it('W3 control: the spy counts a call', () => {
    const spy = vi.spyOn(Date.prototype, 'toLocaleString')
    let n = -1
    try { new Date().toLocaleString('en-US'); n = spy.mock.calls.length } finally { spy.mockRestore() }
    expect(n).toBe(1)
  })
})
