// app/src/pages/dashboard/useSessionState.test.js
//
// ⛔ TZ TRAP: `resolveSession` converts its input to America/New_York before
// reading day/hour. Every fixture below is built via `et()`, which bakes an
// explicit `GMT-0400` (EDT) offset into the string handed to `new Date(...)`
// — so the instant each test asserts against is fixed regardless of the
// machine's own local timezone. `resolveSession` then re-derives ET from
// that instant the same way `useMarketOpen.js` already does (toLocaleString
// → re-parse), which is itself TZ-independent by construction: the output
// string names New York's wall-clock time no matter where the process runs,
// and reading day/hour back off the re-parsed Date returns those same
// NY-local numbers regardless of the host TZ. This file was executed under
// TZ=UTC, TZ=America/Los_Angeles, and TZ=Asia/Tokyo (see task report) to
// confirm no fixture is TZ-load-bearing.
import { test, expect } from 'vitest'
import { resolveSession, nextBoundary, resolveBoundary, formatCountdown } from './useSessionState'

const et = (s) => new Date(`${s} GMT-0400`)   // EDT

test('weekend', () => {
  expect(resolveSession(et('2026-08-29 11:00'))).toBe('WEEKEND')  // Sat
  expect(resolveSession(et('2026-08-30 11:00'))).toBe('WEEKEND')  // Sun
})
test('premarket', () => {
  expect(resolveSession(et('2026-08-28 07:30'))).toBe('PREMARKET')
})
test('live', () => {
  expect(resolveSession(et('2026-08-28 11:00'))).toBe('LIVE')
})
test('closed weekday', () => {
  expect(resolveSession(et('2026-08-28 18:00'))).toBe('CLOSED')
  expect(resolveSession(et('2026-08-28 03:00'))).toBe('CLOSED')
})

// Boundary edges — the four states must partition the day with no gap and
// no overlap. Exercises the exact minute each threshold flips.
test('boundaries are exact — no gap, no overlap', () => {
  expect(resolveSession(et('2026-08-28 03:59'))).toBe('CLOSED')
  expect(resolveSession(et('2026-08-28 04:00'))).toBe('PREMARKET')
  expect(resolveSession(et('2026-08-28 09:29'))).toBe('PREMARKET')
  expect(resolveSession(et('2026-08-28 09:30'))).toBe('LIVE')
  expect(resolveSession(et('2026-08-28 15:59'))).toBe('LIVE')
  expect(resolveSession(et('2026-08-28 16:00'))).toBe('CLOSED')
})

test('resolveSession defaults to "now" when called with no argument', () => {
  expect(['PREMARKET', 'LIVE', 'CLOSED', 'WEEKEND']).toContain(resolveSession())
})

// ─── nextBoundary — Zone A's countdown ──────────────────────────────────────
//
// ⛔ SAME `et()` FIXTURES, SAME TZ ARGUMENT as above: the offset is baked in,
// so these assertions are independent of the host timezone.

const minsUntil = (d) => Math.round(nextBoundary(d).ms / 60_000)

test('nextBoundary: before the open on a weekday counts down to the OPEN', () => {
  // 07:30 → 09:30 is 120 minutes.
  expect(nextBoundary(et('2026-08-28 07:30'))).toEqual({ kind: 'open', ms: 120 * 60_000 })
  // …and so does the 00:00-04:00 CLOSED window, which is still "before today's open".
  expect(nextBoundary(et('2026-08-28 03:00')).kind).toBe('open')
  expect(minsUntil(et('2026-08-28 03:00'))).toBe(390)
})

test('nextBoundary: during the session counts down to the CLOSE', () => {
  expect(nextBoundary(et('2026-08-28 11:00'))).toEqual({ kind: 'close', ms: 300 * 60_000 })
})

test('nextBoundary: after the close counts down to the NEXT weekday open', () => {
  // Thu 18:00 → Fri 09:30 = 15h30m = 930 minutes.
  expect(nextBoundary(et('2026-08-27 18:00')).kind).toBe('open')
  expect(minsUntil(et('2026-08-27 18:00'))).toBe(930)
})

test('nextBoundary: Friday evening skips the weekend to the MONDAY open', () => {
  // Fri 2026-08-28 18:00 → Mon 2026-08-31 09:30 = 3 days − 8h30m = 3810 minutes.
  expect(minsUntil(et('2026-08-28 18:00'))).toBe(3810)
})

