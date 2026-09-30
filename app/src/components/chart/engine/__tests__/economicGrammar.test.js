// `econ:<SYMBOL>` — the economic-data source family (Phase 1).
// It must parse to its OWN kind and never be routed to the bars / fundamentals /
// breadth lanes; anything malformed is null (unresolved), never Close.
import { describe, it, expect } from 'vitest'
import { economicSource, parseEconomicSource, economicSymbolOf, ECON_MARK } from '../economicGrammar'
import { parseSource, symbolsNeeded, sourceOptions, instanceLabel } from '../sourceRef'
import { fundamentalsNeeded } from '../fundamentalSource'
import { ohlcCapabilityOf } from '../ohlcCapability'
import * as registry from '../nativeRegistry'

const defOf = (id) => registry.getDefinition(id)
const inst = (source, id = 'e') => ({ instanceId: id, defId: 'dataSeries', inputs: { source } })

describe('econ: grammar', () => {
  it('⭐ econ:USCPI -> {kind:"economic", symbol:"USCPI"}', () => {
    expect(parseSource('econ:USCPI')).toEqual({ kind: 'economic', symbol: 'USCPI' })
    expect(parseEconomicSource('econ:USCPI')).toEqual({ kind: 'economic', symbol: 'USCPI' })
  })

  it('round-trips through the builder; the symbol is canonicalised upper-case', () => {
    expect(economicSource('USCPI')).toBe('econ:USCPI')
    expect(economicSource(' uscpi ')).toBe('econ:USCPI')
    expect(parseSource(economicSource('USFEDFUNDSU'))).toEqual({ kind: 'economic', symbol: 'USFEDFUNDSU' })
    expect(ECON_MARK).toBe('econ:')
  })

  it.each([
    ['econ:', 'empty symbol'],
    ['econ:AAPL:close', 'econ has NO field -- a sym:-shaped string is refused'],
    ['econ:USCPI:yoy', 'transforms are separate registry series, not suffixes'],
    ['econ: USCPI', 'whitespace'],
    ['econ:US CPI', 'inner whitespace'],
    ['econ:1CPI', 'must start with a letter'],
    ['econ:U', 'too short'],
    ['econ:US-CPI', 'punctuation'],
    ['ECON:USCPI', 'the API canonical id is not a source string'],
    ['Econ:USCPI', 'one spelling of the prefix'],
    ['econUSCPI', 'no mark'],
  ])('⛔ %s is unresolved (null), never Close — %s', (value) => {
    expect(parseSource(value)).toBeNull()
  })

  it('⛔ builder refuses what the parser refuses', () => {
    for (const bad of ['', ' ', 'US CPI', 'AAPL:close', null, 42, '1X']) expect(economicSource(bad)).toBeNull()
  })

  it('economicSymbolOf reads the three spellings a caller may hold, and nothing else', () => {
    expect(economicSymbolOf('econ:USCPI')).toBe('USCPI')
    expect(economicSymbolOf('ECON:USCPI')).toBe('USCPI')
    expect(economicSymbolOf('USCPI')).toBe('USCPI')
    expect(economicSymbolOf('sym:USCPI:close')).toBeNull()
    expect(economicSymbolOf('fund:USCPI')).toBeNull()
    expect(economicSymbolOf('ECON:AAPL:close')).toBeNull()
    expect(economicSymbolOf('')).toBeNull()
  })
})

describe('⛔⛔ econ is never routed to another lane', () => {
  it('is not a symbol source: symbolsNeeded (the /api/bars fetch list) ignores it', () => {
    expect(symbolsNeeded([inst('econ:USCPI'), inst('sym:QQQ:close', 'q')], defOf)).toEqual(['QQQ'])
    expect(symbolsNeeded([inst('econ:SPY')], defOf)).toEqual([])      // even a ticker-shaped econ symbol
  })

  it('is not a fundamental: fundamentalsNeeded ignores it', () => {
    expect(fundamentalsNeeded([parseSource('econ:USCPI')], 'AAPL')).toEqual({})
  })

  it('is not candle-capable', () => {
    expect(ohlcCapabilityOf(defOf('dataSeries'), parseSource('econ:USCPI'), { bars: [{ t: '2026-01-02', o: 1, h: 2, l: 0, c: 1 }] }, () => 'security').ok)
      .toBe(false)
  })

  it('a sym: and a fund: string are never read as econ (the prefixes do not overlap)', () => {
    expect(parseSource('sym:USCPI:close').kind).toBe('symbol')
    expect(parseSource('fund:net_margin').kind).toBe('fundamental')
    expect(parseEconomicSource('sym:USCPI:close')).toBeNull()
    expect(parseEconomicSource('fund:USCPI')).toBeNull()
  })

  it('the stored value stays representable in the source picker', () => {
    const groups = sourceOptions({ indicatorInstances: [] }, defOf, 'self', 'econ:USCPI')
    const econ = groups.find((g) => g.label === 'Economic')
    expect(econ.options).toEqual([{ value: 'econ:USCPI', label: 'USCPI' }])
  })

  it('a dataSeries over econ names itself after the series symbol', () => {
    expect(instanceLabel(defOf('dataSeries'), inst('econ:USCPI'))).toBe('USCPI')
  })
})
