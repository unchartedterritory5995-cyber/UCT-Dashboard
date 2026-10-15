// app/src/pages/journal-2-0/lib/alertPhrase.test.js
import { describe, expect, it } from 'vitest'
import { MAX_PHRASE_TEXT, describeAlert, parseAlertPhrase, sentencesOf } from './alertPhrase'

const P = (t) => parseAlertPhrase(t)

describe('parseAlertPhrase -- what it reads', () => {
  it.each([
    ['alert me if NVDA closes below 120', { symbol: 'NVDA', mode: 'close', direction: 'below', price: 120, tf: 'D' }],
    ['Alert me when $AMD closes above 155.50', { symbol: 'AMD', mode: 'close', direction: 'above', price: 155.5 }],
    ['set an alert if TSLA drops below 200', { symbol: 'TSLA', mode: 'intraday', direction: 'below', price: 200 }],
    ['alert me if NVDA trades over $130', { symbol: 'NVDA', mode: 'intraday', direction: 'above', price: 130 }],
    ['alert me if NVDA falls to 100', { symbol: 'NVDA', mode: 'intraday', direction: 'below', price: 100 }],
    ['alert me if NVDA hits 150', { symbol: 'NVDA', mode: 'intraday', direction: null, price: 150 }],
    ['alert me if NVDA closes under 118 on the weekly', { mode: 'close', direction: 'below', tf: 'W' }],
    ['alert me if BRK.B closes below 400', { symbol: 'BRK-B' }],
    ['Alert me if NVDA closes below 120.', { price: 120 }],
    ['alert me if NVDA closes below 1,200', { price: 1200 }],
    ['alert me if SPX closes below 5,000', { price: 5000 }],
    ['alert me if NVDA closes above $5,000.50', { price: 5000.5 }],
    ['alert me if NVDA closes below 120 on the daily', { price: 120, tf: 'D' }],
  ])('%s', (text, want) => { expect(P(text)).toMatchObject(want) })

  it('"it", "the stock" and "price" mean the note\'s own ticker', () => {
    for (const t of ['alert me if it closes below 120', 'alert me if the stock closes below 120', 'alert me if price closes below 120']) {
      expect(P(t)).toMatchObject({ symbol: null, pronoun: true, price: 120 })
    }
  })
  it('upper-case IT is Gartner, a ticker, not a pronoun', () => {
    expect(P('alert me if IT closes below 200')).toMatchObject({ symbol: 'IT', pronoun: false })
  })
  it('reads the LAST sentence that asks', () => {
    expect(P('Bought half. Alert me if NVDA closes below 120. Alert me if AMD closes above 160')).toMatchObject({ symbol: 'AMD' })
  })
  it('two sentences where only the second asks: the second is read', () => {
    expect(P('NVDA looks heavy here! Alert me if AMD closes above 160')).toMatchObject({ symbol: 'AMD', price: 160 })
    expect(P('Is this the top?  Alert me if it closes below 120.')).toMatchObject({ pronoun: true, price: 120 })
  })
})

describe('sentencesOf -- the split, without a regex lookbehind (iOS 16.0-16.3)', () => {
  // The ORACLE is the lookbehind split it replaced. Built with `new RegExp` inside this TEST file only: tests run in
  // Node, never on a phone (app/src/noRegexLookbehind.test.js exempts them).
  const oracle = (t) => t.split(new RegExp('(?<=[.!?])\\s+'))
  it.each([
    'alert me if NVDA closes below 120',
    'Alert me if NVDA closes below 120.',
    'Bought half. Alert me if NVDA closes below 120. Alert me if AMD closes above 160',
    'Wow!  Really?\tYes.\nalert me if BRK.B closes below 400',
    'alert me if NVDA closes above $5,000.50 ok',
    'ends with a stop. ',
    '. leading stop',
    '...  ellipsis then text',
    'no stops at all here',
    'x',
    '',
  ])('%j splits exactly as the lookbehind did', (t) => {
    expect(sentencesOf(t)).toEqual(oracle(t))
  })
})

describe('parseAlertPhrase -- what it refuses', () => {
  it.each([
    'NVDA closes below 120',                         // no ask
    "don't alert me if NVDA closes below 120",       // negated
    'no alert if NVDA closes below 120',
    'alert me if NVDA closes below',                 // no price
    'alert me if NVDA closes below 0',               // not a price
    'alert me if NVDA closes below -5',
    'if NVDA closes below 120 alert me',             // ask after the condition
    'alert me if NVDA bounces off 120',              // unknown verb
    'alert me if NVDA closes below 1,20',            // malformed grouping, never read as a smaller number
    'alert me if NVDA closes below 12,0000',
    'alert me if NVDA closes below 50-day',          // moving average / unit words are not prices
    'alert me if NVDA closes below 50 day',
    'alert me if NVDA closes below 200 dma',
    'alert me if NVDA closes below 20 EMA',
    'alert me if NVDA closes below 50 sma',
    'alert me if NVDA closes below 50 ma',
    'alert me if NVDA closes below 120%',
    'alert me if NVDA closes below $120k',
    'alert me if NVDA closes below 120 shares',
    '',
  ])('%s', (text) => { expect(P(text)).toBeNull() })

  it('ignores a paragraph longer than the cap', () => {
    expect(P(`${'x '.repeat(MAX_PHRASE_TEXT)} alert me if NVDA closes below 120`)).toBeNull()
  })
})

describe('describeAlert', () => {
  it('says the mode in words', () => {
    expect(describeAlert(P('alert me if NVDA closes below 120'), 'NVDA')).toBe('NVDA closes below $120.00 (daily)')
    expect(describeAlert(P('alert me if NVDA trades above 130'), 'NVDA')).toBe('NVDA trades above $130.00')
    expect(describeAlert(P('alert me if NVDA hits 150'), 'NVDA')).toBe('NVDA reaches $150.00')
  })
})