test('nextBoundary: Saturday and Sunday both target the Monday open', () => {
  // Sat 11:00 → Mon 09:30 = 2 days − 1h30m = 2790 min.
  expect(minsUntil(et('2026-08-29 11:00'))).toBe(2790)
  // Sun 11:00 → Mon 09:30 = 1 day − 1h30m = 1350 min.
  expect(minsUntil(et('2026-08-30 11:00'))).toBe(1350)
  expect(nextBoundary(et('2026-08-30 11:00')).kind).toBe('open')
})

test('nextBoundary: it is never negative and never zero-length in the past', () => {
  // The control on the day-arithmetic above: a wrong `daysAhead` for any
  // weekday would show up as a negative or absurd span somewhere in the week.
  for (const d of ['2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27',
                   '2026-08-28', '2026-08-29', '2026-08-30']) {
    for (const t of ['00:05', '05:00', '10:00', '15:59', '16:00', '23:55']) {
      const ms = nextBoundary(et(`${d} ${t}`)).ms
      expect(ms, `${d} ${t}`).toBeGreaterThan(0)
      // Nothing is ever more than a long weekend away (Fri 09:31 → Mon 09:30).
      expect(ms, `${d} ${t}`).toBeLessThanOrEqual(4 * 1440 * 60_000)
    }
  }
})

test('nextBoundary defaults to "now" when called with no argument', () => {
  const b = nextBoundary()
  expect(['open', 'close']).toContain(b.kind)
  expect(b.ms).toBeGreaterThan(0)
})

test('formatCountdown is compact enough for a 120px zone', () => {
  expect(formatCountdown(14 * 60_000)).toBe('14m')
  expect(formatCountdown((2 * 60 + 14) * 60_000)).toBe('2h 14m')
  expect(formatCountdown((2 * 1440 + 17 * 60) * 60_000)).toBe('2d 17h')
  // A boundary in the past or an unusable input reads "now", never NaN.
  expect(formatCountdown(0)).toBe('now')
  expect(formatCountdown(-5)).toBe('now')
  expect(formatCountdown(undefined)).toBe('now')
})

// ─── nextBoundary vs MARKET HOLIDAYS ────────────────────────────────────────
//
// 🔴 THE DEFECT THESE COVER. `nextBoundary` knew weekends and clock hours and
// nothing else, so on Thanksgiving the paid home counted down — to the minute
// — to an open that would not happen. The closure list is NOT typed here or in
// the component: it is served from `bars_fetch._NYSE_HOLIDAYS_YYYYMMDD` via
// `GET /api/market-calendar` and arrives as a parameter, so these fixtures
// pass a Set the way the hook does.
//
// ⛔ SECOND TZ TRAP, AND IT IS NOT THE ONE ABOVE. `et()` bakes GMT-0400 (EDT),
// which is correct for the August fixtures and WRONG for November/December —
// US DST ended 2026-11-01, so those dates are EST (GMT-0500) and an EDT offset
// would silently shift every fixture an hour earlier in ET, moving 07:00 to
// 06:00 and quietly changing what is being asserted. `est()` is the winter
// twin; the offset is baked in, so both remain host-TZ-independent.
const est = (s) => new Date(`${s} GMT-0500`)   // EST

// The two 2026 dates read off `_NYSE_HOLIDAYS_YYYYMMDD` (20261126, 20261225).
const THANKSGIVING = '2026-11-26'   // Thursday
const CHRISTMAS = '2026-12-25'      // Friday
const holidaySet = (...days) => new Set(days)

test('a holiday weekday counts down to the NEXT session, not to a bell that will not ring', () => {
  // Thanksgiving 07:00 ET. Holiday-blind, this is "Opens in 2h 30m" — the lie.
  expect(nextBoundary(est(`${THANKSGIVING} 07:00`)).ms).toBe(150 * 60_000)
  // Knowing the closure, the next open is Friday 09:30: 1 day + 09:30 − 07:00.
  expect(nextBoundary(est(`${THANKSGIVING} 07:00`), holidaySet(THANKSGIVING)))
    .toEqual({ kind: 'open', ms: (1440 + 570 - 420) * 60_000 })
})

