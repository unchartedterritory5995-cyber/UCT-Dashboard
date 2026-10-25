// Day helpers for routine and tracker blocks (Notebook widgets phase 2, wave 9, Task 9.12).
import { describe, it, expect } from 'vitest'
import { noteDayOf, weekMonday, forDayLabel, toolSearchText, localTimeBeside } from './toolDays'
import { todayET } from '../calendar'

describe('noteDayOf', () => {
  it('noteDayOf_prefers_daily_date_then_created_et_day', () => {
    expect(noteDayOf({ dailyDate: '2026-10-20', createdAt: '2026-10-28T03:30:00Z' })).toBe('2026-10-20')
    // 03:30Z on the 28th is 23:30 on the 27th in New York: the UTC day would be a day late.
    expect(noteDayOf({ createdAt: '2026-10-28T03:30:00Z' })).toBe('2026-10-27')
    expect(noteDayOf({ dailyDate: null, createdAt: '2026-10-28T03:30:00Z' })).toBe('2026-10-27')
    expect(noteDayOf({ dailyDate: 'Tuesday', createdAt: '2026-10-28T03:30:00Z' })).toBe('2026-10-27')
    expect(noteDayOf({ dailyDate: '2026-02-31', createdAt: '2026-10-28T03:30:00Z' })).toBe('2026-10-27')
  })
  it('reads a number as a moment, a bare date as that day, and falls back to today', () => {
    expect(noteDayOf({ createdAt: Date.parse('2026-10-28T03:30:00Z') })).toBe('2026-10-27')
    expect(noteDayOf({ createdAt: '2026-10-28' })).toBe('2026-10-28')
    expect(noteDayOf({})).toBe(todayET())
    expect(noteDayOf(null)).toBe(todayET())
    expect(noteDayOf({ createdAt: 'garbage' })).toBe(todayET())
  })
})

describe('weekMonday and forDayLabel', () => {
  it('weekMonday uses UTC parts: every day of a week answers its Monday', () => {
    for (const d of ['2026-10-26', '2026-10-27', '2026-10-30', '2026-11-01']) expect(weekMonday(d)).toBe('2026-10-26')
    expect(weekMonday('2026-11-02')).toBe('2026-11-02')
    expect(weekMonday('2026-01-01')).toBe('2025-12-29')           // across a year
    expect(weekMonday('2026-03-08')).toBe('2026-03-02')           // a spring-forward Sunday
    expect(weekMonday('nope')).toBe('')
  })
  it('forDayLabel_day_and_week', () => {
    expect(forDayLabel('2026-10-27')).toBe('For Tue Oct 27')
    expect(forDayLabel('2026-10-27', 'day')).toBe('For Tue Oct 27')
    expect(forDayLabel('2026-10-27', 'week')).toBe('For the week of Oct 26')
    expect(forDayLabel('2025-10-22', 'week')).toBe('For the week of Oct 20')   // a week whose Monday is the 20th
    expect(forDayLabel('2026-01-01', 'week')).toBe('For the week of Dec 29')
    expect(forDayLabel('2026-02-30')).toBe('')
  })
  it('toolSearchText_exact', () => {
    expect(toolSearchText('routine', 'Pre-market routine', '2026-10-27')).toBe('[routine: Pre-market routine · For Tue Oct 27]')
    expect(toolSearchText('tracker', 'Sleep', '2026-10-27', 'day')).toBe('[tracker: Sleep · For Tue Oct 27]')
    expect(toolSearchText('routine', 'Pre-market routine', '2026-10-27', 'week')).toBe('[routine: Pre-market routine · For the week of Oct 26]')
  })
})

describe('localTimeBeside', () => {
  // 2026-10-26 15:00Z: EDT (UTC-4), CDT (UTC-5); the clocks fall back on Nov 1.
  const oct = new Date('2026-10-26T15:00:00Z')
  const nov = new Date('2026-11-04T15:00:00Z')
  it('localTimeBeside_in_chicago_and_new_york', () => {
    expect(localTimeBeside('9:00', oct, 'America/Chicago')).toBe('9:00 ET · 8:00 your time')
    expect(localTimeBeside('9:00', oct, 'America/New_York')).toBe('9:00 ET')
    expect(localTimeBeside('16:00', oct, 'America/Chicago')).toBe('16:00 ET · 15:00 your time')
    expect(localTimeBeside('9:30', oct, 'Asia/Kolkata')).toBe('9:30 ET · 19:00 your time')
  })
  it('stays right across the two days the zones change on different dates', () => {
    // Mar 8-28 2026: the US has sprung forward and London has not, so the gap is 4 hours, not 5.
    expect(localTimeBeside('9:00', new Date('2026-03-15T15:00:00Z'), 'Europe/London')).toBe('9:00 ET · 13:00 your time')
    expect(localTimeBeside('9:00', nov, 'Europe/London')).toBe('9:00 ET · 14:00 your time')
  })
  it('uses the ET day of `now`, not the UTC day (03:00Z is still yesterday in New York)', () => {
    // 2026-11-02 03:00Z is Nov 1 22:00 ET (after the fall back): 9:00 ET on Nov 1 is 14:00Z.
    expect(localTimeBeside('9:00', new Date('2026-11-02T03:00:00Z'), 'Europe/London')).toBe('9:00 ET · 14:00 your time')
  })
  it('defaults to the browser zone, and leaves an unreadable time as it came', () => {
    expect(localTimeBeside('9:00', oct)).toMatch(/^9:00 ET( · \d{1,2}:\d{2} your time)?$/)
    expect(localTimeBeside('soon', oct)).toBe('soon')
    expect(localTimeBeside('25:00', oct)).toBe('25:00')
  })
})
