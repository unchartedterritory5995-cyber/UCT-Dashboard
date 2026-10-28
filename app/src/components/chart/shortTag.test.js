// app/src/components/chart/shortTag.test.js
import { describe, it, expect } from 'vitest'
import { tagRestatesName } from './shortTag'

describe('tagRestatesName: hide a tag only when the name already says it', () => {
  it.each([
    ['TRIX', 'TRIX'], ['SuperTrend', 'SuperTrend'], ['AAPL', 'AAPL'],
    ['Parabolic SAR', 'SAR'], ['Session VWAP', 'VWAP'], ['Ichimoku Cloud', 'Ichimoku'],
    ['Volume', 'Vol'], ['Stochastic Oscillator', 'Stoch'], ['Oops Reversal', 'Oops Reversa'],
    ['Relative Strength Index', 'RSI'], ['Moving Average', 'MA'], ['On-Balance Volume', 'OBV'],
    ['Restore EMA 9', 'Restore'],
  ])('%s / %s restates', (name, tag) => {
    expect(tagRestatesName(name, tag)).toBe(true)
  })

  it.each([
    ['Average Directional Index', 'ADX'], ['QQQ', 'ETF'], ['% Above 50-day MA', 'NYSE'],
    ['Revenue', 'Quarterly'], ['Invesco QQQ Trust', 'QQQ T'], ['Parabolic SAR', 'SA'],
  ])('%s / %s adds information', (name, tag) => {
    expect(tagRestatesName(name, tag)).toBe(false)
  })

  it('an empty side never hides anything', () => {
    expect(tagRestatesName('TRIX', '')).toBe(false)
    expect(tagRestatesName('', 'TRIX')).toBe(false)
  })
})
