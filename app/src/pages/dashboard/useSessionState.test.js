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
import { resolveSession } from './useSessionState'

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
