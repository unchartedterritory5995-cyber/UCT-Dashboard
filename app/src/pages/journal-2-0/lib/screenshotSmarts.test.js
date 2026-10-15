// app/src/pages/journal-2-0/lib/screenshotSmarts.test.js
import { describe, expect, it } from 'vitest'
import { altFor, pickTicker, timeframeFromText } from './screenshotSmarts'

describe('timeframeFromText (R-T2A-9)', () => {
  it.each([
    ['NVIDIA Corporation · 1D · NASDAQ', 'D', 'Daily'],
    ['NVDA, D  O182.1 H184 L180', 'D', 'Daily'],
    ['NVDA Daily chart', 'D', 'Daily'],
    ['AMD · 1W · NASDAQ', 'W', 'Weekly'],
    ['SPY Weekly', 'W', 'Weekly'],
    ['QQQ Monthly', 'M', 'Monthly'],
    ['TSLA · 1h', '60', '1 hour'],
    ['TSLA · 4H', '240', '4 hour'],
    ['TSLA 15m', '15', '15 minute'],
    ['TSLA 5 min', '5', '5 minute'],
    ['TSLA 30min', '30', '30 minute'],
  ])('%s', (text, tf, label) => { expect(timeframeFromText(text)).toEqual({ tf, label }) })

  it.each([
    'NVDA · 1M · NASDAQ',          // minute or month: ignored
    'NVDA M',                      // same
    'NVDA 182.40 60 120',          // bare numbers are prices, not timeframes
    'daily and weekly together',   // a conflict is no answer
    'd w',                         // lower-case single letters are OCR noise
    '',
  ])('%s -> null', (text) => { expect(timeframeFromText(text)).toBeNull() })

  it('reads only the header window', () => {
    expect(timeframeFromText(`${'x '.repeat(300)} NVDA Daily`)).toBeNull()
  })
})

describe('pickTicker (R-T2A-7)', () => {
  it('one confident symbol', () => { expect(pickTicker([{ symbol: 'NVDA', tier: 'exact' }])).toBe('NVDA') })
  it('the same symbol twice is still one', () => {
    expect(pickTicker([{ symbol: 'NVDA', tier: 'alias' }, { symbol: 'NVDA', tier: 'exact' }])).toBe('NVDA')
  })
  it('two symbols: no guess', () => {
    expect(pickTicker([{ symbol: 'NVDA', tier: 'exact' }, { symbol: 'AMD', tier: 'exact' }])).toBeNull()
  })
  it('contextual (lower-case) matches never count', () => { expect(pickTicker([{ symbol: 'DELL', tier: 'contextual' }])).toBeNull() })
  it('nothing, or a failed check', () => { expect(pickTicker([])).toBeNull(); expect(pickTicker(null)).toBeNull() })
})

describe('altFor (R-T2A-8)', () => {
  it('names the screenshot', () => {
    expect(altFor({ symbol: 'NVDA', timeframe: { tf: 'D', label: 'Daily' } })).toBe('NVDA daily chart')
    expect(altFor({ symbol: 'NVDA', timeframe: null })).toBe('NVDA chart')
  })
})
