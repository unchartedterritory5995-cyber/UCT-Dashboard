// @vitest-environment jsdom
/* The Breadth category (owner request 2026-10-07): every breadth series UCT already serves
 * appears under Breadth with the UCT mark, UCT tickers SHOW as `UCT:A50` while submitting
 * the canonical `UCTA50`, and the exchange series show their conventional tickers. */
import { describe, it, expect } from 'vitest'
import { breadthChipRows, canonicalTicker, isBreadthRow, isBreadthIndicatorRow, matchQ, rowIdentity, shownTicker } from './symbolSearchModel'

const SYMBOLS = [
  { symbol: 'UCTA50', name: '% of Stocks Above 50-Day MA', group: 'ma', group_label: 'MA Breadth' },
  { symbol: 'UCTU4', name: 'Stocks Up 4%+ Today', group: 'momentum', group_label: 'Momentum' },
  { symbol: 'US:A50', name: '% of Stocks Above 50-Day MA', group: 'ma', group_label: 'MA Breadth', universe: 'us', universe_label: 'US' },
  { symbol: 'NYSE:A50', name: '% of Stocks Above 50-Day MA', group: 'ma', group_label: 'MA Breadth', universe: 'nyse', universe_label: 'NYSE' },
  { symbol: 'NASDAQ:A50', name: '% of Stocks Above 50-Day MA', group: 'ma', group_label: 'MA Breadth', universe: 'nasdaq', universe_label: 'NASDAQ' },
]
const DISPLAY = { UCTA50: 'UCT:A50', UCTU4: 'UCT:U4' }
const mi = (id, shown, universe, display, extra = {}) => ({
  id, symbol: id, display_symbol: shown, universe, display, family: 'mcclellan', family_label: 'McClellan',
  source_type: 'breadth_derived', catalogue: 'market_indicators', status: 'published',
  aliases: [shown, '$' + shown], ...extra,
})
const INDICATORS = [
  mi('US:MCO', 'US:MCO', 'us', 'US · McClellan Oscillator', { aliases: [] }),
  mi('NYSE:MCO', 'NYMO', 'nyse', 'NYSE · McClellan Oscillator'),
  mi('NYSE:MCS', 'NYSI', 'nyse', 'NYSE · McClellan Summation Index'),
  mi('NYSE:AD', 'NYAD', 'nyse', 'NYSE · Advance/Decline Line', { family: 'breadth' }),
  mi('NASDAQ:MCO', 'NAMO', 'nasdaq', 'Nasdaq · McClellan Oscillator'),
  mi('NASDAQ:MCS', 'NASI', 'nasdaq', 'Nasdaq · McClellan Summation Index'),
  mi('NASDAQ:AD', 'NAAD', 'nasdaq', 'Nasdaq · Advance/Decline Line', { family: 'breadth' }),
  // not breadth: a survey, a volatility index, a product, a dormant row, a library echo
  { id: 'SENT:NAAIM', symbol: 'NAAIM', source_type: 'survey', family: 'sentiment', catalogue: 'market_indicators' },
  { id: 'CBOE:VIX9D', symbol: 'VIX9D', source_type: 'volatility', family: 'volatility', catalogue: 'market_indicators' },
  { id: 'AAII:SURVEY', symbol: 'AAII:SURVEY', kind: 'product', source_type: 'survey', catalogue: 'market_indicators' },
  mi('UCT:MCO', 'UCT:MCO', 'uct', 'UCT · McClellan Oscillator (Ratio-Adjusted)', { status: 'dormant' }),
  { id: 'US:A50', symbol: 'US:A50', source_type: 'breadth_derived', catalogue: 'breadth_library', universe: 'us' },
]

