// app/src/pages/calendar/weekAnchor.test.js
//
// The week anchor, on both of its axes.
//
//   Axis 1 — DAY OF WEEK: which week does "now" belong to? The frontend and
//            the backend used to answer differently on Sat/Sun (7 days apart).
//            The cross-language proof that they now agree lives in
//            `tests/test_calendar_week_anchor.py`, which EXECUTES BOTH
//            implementations; this file pins the JS side's own behaviour and,
//            critically, the BOUNDARY where the answer turns over.
//
//   Axis 2 — TIMEZONE: `toISOString()` on a local-midnight Date returns the
//            UTC day, which is the PREVIOUS day for every browser east of UTC.
//            Every test here that touches a rendered date runs a second time
//            pinned to Asia/Tokyo, with a control assertion proving the pin
//            actually took (a TZ test that silently ran in CDT would pass
//            without exercising anything).
//
// Both axes are pure functions of a STRING — no clock is read, so nothing here
// can inherit the day the suite happens to run on. That is deliberate: the
// clock is read exactly once, by the caller, and handed in.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { localIso, mondayOf, nextSessionDay, currentWeekMonday } from './weekAnchor'
import { buildWeekDates } from './useCalendarData'
import { buildMonthGrid } from './monthGrid'

// ── The week under the microscope: Mon 2026-08-03 … Sun 2026-08-09 ──────────
// Chosen because it is the week the live defect was measured on (the report in
// .superpowers/sdd/audit/fix-clock3-report.md), so these literals are the same
// dates as the measurement.
const MON = '2026-08-03'
const TUE = '2026-08-04'
const WED = '2026-08-05'
const THU = '2026-08-06'
const FRI = '2026-08-07'
const SAT = '2026-08-08'
const SUN = '2026-08-09'
const NEXT_MON = '2026-08-10'

const WEEKDAYS = [MON, TUE, WED, THU, FRI]
const WEEKEND = [SAT, SUN]

// ── TZ harness ───────────────────────────────────────────────────────────────
// Node re-reads process.env.TZ on every Date operation (verified on this
// box/runtime), so a mutation moves the local zone for real — including for
// Date objects created BEFORE the change. Restored in a `finally` AND in an
// afterEach, because a leaked TZ would silently corrupt every later file in
// this fork.
const ENV = globalThis.process.env      // via globalThis: `process` is not an eslint global here
const _REAL_TZ = ENV.TZ
afterEach(() => {
  if (_REAL_TZ === undefined) delete ENV.TZ
  else ENV.TZ = _REAL_TZ
})

function withTz(tz, fn) {
  const prev = ENV.TZ
  ENV.TZ = tz
  try {
    return fn()
  } finally {
    if (prev === undefined) delete ENV.TZ
    else ENV.TZ = prev
  }
}

// The control for every Asia/Tokyo block below: if the pin did NOT take, this
// reads '2026-08-10' and the test aborts instead of passing vacuously. It is
// also, precisely, the old bug — local midnight in a UTC+ zone is the previous
// day in UTC.
function assertEastOfUtc() {
  expect(new Date('2026-08-10T00:00:00').toISOString().slice(0, 10)).toBe('2026-08-09')
}

describe('currentWeekMonday — which week the calendar is SHOWING', () => {
  it('is this Monday on every weekday', () => {
    for (const d of WEEKDAYS) expect(currentWeekMonday(d)).toBe(MON)
  })

  it('rolls FORWARD to the upcoming Monday on Saturday and Sunday', () => {
    // The product decision, stated as an assertion: the week just past is over,
    // so a member opening the calendar on a weekend sees the week about to
    // start. This is what the backend has always done.
    for (const d of WEEKEND) expect(currentWeekMonday(d)).toBe(NEXT_MON)
  })

  // ⭐ THE BOUNDARY. Sixty seconds of calendar time apart — the last weekday
  // and the first weekend day — and the answer must INVERT. A rule that had
  // collapsed into a constant (or been "fixed" by deleting the weekend case)
  // answers the same thing on both sides and dies here.
  it('inverts across the Fri→Sat boundary, and NOT across Sun→Mon', () => {
    expect(currentWeekMonday(FRI)).toBe(MON)
    expect(currentWeekMonday(SAT)).toBe(NEXT_MON)
    expect(currentWeekMonday(FRI)).not.toBe(currentWeekMonday(SAT))

    // The old (wrong) rule turned over at Sunday midnight instead. Under the
    // correct rule Sunday and Monday are the SAME week, so a test asserting a
    // flip there would be asserting the bug.
    expect(currentWeekMonday(SUN)).toBe(currentWeekMonday(NEXT_MON))
  })

  it('is not a constant — seven days produce exactly two distinct weeks', () => {
    // Guards the whole file against a stubbed/short-circuited implementation:
    // every assertion above is satisfiable by returning one fixed string only
    // if this fails.
    const answers = new Set([...WEEKDAYS, ...WEEKEND].map(currentWeekMonday))
    expect([...answers].sort()).toEqual([MON, NEXT_MON])
  })

  it('returns null for a calendar-invalid date instead of crashing the render', () => {
    expect(currentWeekMonday('2026-13-05')).toBeNull()
    expect(currentWeekMonday('nonsense')).toBeNull()
  })

  it('survives both US DST transitions (noon-anchored date math)', () => {
    // Spring forward 2026-03-08 and fall back 2026-11-01 are both SUNDAYS, so
    // both land on the rolling branch — the one that ADDS days. The Saturday
    // before each one is the sharpest case: its +2 day roll SPANS the
    // transition, which is exactly where a midnight-anchored implementation
    // (23:00 + 25h, or 01:00 − 1h) lands on the wrong calendar day. Noon
    // anchoring is what makes these hold.
    expect(currentWeekMonday('2026-03-07')).toBe('2026-03-09')   // Sat, +2 over spring-forward
    expect(currentWeekMonday('2026-03-08')).toBe('2026-03-09')   // Sun, +1 on the day itself
    expect(currentWeekMonday('2026-03-09')).toBe('2026-03-09')   // Mon after
    expect(currentWeekMonday('2026-10-31')).toBe('2026-11-02')   // Sat, +2 over fall-back
    expect(currentWeekMonday('2026-11-01')).toBe('2026-11-02')   // Sun, +1 on the day itself
    expect(currentWeekMonday('2026-11-02')).toBe('2026-11-02')   // Mon after
    // …and the containing-week question still snaps BACK across the same edges.
    expect(mondayOf('2026-03-08')).toBe('2026-03-02')
    expect(mondayOf('2026-11-01')).toBe('2026-10-26')
  })

  it('answers the same in a UTC+9 browser as in a UTC-5 one', () => {
    const here = [...WEEKDAYS, ...WEEKEND].map(currentWeekMonday)
    const tokyo = withTz('Asia/Tokyo', () => {
      assertEastOfUtc()
      return [...WEEKDAYS, ...WEEKEND].map(currentWeekMonday)
    })
    expect(tokyo).toEqual(here)
  })
})

