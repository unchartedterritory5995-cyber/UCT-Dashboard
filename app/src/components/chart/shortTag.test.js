// app/src/components/chart/shortTag.test.js
import { describe, it, expect } from 'vitest'
import { tagRestatesName } from './shortTag'

describe('tagRestatesName: hide a tag only when the name already says it, word for word', () => {
  it.each([
    ['TRIX', 'TRIX'], ['SuperTrend', 'SuperTrend'], ['AAPL', 'AAPL'],
    ['Parabolic SAR', 'SAR'], ['Session VWAP', 'VWAP'], ['Ichimoku Cloud', 'Ichimoku'],
    ['Nasdaq-100 E-Mini COT', 'COT'], ['NAAIM Exposure Index', 'NAAIM'], ['Restore EMA 9', 'Restore'],
    ['Meta Platforms Inc.', 'META'], ['AT&T Inc.', 'T'],
  ])('%s / %s restates', (name, tag) => {
    expect(tagRestatesName(name, tag)).toBe(true)
  })

  // ⛔ VISIBLE TEXT THE NAME DOES NOT LITERALLY CONTAIN STAYS IN THE NAME
  // (WCAG 2.5.3 Label in Name): abbreviations, cuts and tickers alike.
  it.each([
    ['Relative Strength Index', 'RSI'], ['Average Directional Index', 'ADX'], ['On-Balance Volume', 'OBV'],
    ['Moving Average', 'MA'], ['Volume', 'Vol'], ['Stochastic Oscillator', 'Stoch'], ['Oops Reversal', 'Oops Reversa'],
    ['Ford Motor Company', 'F'], ['Citigroup Inc.', 'C'], ['Visa Inc.', 'V'], ['Mastercard Incorporated', 'MA'],
    ['Costco Wholesale Corporation', 'COST'], ['PepsiCo, Inc.', 'PEP'], ['International Business Machines', 'IBM'],
    ['General Electric', 'GE'], ['Advanced Micro Devices', 'AMD'],
    ['QQQ', 'ETF'], ['% Above 50-day MA', 'NYSE'], ['Revenue', 'Quarterly'], ['Parabolic SAR', 'SA'],
  ])('%s / %s is spoken', (name, tag) => {
    expect(tagRestatesName(name, tag)).toBe(false)
  })

  it('an empty side never hides anything', () => {
    expect(tagRestatesName('TRIX', '')).toBe(false)
    expect(tagRestatesName('', 'TRIX')).toBe(false)
  })
})
