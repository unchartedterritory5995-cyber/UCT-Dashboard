// Breadth finishing pass (2026-10-07): universe chips, server-metadata tooltips, the library
// join, the signed-domain lookup and the sign-safe percent change.
import { describe, it, expect, afterEach } from 'vitest'

import CATALOG from './__fixtures__/breadthLibraryRows.json'
import { breadthResults, symbolLibraryRow, withLibraryMetadata, breadthTooltip, marketIndicatorResults } from './discoveryCatalog'
import { __setBreadthSymbolsForTest } from '../../hooks/useBreadthSymbols'
import { __setMarketIndicatorsForTest, canonicalDomain } from '../../hooks/useMarketIndicators'
import { signSafeChangePct } from '../StockChart'

const ROWS = CATALOG.rows
const row = (sym) => ROWS.find((r) => r.symbol === sym)
const UNIVERSES = [
  { id: 'uct', label: 'UCT', first: '2008-01-02', last: '2026-10-07' },
  { id: 'nyse', label: 'NYSE', first: '2009-06-11', last: '2026-10-05' },
]

afterEach(() => { __setBreadthSymbolsForTest(null); __setMarketIndicatorsForTest(null) })

describe('every breadth row names its population', () => {
  it('four "New 52-Week Highs" rows read UCT / US / NASDAQ / NYSE, browse and search alike', () => {
    const res = breadthResults(['UCTNH', 'US:NH', 'NASDAQ:NH', 'NYSE:NH'].map(row))
    expect(res.map((r) => r.chip)).toEqual(['UCT', 'US', 'NASDAQ', 'NYSE'])
    expect(res.map((r) => symbolLibraryRow(r).shortName)).toEqual(['UCT', 'US', 'NASDAQ', 'NYSE'])
    // the series' NAME on the chart is unchanged: a legacy row keeps its symbol, a namespaced
    // row its universe (pane legend)
    expect(res.map((r) => r.shortName)).toEqual(['UCTNH', 'US', 'NASDAQ', 'NYSE'])
  })

  it('a legacy symbols-map row (no universe key) is UCT', () => {
    const [r] = breadthResults([{ symbol: 'UCTA50', name: '% of Stocks Above 50-Day MA', group_label: 'MA Breadth' }])
    expect(r.chip).toBe('UCT')
  })

  it('a market-indicator row keeps its own name and no population chip', () => {
    const [r] = marketIndicatorResults([{ symbol: 'NYSE:MCO', display: 'NYSE · McClellan Oscillator', short: 'NYSE McClellan',
      family: 'mcclellan', family_label: 'McClellan', domain: 'signed', universe: 'nyse',
      methodology: 'Ratio-adjusted net advances …', history_start: '2009-06-11' }], { universes: UNIVERSES })
    expect(r.chip).toBeUndefined()
    expect(r.description.split('\n')).toEqual([
      'NYSE · McClellan Oscillator (NYSE:MCO)',
      'Ratio-adjusted net advances …',
      'History from Jun 11, 2009 · data through Oct 5, 2026',
    ])
  })
})

describe('the hover is server metadata, line by line', () => {
  it('universe · name (symbol) / what it measures / the population / history · data through', () => {
    const r = row('NYSE:NH')
    const tip = breadthTooltip(r, { universes: UNIVERSES, sym: 'NYSE:NH', name: r.name, universeLabel: 'NYSE' }).split('\n')
    expect(tip[0]).toBe('NYSE · New 52-Week Highs (NYSE:NH)')
    expect(tip[1]).toBe(r.description)
    expect(tip[2]).toBe(r.universe_description)
    expect(tip[3]).toBe('History from Jun 11, 2009 · data through Oct 5, 2026')
    expect(r.description).toMatch(/52-week high/)
  })

  it('an older payload with no metadata degrades to the bare name, never invented prose', () => {
    expect(breadthTooltip({ symbol: 'X' }, { name: 'Thing' })).toBe('Thing')
  })

  it('browse rows gain the library metadata without changing a key they already had', () => {
    const symbolsRows = [{ symbol: 'NYSE:NH', name: 'New 52-Week Highs', group: 'highs_lows', universe: 'nyse', universe_label: 'NYSE' }]
    const [j] = withLibraryMetadata(symbolsRows, { rows: ROWS })
    expect(j.description).toBe(row('NYSE:NH').description)
    expect(j.name).toBe('New 52-Week Highs')
    expect(withLibraryMetadata(symbolsRows, { rows: [] })).toBe(symbolsRows)
  })
})

describe('signed series have no percent change', () => {
  it('signSafeChangePct', () => {
    expect(signSafeChangePct(5, 100, false)).toBeCloseTo(5)
    expect(signSafeChangePct(-19, -125, false)).toBeNull()     // the "−129.03%" class
    expect(signSafeChangePct(10, 0, false)).toBeNull()
    expect(signSafeChangePct(10, 100, true)).toBeNull()       // signed domain: point change only
    expect(signSafeChangePct(Number.NaN, 100, false)).toBeNull()
  })

  it('canonicalDomain reads the market-indicator registry first, then the breadth library', () => {
    __setBreadthSymbolsForTest(null)
    expect(canonicalDomain('US:NETHL')).toBeNull()             // nothing loaded: no claim
    __setMarketIndicatorsForTest({ rows: [{ id: 'NYSE:MCO', symbol: 'NYSE:MCO', domain: 'signed' }], families: [], dormant: [] })
    expect(canonicalDomain('NYSE:MCO')).toBe('signed')
    expect(canonicalDomain('AAPL')).toBeNull()
  })
})