describe('mondayOf — which week CONTAINS a date (a different question)', () => {
  it('agrees with the anchor Mon–Fri and disagrees on the weekend', () => {
    // Kept deliberately distinct. `mondayOf` is what normalizes a `?week=` URL
    // param and a payload day — and the backend's `_monday_of` snaps back the
    // same way, so a deep link resolves identically on both sides. Swapping one
    // for the other is the bug this whole commit is about, so the difference is
    // asserted rather than left to a comment.
    for (const d of WEEKDAYS) expect(mondayOf(d)).toBe(currentWeekMonday(d))
    for (const d of WEEKEND) {
      expect(mondayOf(d)).toBe(MON)
      expect(mondayOf(d)).not.toBe(currentWeekMonday(d))
    }
  })

  it('nextSessionDay is the identity on weekdays and lands on Monday from a weekend', () => {
    for (const d of WEEKDAYS) expect(nextSessionDay(d)).toBe(d)
    for (const d of WEEKEND) expect(nextSessionDay(d)).toBe(NEXT_MON)
  })
})

describe('rendered dates do not shift for a browser east of UTC', () => {
  const WEEK = [NEXT_MON, '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14']

  it('buildWeekDates emits the intended Mon–Fri here', () => {
    expect(buildWeekDates(NEXT_MON)).toEqual(WEEK)
  })

  it('buildWeekDates emits the SAME Mon–Fri in Asia/Tokyo', () => {
    // Pre-fix this returned ['2026-08-09' … '2026-08-13'] — every date one day
    // early, Monday rendered as a Sunday, and Friday's reporters dropped off
    // the end because `days` iterates exactly this array.
    withTz('Asia/Tokyo', () => {
      assertEastOfUtc()
      expect(buildWeekDates(NEXT_MON)).toEqual(WEEK)
    })
  })

  it('localIso reads local calendar parts, never the UTC day', () => {
    withTz('Asia/Tokyo', () => {
      assertEastOfUtc()
      const midnight = new Date('2026-08-10T00:00:00')
      expect(localIso(midnight)).toBe('2026-08-10')
      expect(midnight.toISOString().slice(0, 10)).toBe('2026-08-09')  // the trap
    })
  })

  it('buildMonthGrid marks the LOCAL today, not the UTC one', () => {
    // `_makeCell` derives every cell's `ds` from local parts, so a UTC-derived
    // `todayStr` disagreed with all of them east of UTC: `isToday` highlighted
    // the PREVIOUS day's cell (or none, on the 1st of a month).
    //
    // ⚠️ The instant is PINNED, and that is load-bearing. An unpinned version of
    // this test is vacuous for most of the day: whenever the Tokyo date and the
    // UTC date happen to coincide there is nothing to get wrong, and it was
    // measured green against the reintroduced bug for exactly that reason.
    // 16:00Z is past Tokyo midnight and before UTC midnight, so the two dates
    // genuinely differ — and BOTH are weekdays inside this grid, so a wrong
    // `todayStr` marks a real, WRONG cell rather than silently marking nothing.
    vi.setSystemTime(new Date('2026-08-12T16:00:00Z'))   // Wed 12th UTC / Thu 13th JST
    try {
      withTz('Asia/Tokyo', () => {
        assertEastOfUtc()
        const localToday = localIso(new Date())
        const utcToday = new Date().toISOString().slice(0, 10)
        // The control: if these two ever coincide, everything below passes for
        // free and proves nothing.
        expect(localToday).toBe('2026-08-13')
        expect(utcToday).toBe('2026-08-12')

        const cells = buildMonthGrid(2026, 8, {}, []).flat()
        const all = cells.map(c => c.ds)
        expect(all).toContain(localToday)
        expect(all).toContain(utcToday)          // the wrong answer IS reachable

        expect(cells.filter(c => c.isToday).map(c => c.ds)).toEqual([localToday])
      })
    } finally {
      vi.useRealTimers()
    }
  })
})
