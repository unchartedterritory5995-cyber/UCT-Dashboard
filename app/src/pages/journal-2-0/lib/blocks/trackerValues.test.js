// Tracker values on the client (Notebook widgets phase 2, wave 9, Task 9.14).
import { describe, it, expect } from 'vitest'
import { numText, durationText, valueText, parseHmm, typedValue, inputText, mergeRecent, summaryOf, entriesText, RECENT_MAX } from './trackerValues'

describe('trackerValues', () => {
  it('reads values as the server writes them (tracker_days.format_value), a scale average keeping its decimals', () => {
    expect(numText(6.5)).toBe('6.5')
    expect(numText(1e9)).toBe('1000000000')                          // never an exponent
    expect(numText(0.123)).toBe('0.12')
    expect(numText(-2)).toBe('-2')
    expect(numText(-0.001)).toBe('0')
    expect(durationText(450)).toBe('7h 30m')
    expect(durationText(480)).toBe('8h')
    expect(durationText(45)).toBe('45m')
    expect(valueText('yesno', 1)).toBe('Yes')
    expect(valueText('yesno', 0)).toBe('No')                          // a No is a value, not nothing
    expect(valueText('scale', 3.25)).toBe('3.25')
    expect(valueText('number', 2, 'cups')).toBe('2 cups')
    expect(valueText('duration', 438.75)).toBe('7h 19m')
    for (const v of [null, undefined, NaN, Infinity]) expect(valueText('number', v)).toBeNull()
  })

  it('turns typed text into what is sent, never a number it does not spell', () => {
    expect(typedValue('number', ' 2.5 ')).toEqual({ value: 2.5 })
    expect(typedValue('number', '-5')).toEqual({ value: -5 })
    expect(typedValue('number', '.5')).toEqual({ value: 0.5 })
    expect(typedValue('number', '')).toEqual({ clear: true })
    expect(typedValue('number', '   ')).toEqual({ clear: true })
    // JSON has no NaN or Infinity: these would be sent as null, a CLEAR. They go as the text and are refused.
    expect(typedValue('number', '1e309')).toEqual({ value: '1e309' })
    expect(typedValue('number', 'abc')).toEqual({ value: 'abc' })
    expect(typedValue('number', '0x10')).toEqual({ value: '0x10' })
    expect(typedValue('duration', '7:30')).toEqual({ value: 450 })
    expect(typedValue('duration', '0:45')).toEqual({ value: 45 })
    expect(typedValue('duration', '25:00')).toEqual({ value: 1500 })    // the server says "at most 24 hours"
    expect(typedValue('duration', '7:75')).toEqual({ value: '7:75' })
    expect(typedValue('duration', '7')).toEqual({ value: '7' })
    expect(parseHmm('12:05')).toBe(725)
    expect(parseHmm('x')).toBeNull()
    expect(inputText('duration', 450)).toBe('7:30')
    expect(inputText('duration', 45)).toBe('0:45')
    expect(inputText('number', 80)).toBe('80')
    expect(inputText('number', null)).toBe('')
  })

  it('merges one day into the recent entries: replaced, added, removed by a clear, oldest first, newest 30 kept', () => {
    const recent = [{ day: '2026-10-22', value: 1 }, { day: '2026-10-26', value: 2 }]
    expect(mergeRecent(recent, '2026-10-26', 5)).toEqual([{ day: '2026-10-22', value: 1 }, { day: '2026-10-26', value: 5 }])
    expect(mergeRecent(recent, '2026-10-23', 3)).toEqual([{ day: '2026-10-22', value: 1 }, { day: '2026-10-23', value: 3 }, { day: '2026-10-26', value: 2 }])
    expect(mergeRecent(recent, '2026-10-26', null)).toEqual([{ day: '2026-10-22', value: 1 }])
    expect(mergeRecent(recent, '2026-10-26', 0)).toEqual([{ day: '2026-10-22', value: 1 }, { day: '2026-10-26', value: 0 }])
    const many = Array.from({ length: 30 }, (_, i) => ({ day: `2026-09-${String(i + 1).padStart(2, '0')}`, value: i }))
    const merged = mergeRecent(many, '2026-10-01', 99)
    expect(merged).toHaveLength(RECENT_MAX)
    expect(merged[0].day).toBe('2026-09-02')
    expect(merged.at(-1)).toEqual({ day: '2026-10-01', value: 99 })
  })

  it('summarises by the server rule: an unreadable entry is not averaged and never read as 0; no entries is no count', () => {
    expect(summaryOf([{ day: 'a', value: 4 }, { day: 'b', value: null }, { day: 'c', value: 2 }]))
      .toEqual({ average: 3, latest: { day: 'c', value: 2 }, n: 3 })
    expect(summaryOf([{ day: 'a', value: 4 }, { day: 'b', value: null }])).toEqual({ average: 4, latest: null, n: 2 })
    expect(summaryOf([])).toEqual({ average: null, latest: null, n: null })
    expect(summaryOf(undefined)).toEqual({ average: null, latest: null, n: null })
    expect(entriesText(12)).toBe('from 12 entries')
    expect(entriesText(1)).toBe('from 1 entry')
    expect(entriesText(0)).toBe('')
    expect(entriesText(null)).toBe('')
  })
})
