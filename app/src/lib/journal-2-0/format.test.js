import { describe, it, expect } from 'vitest'
import {
  money,
  moneySigned,
  percent,
  rMultiple,
  shares,
  dateShort,
  dateLong,
  profitFactor,
  holdDaysDisplay,
} from './format.js'

describe('money', () => {
  it('basic positive', () => expect(money(1234.56)).toBe('$1,234.56'))
  it('negative', () => expect(money(-250)).toBe('-$250.00'))
  it('zero', () => expect(money(0)).toBe('$0.00'))
  it('rounds to 2 dp', () => expect(money(1.2345)).toBe('$1.23'))
  it('thousands separator on large values', () =>
    expect(money(1_234_567.89)).toBe('$1,234,567.89'))
  it('null → dash', () => expect(money(null)).toBe('—'))
  it('undefined → dash', () => expect(money(undefined)).toBe('—'))
  it('NaN → dash', () => expect(money(NaN)).toBe('—'))
  it('Infinity → dash', () => expect(money(Infinity)).toBe('—'))
})

describe('moneySigned', () => {
  it('positive gets + sign', () => expect(moneySigned(100)).toBe('+$100.00'))
  it('negative keeps -', () => expect(moneySigned(-100)).toBe('-$100.00'))
  it('zero has no sign', () => expect(moneySigned(0)).toBe('$0.00'))
})

describe('percent', () => {
  it('ratio 0.2 → 20.00%', () => expect(percent(0.2)).toBe('20.00%'))
  it('ratio 0.201556 → 20.16%', () => expect(percent(0.201556)).toBe('20.16%'))
  it('signed positive', () =>
    expect(percent(0.16, { signed: true })).toBe('+16.00%'))
  it('signed negative keeps -', () =>
    expect(percent(-0.05, { signed: true })).toBe('-5.00%'))
  it('dp override', () =>
    expect(percent(0.214748, { dp: 3 })).toBe('21.475%'))
  it('isRatio:false treats input as already-percent', () =>
    expect(percent(20.16, { isRatio: false })).toBe('20.16%'))
  it('null → dash', () => expect(percent(null)).toBe('—'))
})

describe('rMultiple', () => {
  it('2.9521 → +3.0R (1 dp)', () => expect(rMultiple(2.9521)).toBe('+3.0R'))
  it('-1.5 → -1.5R', () => expect(rMultiple(-1.5)).toBe('-1.5R'))
  it('0 has no + sign', () => expect(rMultiple(0)).toBe('0.0R'))
  it('null → dash', () => expect(rMultiple(null)).toBe('—'))
})

describe('shares', () => {
  it('non-fractional rounds to integer', () =>
    expect(shares(54.72, false)).toBe('55'))
  it('fractional strips trailing zeros', () =>
    expect(shares(0.5, true)).toBe('0.5'))
  it('fractional keeps meaningful decimals', () =>
    expect(shares(1.234, true)).toBe('1.234'))
  it('fractional 4 dp max', () =>
    expect(shares(0.123456789, true)).toBe('0.1235'))
  it('whole number in fractional mode displays clean', () =>
    expect(shares(250, true)).toBe('250'))
  it('null → dash', () => expect(shares(null, true)).toBe('—'))
  it('zero displays as 0', () => expect(shares(0, true)).toBe('0'))
})

describe('dateShort (MM/DD/YY)', () => {
  it('ISO date → short format', () => {
    // Use a local-time date to avoid TZ issues — construct locally
    const d = new Date(2026, 3, 9) // month is 0-indexed, so 3 = April
    expect(dateShort(d)).toBe('04/09/26')
  })
  it('null → dash', () => expect(dateShort(null)).toBe('—'))
  it('invalid string → dash', () => expect(dateShort('not a date')).toBe('—'))
})

describe('dateLong (MM/DD/YYYY)', () => {
  it('Date object → long format', () => {
    const d = new Date(2026, 3, 9)
    expect(dateLong(d)).toBe('04/09/2026')
  })
  it('null → dash', () => expect(dateLong(null)).toBe('—'))
})

describe('profitFactor', () => {
  it('number → 2 dp', () => expect(profitFactor(2.5)).toBe('2.50'))
  it('∞ → "∞"', () => expect(profitFactor(Infinity)).toBe('∞'))
  it('0 → "0.00"', () => expect(profitFactor(0)).toBe('0.00'))
  it('null → dash', () => expect(profitFactor(null)).toBe('—'))
})

describe('holdDaysDisplay', () => {
  it('1.23 → "1.2d"', () => expect(holdDaysDisplay(1.23)).toBe('1.2d'))
  it('0 → "0.0d"', () => expect(holdDaysDisplay(0)).toBe('0.0d'))
  it('null → dash', () => expect(holdDaysDisplay(null)).toBe('—'))
})
