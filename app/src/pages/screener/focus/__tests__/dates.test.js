import { expect, test } from 'vitest'
import { closeLabel, describedSession, sessionCloseLabel, sessionsMissed, isStaleSnapshot, earningsText } from '../dates'

// 2026-10-14 is a Wednesday; ET is UTC-4 in October.
const at = (iso, hhmm) => Date.parse(`${iso}T${hhmm}:00-04:00`)

test('closeLabel', () => {
  expect(closeLabel('2026-10-12')).toBe('Oct 12 close')
  expect(closeLabel('nope')).toBeNull()
})
// Stamps below are BUILD dates, as the server sends them: snapshot_builder stamps date.today()
// at the 03:00 ET nightly, so a Wednesday stamp describes Tuesday's close.
test('P7: a build-date stamp names the session it describes', () => {
  expect(describedSession('2026-10-14')).toBe('2026-10-13')           // Wed build -> Tue
  expect(describedSession('2026-10-12')).toBe('2026-10-09')           // Mon build -> Fri
  expect(describedSession('2026-10-11')).toBe('2026-10-09')           // Sun build -> Fri
  expect(describedSession('2026-11-27')).toBe('2026-11-25')           // Fri after Thanksgiving -> Wed
  expect(describedSession('2026-10-14', '20261012')).toBe('2026-10-12') // a row's own bars_asof wins
  expect(sessionCloseLabel('2026-10-14')).toBe('Oct 13 close')
  expect(sessionCloseLabel(null)).toBeNull()
})
test('P7: the normal nightly rhythm is never stale', () => {
  // Wed 10:00 with Wed's build (describes Tue): fresh
  expect(isStaleSnapshot('2026-10-14', at('2026-10-14', '10:00'))).toBe(false)
  // Wed 17:00, Wed's close has passed but its build is not due until Thu: still fresh
  expect(isStaleSnapshot('2026-10-14', at('2026-10-14', '17:00'))).toBe(false)
  // Thu 02:30, before the 03:00 build: still fresh
  expect(isStaleSnapshot('2026-10-14', at('2026-10-15', '02:30'))).toBe(false)
})
test('P7: one missed nightly is stale', () => {
  // Thu 10:00 still holding Wed's build: Wed's session should be in by now and is not
  expect(sessionsMissed('2026-10-14', at('2026-10-15', '10:00'))).toBe(1)
  expect(isStaleSnapshot('2026-10-14', at('2026-10-15', '10:00'))).toBe(true)
})
test('P7: a weekend is not a missed nightly', () => {
  // Mon 08:00 with Saturday's build (describes Fri): fresh
  expect(isStaleSnapshot('2026-10-10', at('2026-10-12', '08:00'))).toBe(false)
  // Mon 08:00 with Friday's build (describes Thu): Friday's session is missing -> stale
  expect(isStaleSnapshot('2026-10-09', at('2026-10-12', '08:00'))).toBe(true)
})
test('P7: a holiday is not a missed nightly (Thanksgiving 2026-11-26)', () => {
  // Fri 11/27 10:00 with Thu's build (describes Wed 11/25): Thu was a holiday -> fresh
  expect(isStaleSnapshot('2026-11-26', at('2026-11-27', '10:00'))).toBe(false)
})
test('P8: earnings reads a month-day and a countdown, amber within 7 days (ET)', () => {
  expect(earningsText('2026-11-18', at('2026-10-14', '10:00'))).toEqual({ text: 'Earnings Nov 18 (in 35d)', soon: false })
  expect(earningsText('2026-10-21', at('2026-10-14', '10:00'))).toEqual({ text: 'Earnings Oct 21 (in 7d)', soon: true })
  expect(earningsText('2026-10-14', at('2026-10-14', '10:00'))).toEqual({ text: 'Earnings Oct 14 (today)', soon: true })
  // 23:30 ET on the 14th is already the 15th in UTC: still "in 7d" to the 21st in ET
  expect(earningsText('2026-10-21', at('2026-10-14', '23:30')).text).toBe('Earnings Oct 21 (in 7d)')
  expect(earningsText('2026-10-01', at('2026-10-14', '10:00'))).toEqual({ text: 'Earnings Oct 1', soon: false })
  expect(earningsText(null)).toBeNull()
})
