// The spoken timeframe for accessible names ("NVDA daily price chart"), derived from parseTf.
// A /charts layout holds several panes of one symbol; without the timeframe their chart regions
// share one name (axe landmark-unique).
import { test, expect } from 'vitest'
import { tfSpokenLabel, NATIVE_TFS, tfLabel } from './timeframes'

test('every native timeframe has a distinct spoken form', () => {
  expect(NATIVE_TFS.map(tfSpokenLabel)).toEqual(
    ['1-minute', '5-minute', '15-minute', '30-minute', '1-hour', 'daily', 'weekly', 'monthly'])
})

test('custom codes follow the same authority as tfLabel', () => {
  expect(tfSpokenLabel('240')).toBe('4-hour')
  expect(tfSpokenLabel('45')).toBe('45-minute')
  expect(tfSpokenLabel('2D')).toBe('2-day')
  expect(tfSpokenLabel('3M')).toBe('3-month')
  expect(tfSpokenLabel('2W')).toBe('2-week')
  // 1-minute and 1-month never read alike, spoken or shown
  expect(tfSpokenLabel('1')).not.toBe(tfSpokenLabel('M'))
  expect(tfLabel('1')).not.toBe(tfLabel('M'))
})

test('an unparseable code is passed through, never "NaN-minute"', () => {
  expect(tfSpokenLabel('weird')).toBe('weird')
})
