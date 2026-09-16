// The Breadth Library ranking has TWO implementations and ONE definition.
//
// `breadth_symbols.library_search` (Python) is the reference; `searchLibrary` (JS)
// is the lane the UI uses, because a ranked list must not cost a network round-trip
// per keystroke. This rail asserts they agree on the canonical query set, from a
// GENERATED fixture — the same idiom `closedTable.json` uses for the AST's two lanes.
//
// ⛔ IF THIS GOES RED, THE TWO LANES HAVE DRIFTED. Fix the lane that is wrong and
// regenerate the fixture; do not edit the fixture to match the code.
import { describe, it, expect } from 'vitest'

import PARITY from './__fixtures__/breadthSearchParity.json'
import { searchLibrary, browseFamilies, tokens, availabilityOf } from './breadthLibrary'
import CATALOG from './__fixtures__/breadthLibraryRows.json'

const ROWS = CATALOG.rows
// ⛔ THE ORDER IS SENT, NOT RE-DERIVED. Inferring it from first appearance in `rows`
// is wrong for any metric with no symbol in the first universe — `net_new_high_low`
// has no UCT symbol, so it first appears under `us` and would sort after every UCT
// metric. That was a real parity failure, which is what this rail is for.
const METRIC_ORDER = new Map(CATALOG.metric_order.map((m, i) => [m, i]))

const syms = (q, limit = 12) =>
  searchLibrary(ROWS, q, { limit, metricOrder: METRIC_ORDER }).map((r) => r.symbol)

describe('the JS lane agrees with the Python reference', () => {
  for (const [query, expected] of Object.entries(PARITY.queries)) {
    it(`"${query}"`, () => {
      expect(syms(query, expected.length || 12)).toEqual(expected)
    })
  }
})

describe('the query shapes the product promises', () => {
  it('metric first, universe second — one metric with its variants adjacent', () => {
    expect(syms('50 day').slice(0, 4))
      .toEqual(['UCTA50', 'US:A50', 'NASDAQ:A50', 'NYSE:A50'])
  })

  it('⭐ "new lows" leads with New Lows, not with its family sibling', () => {
    // Without the metric-own-text tier both match only through "Highs / Lows" and
    // the member who typed "lows" is shown "New 52-Week Highs" first.
    expect(syms('new lows')[0]).toBe('UCTNL')
    expect(syms('new highs')[0]).toBe('UCTNH')
  })

  it('a bare universe word lists that universe and nothing else', () => {
    const got = searchLibrary(ROWS, 'NASDAQ', { limit: 200, metricOrder: METRIC_ORDER })
    expect(got.length).toBeGreaterThan(10)
    expect(new Set(got.map((r) => r.universe))).toEqual(new Set(['nasdaq']))
  })

  it('an exact identity resolves to exactly that series', () => {
    expect(syms('NASDAQ:A50')).toEqual(['NASDAQ:A50'])
    expect(syms('US:NETHL')).toEqual(['US:NETHL'])
    expect(syms('UCTA50')).toEqual(['UCTA50'])
  })

  it('⛔ a colon does not make something breadth', () => {
    expect(syms('NASDAQ:AAPL')).toEqual([])
    expect(syms('FOO:BAR')).toEqual([])
    expect(syms('AAPL')).toEqual([])
  })

  it('an empty query returns nothing rather than the whole library', () => {
    expect(syms('')).toEqual([])
    expect(syms('   ')).toEqual([])
  })

  it('results are deduped and deterministic', () => {
    const a = syms('high low', 50)
    expect(a).toEqual(syms('high low', 50))
    expect(a.length).toBe(new Set(a).size)
  })
})

describe('browse', () => {
  it('groups by family, one entry per METRIC, universes collected', () => {
    const fams = browseFamilies(ROWS)
    expect(fams.map((f) => f.label)).toContain('MA Breadth')
    const ma = fams.find((f) => f.label === 'MA Breadth')
    const a50 = ma.metrics.find((m) => m.code === 'A50')
    // ⭐ ONE idea over four populations — not four rows in a flat list.
    expect(a50.name).toBe('% of Stocks Above 50-Day MA')
    expect(a50.universes.map((u) => u.label)).toEqual(['UCT', 'US', 'NASDAQ', 'NYSE'])
    expect(a50.universes[0].symbol).toBe('UCTA50')
    expect(a50.universes[2].symbol).toBe('NASDAQ:A50')
  })

  it('carries the presentation metadata a chart needs, per metric', () => {
    const hl = browseFamilies(ROWS).find((f) => f.id === 'highs_lows')
    const nethl = hl.metrics.find((m) => m.code === 'NETHL')
    expect(nethl.domain).toBe('signed')
    expect(nethl.presentation).toBe('histogram')
    expect(nethl.unit).toBe('count')
  })

  it('a family holds no metric that does not belong to it', () => {
    for (const f of browseFamilies(ROWS)) {
      for (const m of f.metrics) {
        expect(ROWS.find((r) => r.metric === m.metric).group).toBe(f.id)
      }
    }
  })
})

describe('availability is reported, never invented', () => {
  const unis = [{ id: 'uct', state: 'available', first: '2008-01-02', last: '2026-09-14', floor: null },
                { id: 'us', state: 'not_populated', rows: 0, first: null, last: null, floor: '2008-01-02' }]
  it('reads what the payload said', () => {
    expect(availabilityOf(unis, 'uct').state).toBe('available')
    expect(availabilityOf(unis, 'us').state).toBe('not_populated')
  })
  it('⛔ says NOTHING when the payload said nothing — which is not "not populated"', () => {
    expect(availabilityOf(unis, 'nasdaq')).toBeNull()
    expect(availabilityOf(undefined, 'uct')).toBeNull()
  })
})

describe('tokeniser', () => {
  it('splits on anything that is not alphanumeric', () => {
    expect(tokens('50 day')).toEqual(['50', 'DAY'])
    expect(tokens('NASDAQ:A50')).toEqual(['NASDAQ', 'A50'])
    expect(tokens('% above 50-day')).toEqual(['%', 'ABOVE', '50', 'DAY'])
    expect(tokens('')).toEqual([])
  })
})