describe('breadthChipRows', () => {
  const rows = breadthChipRows(SYMBOLS, DISPLAY, INDICATORS)
  const tickers = rows.map((r) => r.ticker)
  const shown = rows.map(shownTicker)
  const byShown = (t) => rows.find((r) => shownTicker(r) === t)

  it('SHOWS all six exchange series by their conventional tickers, SUBMITS the colon id', () => {
    for (const t of ['NASI', 'NAMO', 'NAAD', 'NYSI', 'NYMO', 'NYAD']) expect(shown).toContain(t)
    expect(byShown('NYMO').name).toBe('NYSE · McClellan Oscillator')
    expect(byShown('NYMO').ticker).toBe('NYSE:MCO')
    // ⛔ the edge routes bare words to the bars tier, where NASI is a delisted stock
    expect(byShown('NASI').ticker).toBe('NASDAQ:MCS')
    expect(byShown('NASI').name).toBe('Nasdaq · McClellan Summation Index')
    for (const r of rows.filter((x) => x.indicator)) expect(r.ticker).toContain(':')
  })

  it('every row is a breadth row (UCT mark + BREADTH badge)', () => {
    for (const r of rows) {
      expect(isBreadthRow(r)).toBe(true)
      expect(rowIdentity(r).badge).toEqual({ text: 'BREADTH', kind: 'breadth' })
    }
  })

  it('excludes surveys, volatility, products, dormant rows and library echoes; no duplicates', () => {
    for (const t of ['NAAIM', 'VIX9D', 'AAII:SURVEY', 'UCT:MCO']) expect(tickers).not.toContain(t)
    expect(new Set(tickers).size).toBe(tickers.length)
    expect(tickers.filter((t) => t === 'US:A50')).toHaveLength(1)
  })

  it('orders UCT first, then per universe its derived series before its library metrics', () => {
    expect(shown).toEqual(['UCT:A50', 'UCT:U4', 'US:MCO', 'US:A50', 'NYMO', 'NYSI', 'NYAD', 'NYSE:A50',
      'NAMO', 'NASI', 'NAAD', 'NASDAQ:A50'])
  })

  it('UCT rows SHOW UCT: and submit the canonical symbol; universe rows name their population', () => {
    const a50 = rows.find((r) => r.ticker === 'UCTA50')
    expect(shownTicker(a50)).toBe('UCT:A50')
    expect(shownTicker(rows.find((r) => r.ticker === 'UCTU4'))).toBe('UCT:U4')
    expect(shownTicker(rows.find((r) => r.ticker === 'NYSE:MCO'))).toBe('NYMO')
    expect(shownTicker(rows.find((r) => r.ticker === 'US:MCO'))).toBe('US:MCO')
    expect(rows.find((r) => r.ticker === 'US:A50').name).toBe('US · % of Stocks Above 50-Day MA')
    expect(rows.find((r) => r.ticker === 'NASDAQ:A50').name).toBe('Nasdaq · % of Stocks Above 50-Day MA')
    expect(a50.name).toBe('% of Stocks Above 50-Day MA')
  })

  it('search matches the shown ticker, the legacy ticker, the canonical id and $-aliases', () => {
    const f = (q) => rows.filter((r) => matchQ(r, q)).map((r) => r.ticker)
    expect(f('UCT:A50')).toEqual(['UCTA50'])
    expect(f('UCTA50')).toEqual(['UCTA50'])
    expect(f('NYMO')).toEqual(['NYSE:MCO'])
    expect(f('NYSE:MCO')).toEqual(['NYSE:MCO'])
    expect(f('$NASI')).toEqual(['NASDAQ:MCS'])
    expect(f('McClellan')).toEqual(['US:MCO', 'NYSE:MCO', 'NYSE:MCS', 'NASDAQ:MCO', 'NASDAQ:MCS'])
  })

  it('degrades to the breadth-symbols list alone before the indicator registry lands', () => {
    expect(breadthChipRows(SYMBOLS, null, null).map((r) => r.ticker)).toEqual(
      ['UCTA50', 'UCTU4', 'US:A50', 'NYSE:A50', 'NASDAQ:A50'])
  })
})

describe('canonicalTicker / isBreadthIndicatorRow', () => {
  const rows = breadthChipRows(SYMBOLS, DISPLAY, INDICATORS)
  it('a typed UCT:A50 submits UCTA50; anything else passes through untouched', () => {
    expect(canonicalTicker('uct:a50', rows)).toBe('UCTA50')
    expect(canonicalTicker('UCTA50', rows)).toBe('UCTA50')
    expect(canonicalTicker('NYMO', rows)).toBe('NYSE:MCO')
    expect(canonicalTicker('nasi', rows)).toBe('NASDAQ:MCS')
    expect(canonicalTicker('$NASI', rows)).toBe('NASDAQ:MCS')
    expect(canonicalTicker('NASDAQ:MCS', rows)).toBe('NASDAQ:MCS')
    expect(canonicalTicker('AAPL', rows)).toBe('AAPL')
    expect(canonicalTicker('UCT:A50', [])).toBe('UCT:A50')
  })
  it('a ticker-search indicator row is breadth by family; sentiment is not', () => {
    expect(isBreadthIndicatorRow({ indicator: true, family: 'mcclellan', ticker: 'NYMO' })).toBe(true)
    expect(isBreadthIndicatorRow({ indicator: true, family: 'breadth', ticker: 'US:ADR' })).toBe(true)
    expect(isBreadthIndicatorRow({ indicator: true, family: 'sentiment', ticker: 'NAAIM' })).toBe(false)
    expect(isBreadthIndicatorRow({ indicator: true, family: 'volatility', ticker: 'VIX9D' })).toBe(false)
    expect(isBreadthIndicatorRow({ indicator: true, family: 'breadth', kind: 'product' })).toBe(false)
    expect(rowIdentity({ ticker: 'NAAIM', type: 'indicator', indicator: true, family: 'sentiment' }).badge.text).toBe('indicator')
  })
})
