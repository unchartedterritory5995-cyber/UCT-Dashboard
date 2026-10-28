// app/src/components/chart/shortTag.test.js
import { describe, it, expect } from 'vitest'
import { tagRestatesName, rowTagRestatesName } from './shortTag'

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

// ⛔ A TICKER IS AN IDENTIFIER, NOT AN ABBREVIATION: on a security row only an
// exact match hides it. Each of these was HIDDEN by the abbreviation rules.
const TICKERS = [
  ['Ford Motor Company', 'F'], ['Citigroup Inc.', 'C'], ['Visa Inc.', 'V'], ['AT&T Inc.', 'T'],
  ['Mastercard Incorporated', 'MA'], ['Costco Wholesale Corporation', 'COST'], ['PepsiCo, Inc.', 'PEP'],
  ['International Business Machines', 'IBM'], ['General Electric', 'GE'], ['Meta Platforms', 'META'],
]

describe('exactOnly: a security row keeps its ticker unless it IS the name', () => {
  it.each(TICKERS)('%s / %s keeps the ticker', (name, ticker) => {
    expect(tagRestatesName(name, ticker, { exactOnly: true })).toBe(false)
    expect(rowTagRestatesName({ kind: 'security', name }, ticker)).toBe(false)
  })

  it('CONTROL: the abbreviation rules alone WOULD hide every one of them', () => {
    expect(TICKERS.filter(([n, t]) => tagRestatesName(n, t))).toEqual(TICKERS)
  })

  it('a ticker that is the whole name still hides (AAPL / AAPL)', () => {
    expect(rowTagRestatesName({ kind: 'security', name: 'AAPL' }, 'AAPL')).toBe(true)
  })
})

describe('rowTagRestatesName: which rule a row is owed', () => {
  it('definition rows (no kind, technical, builtin, formula) get the abbreviation rules', () => {
    for (const kind of [undefined, 'technical', 'builtin', 'formula']) {
      expect(rowTagRestatesName({ kind, name: 'Relative Strength Index' }, 'RSI'), String(kind)).toBe(true)
    }
  })

  it('every other kind, including one nobody has written yet, gets equality only', () => {
    for (const kind of ['security', 'breadth', 'fundamental', 'positioning', 'feature', 'brand-new']) {
      expect(rowTagRestatesName({ kind, name: 'Parabolic SAR' }, 'SAR'), kind).toBe(false)
    }
  })
})
