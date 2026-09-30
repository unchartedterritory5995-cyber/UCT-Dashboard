import { describe, test, expect } from 'vitest'
import {
  economicResults, tabOf, glyphFamilyOf, glyphNameOf, LIBRARY_TABS, libraryTabsFor, ECONOMIC_TAB,
  createFromResult, resultsForTab, semanticNamesFor, FAMILY_DEFAULT_PLOT_STYLE, liveDiscoveryRows,
} from './discoveryCatalog'
import { matches } from './IndicatorLibraryDialog'
import * as registry from './engine/nativeRegistry'
import { CHART_DEFAULTS } from './chartDefaults'
import { parseSource } from './engine/sourceRef'
import { CATALOG } from './economic/__fixtures__/econCatalog'

const results = () => economicResults(CATALOG.series)
const byId = (id) => results().find((r) => r.id === id)

describe('the Economic tab is dark by construction', () => {
  test('without economics the tab list IS LIBRARY_TABS (identity) — five tabs, unchanged', () => {
    expect(libraryTabsFor()).toBe(LIBRARY_TABS)
    expect(libraryTabsFor({ economic: false })).toBe(LIBRARY_TABS)
    expect(LIBRARY_TABS.map((t) => t.key)).toEqual(['technical', 'fundamentals', 'breadth', 'symbols', 'positioning'])
  })
  test('with economics: the sixth tab, appended', () => {
    const tabs = libraryTabsFor({ economic: true })
    expect(tabs.map((t) => t.label)).toEqual(['Technical', 'Fundamentals', 'Breadth', 'Symbols', 'Positioning', 'Economic'])
    expect(tabs[5]).toBe(ECONOMIC_TAB)
    expect(libraryTabsFor({ economic: true })).toBe(tabs)
  })
  test('no catalogue rows -> no results', () => {
    expect(economicResults(null)).toEqual([])
    expect(economicResults([])).toEqual([])
  })
})

describe('economicResults — fundamentalResults\' twin', () => {
  test('one row per member series, deduped, econ: source, kind economic, economic tab', () => {
    const rs = economicResults([...CATALOG.series, CATALOG.series[0]])
    expect(rs).toHaveLength(CATALOG.series.length)
    for (const r of rs) {
      expect(r.kind).toBe('economic')
      expect(r.key).toBe(`economic:${r.id}`)
      expect(tabOf(r)).toBe('economic')
      expect(glyphFamilyOf(r)).toBe('economic')
      expect(glyphNameOf(r)).toBe('ind-series')
      expect(parseSource(r.create.source)).toEqual({ kind: 'economic', symbol: r.id })
    }
    expect(resultsForTab(rs, 'economic')).toHaveLength(rs.length)
    expect(resultsForTab(rs, 'symbols')).toHaveLength(0)
  })

  test('clean name, display symbol, agency · frequency · units subtitle', () => {
    const r = byId('USCPI')
    expect(r.name).toBe('CPI-U All Items (SA)')
    expect(r.shortName).toBe('USCPI')
    expect(r.sub).toBe('BLS · Monthly · Index')
    expect(r.category).toBe('Inflation & Prices')
  })

  test('registry style rides the create descriptor — the family default (area) never wins', () => {
    expect(FAMILY_DEFAULT_PLOT_STYLE.economic).toBe('area')
    expect(byId('USFEDFUNDSU').create.presentation).toEqual({ plotStyle: 'step' })
    expect(byId('USRGDPQA').create.presentation).toEqual({ plotStyle: 'histogram' })
    expect(byId('USCPI').create.presentation).toEqual({ plotStyle: 'line' })
  })

  test('names: list = short name, pane legend = display symbol', () => {
    expect(semanticNamesFor(byId('USICSA'))).toEqual({ full: 'Initial Jobless Claims', compact: 'USICSA' })
  })

  test('search matches name, symbol, aliases, synonyms and hyphenated variants', () => {
    const rs = results()
    const find = (q) => liveDiscoveryRows(q, [], rs, matches).map((r) => r.id)
    expect(find('CPI')).toContain('USCPI')
    expect(find('inflation')).toContain('USCPI')
    expect(find('fed funds')).toContain('USFEDFUNDSU')
    expect(find('10-year treasury')).toContain('UST10Y')
    expect(find('10 year treasury')).toContain('UST10Y')
    expect(find('initial claims')).toContain('USICSA')
    expect(find('gdp growth')).toContain('USRGDPQA')
    expect(find('zzzz')).toEqual([])
    // browse = everything when the box is empty
    expect(find('')).toHaveLength(rs.length)
  })
})

describe('creation — through the member\'s one door (createFromResult)', () => {
  test('creates ONE dataSeries over econ:<SYM> with the registry style and its names', () => {
    const cs = { ...CHART_DEFAULTS, indicatorInstances: [] }
    const next = createFromResult(cs, byId('USFEDFUNDSU'), registry)
    expect(next).not.toBe(cs)
    const added = next.indicatorInstances.filter((i) => i && !i.removed)
    expect(added).toHaveLength(1)
    const inst = added[0]
    expect(inst.defId).toBe('dataSeries')
    expect(inst.inputs.source).toBe('econ:USFEDFUNDSU')
    expect(inst.presentation).toEqual({ plotStyle: 'step' })
    // own pane by default (dataSeries is autoPane) — no price-pane placement stamped
    expect(inst.placement && inst.placement.target).not.toBe('price')
  })

  test('never candles: the canonical source is not a symbol source', () => {
    const cs = { ...CHART_DEFAULTS, indicatorInstances: [] }
    const inst = createFromResult(cs, byId('USCPI'), registry).indicatorInstances[0]
    expect(parseSource(inst.inputs.source).kind).toBe('economic')
    expect(inst.inputs.source).toBe('econ:USCPI')
    expect(inst.inputs.source).not.toMatch(/^sym:/)
  })
})
