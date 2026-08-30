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
import { resolveSession, nextBoundary, formatCountdown } from './useSessionState'

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
