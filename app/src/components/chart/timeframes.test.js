import { describe, it, expect } from 'vitest'
import {
  isNativeTf, parseTf, makeTfCode, tfLabel, resampleSpec, fetchTf, isValidTf, ALL_MENU_CODES,
} from './timeframes'

describe('timeframes model', () => {
  it('classifies native vs custom', () => {
    for (const c of ['1', '5', '15', '30', '60', 'D', 'W', 'M']) expect(isNativeTf(c)).toBe(true)
    for (const c of ['2', '45', '65', '195', '120', '240', '2D', '3D', '2W', '3M', '12M']) expect(isNativeTf(c)).toBe(false)
  })

  it('parses codes to unit/count/minutes', () => {
    expect(parseTf('2')).toEqual({ unit: 'minutes', count: 2, minutes: 2 })
    expect(parseTf('45')).toEqual({ unit: 'minutes', count: 45, minutes: 45 })
    expect(parseTf('60')).toEqual({ unit: 'hours', count: 1, minutes: 60 })
    expect(parseTf('240')).toEqual({ unit: 'hours', count: 4, minutes: 240 })
    expect(parseTf('D')).toEqual({ unit: 'days', count: 1, minutes: null })
    expect(parseTf('3D')).toEqual({ unit: 'days', count: 3, minutes: null })
    expect(parseTf('2W')).toEqual({ unit: 'weeks', count: 2, minutes: null })
    expect(parseTf('12M')).toEqual({ unit: 'months', count: 12, minutes: null })
  })

  it('makeTfCode is the inverse for supported units', () => {
    expect(makeTfCode('minutes', 45)).toBe('45')
    expect(makeTfCode('hours', 2)).toBe('120')
    expect(makeTfCode('days', 1)).toBe('D')
    expect(makeTfCode('days', 3)).toBe('3D')
    expect(makeTfCode('weeks', 2)).toBe('2W')
    expect(makeTfCode('months', 1)).toBe('M')
    expect(makeTfCode('months', 6)).toBe('6M')
  })

  it('labels read naturally', () => {
    expect(tfLabel('45')).toBe('45m')
    expect(tfLabel('120')).toBe('2h')
    expect(tfLabel('3D')).toBe('3D')
    expect(tfLabel('12M')).toBe('12M')
  })

  it('resampleSpec picks the coarsest dividing base + right kind', () => {
    expect(resampleSpec('D')).toBeNull()          // native
    expect(resampleSpec('2')).toEqual({ base: '1', kind: 'intradaySession', minutes: 2 })
    expect(resampleSpec('10')).toEqual({ base: '5', kind: 'intradaySession', minutes: 10 })
    expect(resampleSpec('45')).toEqual({ base: '15', kind: 'intradaySession', minutes: 45 })
    expect(resampleSpec('65')).toEqual({ base: '5', kind: 'intradaySession', minutes: 65 })   // 65=13×5
    expect(resampleSpec('195')).toEqual({ base: '15', kind: 'intradaySession', minutes: 195 }) // 195=13×15
    expect(resampleSpec('120')).toEqual({ base: '60', kind: 'intradaySession', minutes: 120 }) // 2h from 60m
    expect(resampleSpec('240')).toEqual({ base: '60', kind: 'intradaySession', minutes: 240 }) // 4h from 60m
    expect(resampleSpec('2D')).toEqual({ base: 'D', kind: 'nDaily', n: 2 })
    expect(resampleSpec('2W')).toEqual({ base: 'W', kind: 'nWeekly', n: 2 })
    expect(resampleSpec('3M')).toEqual({ base: 'M', kind: 'nMonthly', n: 3 })
  })

  it('fetchTf returns the native base to actually request', () => {
    expect(fetchTf('D')).toBe('D')
    expect(fetchTf('45')).toBe('15')
    expect(fetchTf('3M')).toBe('M')
  })

  it('every catalog code is valid + parseable', () => {
    for (const c of ALL_MENU_CODES) expect(isValidTf(c)).toBe(true)
  })
})
