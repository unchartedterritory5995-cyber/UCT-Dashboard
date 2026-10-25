// Tracker values on the client (Notebook widgets phase 2, wave 9, Task 9.14).
import { describe, it, expect } from 'vitest'
import { numText, durationText, valueText, parseHmm, typedValue, inputText, entriesText, DURATION_HINT } from './trackerValues'

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
    // M-8: a comma decimal; "1,000" reads as a thousands separator, so it is never guessed into 1.
    expect(typedValue('number', '2,5')).toEqual({ value: 2.5 })
    expect(typedValue('number', '-0,75')).toEqual({ value: -0.75 })
    expect(typedValue('number', '1,000')).toEqual({ value: '1,000' })
    expect(typedValue('number', '1,2,3')).toEqual({ value: '1,2,3' })
    // W9-R41: a duration is h:mm or whole minutes; anything else is refused HERE (no request), in the duration's words.
    expect(typedValue('duration', '7:30')).toEqual({ value: 450 })
    expect(typedValue('duration', '1:30')).toEqual({ value: 90 })
    expect(typedValue('duration', '90')).toEqual({ value: 90 })
    expect(typedValue('duration', '0:45')).toEqual({ value: 45 })
    expect(typedValue('duration', '25:00')).toEqual({ value: 1500 })    // the server says "at most 24 hours"
    expect(typedValue('duration', '7:75')).toEqual({ refused: DURATION_HINT })
    expect(typedValue('duration', 'abc')).toEqual({ refused: DURATION_HINT })
    expect(typedValue('duration', '1.5')).toEqual({ refused: DURATION_HINT })
    expect(typedValue('duration', '-5')).toEqual({ refused: DURATION_HINT })
    expect(DURATION_HINT).toBe('Enter a time like 1:30.')
    expect(parseHmm('12:05')).toBe(725)
    expect(parseHmm('x')).toBeNull()
    expect(inputText('duration', 450)).toBe('7:30')
    expect(inputText('duration', 45)).toBe('0:45')
    expect(inputText('number', 80)).toBe('80')
    expect(inputText('number', null)).toBe('')
  })

  it('counts entries in words, never 0', () => {
    expect(entriesText(12)).toBe('from 12 entries')
    expect(entriesText(1)).toBe('from 1 entry')
    expect(entriesText(0)).toBe('')
    expect(entriesText(null)).toBe('')
  })
})
