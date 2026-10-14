import { expect, test } from 'vitest'
import { closeLabel, sessionsSince, isStaleSnapshot, earningsText } from '../dates'

// 2026-10-14 is a Wednesday; ET is UTC-4 in October.
const at = (iso, hhmm) => Date.parse(`${iso}T${hhmm}:00-04:00`)

test('closeLabel', () => {
  expect(closeLabel('2026-10-12')).toBe('Oct 12 close')
  expect(closeLabel('nope')).toBeNull()
})
test('P7: one session behind is normal, two is stale', () => {
  // Tue's snapshot on Wed morning: only Tue's own close has passed since -> 0 sessions after it
  expect(sessionsSince('2026-10-13', at('2026-10-14', '09:00'))).toBe(0)
  // Tue's snapshot after Wed's close: one session (Wed) closed since -> not stale
  expect(sessionsSince('2026-10-13', at('2026-10-14', '17:00'))).toBe(1)
  expect(isStaleSnapshot('2026-10-13', at('2026-10-14', '17:00'))).toBe(false)
  // Mon's snapshot after Wed's close: Tue and Wed closed since -> stale
  expect(isStaleSnapshot('2026-10-12', at('2026-10-14', '17:00'))).toBe(true)
})
test('P7: a weekend is not two sessions', () => {
  // Friday's snapshot read on Monday morning: no session has closed since
  expect(isStaleSnapshot('2026-10-09', at('2026-10-12', '08:00'))).toBe(false)
  expect(sessionsSince('2026-10-09', at('2026-10-12', '08:00'))).toBe(0)
})
test('P7: a holiday is not a session (Thanksgiving 2026-11-26)', () => {
  // Wed 11/25 snapshot, read Fri 11/27 after its (early) close: only Friday closed since
  expect(sessionsSince('2026-11-25', at('2026-11-27', '17:00'))).toBe(1)
  expect(isStaleSnapshot('2026-11-25', at('2026-11-27', '17:00'))).toBe(false)
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