test('MID-holiday it never claims a session is running', () => {
  // 11:00 on Thanksgiving. Holiday-blind this reads `close` — "the session
  // ends in 5h" — which is a wrong SENTENCE, not just a wrong number.
  expect(nextBoundary(est(`${THANKSGIVING} 11:00`)).kind).toBe('close')
  expect(nextBoundary(est(`${THANKSGIVING} 11:00`), holidaySet(THANKSGIVING)).kind).toBe('open')
})

test('a holiday that EXTENDS a weekend is walked all the way through', () => {
  // Christmas 2026 falls on a Friday. From Friday 11:00 the next open is the
  // following Monday 09:30 — the walk must cross a closure AND a weekend, the
  // case the old `day === 5 ? 3 : …` arithmetic could not express.
  const b = nextBoundary(est(`${CHRISTMAS} 11:00`), holidaySet(CHRISTMAS))
  expect(b.kind).toBe('open')
  expect(b.ms).toBe((3 * 1440 + 570 - 660) * 60_000)
})

test('a holiday MONDAY pushes the Friday-evening countdown out to Tuesday', () => {
  // Fri 2026-01-16 18:00 ET with Mon 2026-01-19 (MLK, in the table) closed →
  // Tue 2026-01-20 09:30. The whole shape the spec's WEEKEND row implies.
  const b = nextBoundary(est('2026-01-16 18:00'), holidaySet('2026-01-19'))
  expect(b.kind).toBe('open')
  expect(b.ms).toBe((4 * 1440 + 570 - 1080) * 60_000)
})

test('CONTROL: with no calendar the answers are byte-identical to the old arithmetic', () => {
  // Without this every assertion above is satisfied by a function that simply
  // pushes every answer out by a day. Sweeps the same week the pre-existing
  // suite pins and asserts the holiday-aware walk did not move any of it.
  const expected = { '2026-08-24': 1, '2026-08-25': 1, '2026-08-26': 1, '2026-08-27': 1,
                     '2026-08-28': 3, '2026-08-29': 2, '2026-08-30': 1 }
  for (const [d, daysAhead] of Object.entries(expected)) {
    const mins = d === '2026-08-29' || d === '2026-08-30' ? 660 : 1080
    const at = d === '2026-08-29' || d === '2026-08-30' ? '11:00' : '18:00'
    expect(nextBoundary(et(`${d} ${at}`)).ms, d)
      .toBe((daysAhead * 1440 + 570 - mins) * 60_000)
    // …and passing an EMPTY calendar changes nothing either.
    expect(nextBoundary(et(`${d} ${at}`), new Set()).ms, d)
      .toBe((daysAhead * 1440 + 570 - mins) * 60_000)
  }
})

// ─── resolveBoundary — the day the answer landed on ─────────────────────────
//
// ⭐ `dayKey` is what lets the caller ask "is this inside the table I was
// served?" WITHOUT re-walking the calendar itself. A second walk would be a
// second authority over one question.
test('resolveBoundary reports the ET day the boundary falls on', () => {
  expect(resolveBoundary(et('2026-08-28 07:30')).dayKey).toBe('2026-08-28')   // today's open
  expect(resolveBoundary(et('2026-08-28 11:00')).dayKey).toBe('2026-08-28')   // today's close
  expect(resolveBoundary(et('2026-08-28 18:00')).dayKey).toBe('2026-08-31')   // Monday's open
  expect(resolveBoundary(est(`${THANKSGIVING} 07:00`), holidaySet(THANKSGIVING)).dayKey)
    .toBe('2026-11-27')
})

test('resolveBoundary refuses rather than looping when nothing opens within the walk', () => {
  // A fortnight of closures is not a real calendar — it is the shape of a
  // corrupt or hostile payload. `ms: null` + `dayKey: null` is the honest
  // answer, and the hook turns it into "no countdown" rather than a number.
  const fortnight = new Set()
  for (let i = 0; i < 31; i += 1) {
    const d = new Date(Date.UTC(2026, 7, 24 + i))
    fortnight.add(d.toISOString().slice(0, 10))
  }
  const b = resolveBoundary(et('2026-08-24 18:00'), fortnight)
  expect(b.ms).toBeNull()
  expect(b.dayKey).toBeNull()
})
