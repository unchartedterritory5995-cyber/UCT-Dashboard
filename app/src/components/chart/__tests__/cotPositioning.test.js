// COT POSITIONING → CHART PANES.
//
// ⭐ ONE ADD, ONE LOGICAL INDICATOR, THREE ORDINARY PANES. A COT dataset arrives from
// the Market Indicators catalogue as a PRODUCT row (`family: 'positioning'`,
// `pane_layout: 'separate'`, `grouped: true`). These cases hold the contract from the
// catalogue row to the stored blob:
//
//   · it files under the Positioning tab and is found by the words a member types
//   · adding it creates exactly three `dataSeries` instances, in pane order, each in
//     a pane of its own, each a HISTOGRAM in its COT category colour
//   · the three are ONE indicator: removing or hiding any part acts on all three
//   · the blob survives `mergeChartSettings` and never restores twice
//
// The row literals below are the exact shape `discovery.product_row` emits
// (`tests/test_market_indicators_cot.py` pins the server half).

import { describe, it, expect } from 'vitest'
import {
  marketIndicatorResults, createFromResult, tabOf, resultsForTab, LIBRARY_TABS,
  FAMILY_DEFAULT_PLOT_STYLE, productResult, glyphFamilyOf, symbolLibraryRow,
  CREATE_VIA, PRODUCT_LAYOUT,
} from '../discoveryCatalog'
import {
  removeInstance, setInstanceHidden, duplicateInstance, findInstance, groupMemberIds,
  addInstance,
} from '../engine/instanceControls'
import { resolveDisplayTarget, paneOwnerOf, paneOwnKeys } from '../engine/displayTarget'
import { resolvePlotStyle } from '../engine/presentation'
import { normalizeInstances } from '../engine/instances'
import { mergeChartSettings } from '../chartDefaults'
import { matches } from '../IndicatorLibraryDialog'
import { SERIES_COLORS } from '../../../pages/cot/cotPalette'
import * as registry from '../engine/nativeRegistry'

const cotRow = (sym, name, extra = {}) => ({
  id: `COT:${sym}`, kind: 'product', symbol: `COT:${sym}`,
  display: `${name} COT`, short: `${sym} COT`,
  family: 'positioning', family_label: 'Positioning',
  source_type: 'cot', frequency: 'weekly', unit: 'contracts', domain: 'signed',
  presentation: 'histogram', pane_layout: 'separate', grouped: true,
  description: `CFTC Commitments of Traders for ${name} futures.`,
  components: [`COT:${sym}:COMM`, `COT:${sym}:LARGE`, `COT:${sym}:SMALL`],
  component_rows: [
    { id: `COT:${sym}:COMM`, display: `${name} COT · Commercials`, short: 'Commercials',
      presentation: 'histogram', domain: 'signed', palette: 'cot.commercials' },
    { id: `COT:${sym}:LARGE`, display: `${name} COT · Large Speculators`,
      short: 'Large Speculators', presentation: 'histogram', domain: 'signed',
      palette: 'cot.largeSpecs' },
    { id: `COT:${sym}:SMALL`, display: `${name} COT · Small Speculators`,
      short: 'Small Speculators', presentation: 'histogram', domain: 'signed',
      palette: 'cot.smallSpecs' },
  ],
  tags: ['COT', 'COMMITMENTS OF TRADERS', 'CFTC', 'POSITIONING', name.toUpperCase()],
  aliases: [`COT:${sym}`], status: 'published', ohlc_capable: false, has_ohlc: false,
  ...extra,
})

const NQ = cotRow('NQ', 'Nasdaq-100 E-Mini')
const ES = cotRow('ES', 'S&P 500 E-Mini')
const AAII = {
  id: 'AAII:SURVEY', kind: 'product', symbol: 'AAII:SURVEY', display: 'AAII Sentiment Survey',
  short: 'AAII Survey', family: 'sentiment', family_label: 'Sentiment & Positioning',
  presentation: 'step', pane_layout: 'shared', grouped: false,
  components: ['AAII:BULLS', 'AAII:BEARS', 'AAII:NEUTRAL'],
  component_rows: [
    { id: 'AAII:BULLS', display: 'AAII Bullish', short: 'Bullish', presentation: 'step' },
    { id: 'AAII:BEARS', display: 'AAII Bearish', short: 'Bearish', presentation: 'step' },
    { id: 'AAII:NEUTRAL', display: 'AAII Neutral', short: 'Neutral', presentation: 'step' },
  ],
}

const live = (cs) => (cs.indicatorInstances || []).filter((i) => i && !i.deleted && i.instanceId)
const resultFor = (row) => marketIndicatorResults([row])[0]
const addCot = (cs = { indicatorInstances: [] }, row = NQ) =>
  createFromResult(cs, resultFor(row), registry)
const cotParts = (cs) => live(cs).filter((i) => String(i.inputs?.source || '').startsWith('sym:COT:'))

describe('discovery — the Positioning category', () => {
  it('Positioning is the last tab; Indexes folded into Symbols to make room', () => {
    expect(LIBRARY_TABS.map((t) => t.label)).toEqual(
      ['Technical', 'Fundamentals', 'Breadth', 'Symbols', 'Positioning'])
    for (const category of ['stock', 'etf', 'index']) {
      expect(tabOf({ kind: 'security', category })).toBe('symbols')
    }
  })

  it('a COT product row is a positioning result filed under that tab', () => {
    const res = resultFor(NQ)
    expect(res.kind).toBe('positioning')
    expect(res.key).toBe('positioning:COT:NQ')
    expect(tabOf(res)).toBe('positioning')
    expect(res.name).toBe('Nasdaq-100 E-Mini COT')
    expect(res.category).toBe('Positioning')
    expect(res.create.via).toBe(CREATE_VIA.PRODUCT)
    expect(res.create.layout).toBe(PRODUCT_LAYOUT.PANES)
    expect(res.create.group).toEqual({ name: 'Nasdaq-100 E-Mini COT' })
  })

  it('every COT dataset lands in Positioning and nowhere else', () => {
    const all = marketIndicatorResults([NQ, ES, AAII])
    expect(resultsForTab(all, 'positioning').map((r) => r.id)).toEqual(['COT:NQ', 'COT:ES'])
    expect(resultsForTab(all, 'breadth').map((r) => r.id)).toEqual(['AAII:SURVEY'])
  })

  it('draws the histogram-about-zero mark and leads with its name, not its address', () => {
    const res = resultFor(NQ)
    expect(glyphFamilyOf(res)).toBe('momentum')
    const row = symbolLibraryRow(res)
    expect(row.name).toBe('Nasdaq-100 E-Mini COT')
    expect(row.name).not.toMatch(/COT:/)
    expect(row.category).toBe('Positioning')
  })

  it.each(['COT', 'Nasdaq', 'Nasdaq-100', 'E-mini', 'Commercials', 'Positioning',
    'large speculators'])('the search box finds it by %s', (q) => {
    expect(matches(resultFor(NQ), q)).toBe(true)
  })

  it('search yields ONE row per dataset — the parts are never results', () => {
    const all = marketIndicatorResults([NQ, ES])
    const hits = all.filter((r) => matches(r, 'Commercials'))
    expect(hits.map((r) => r.id)).toEqual(['COT:NQ', 'COT:ES'])
  })
})

describe('adding one COT dataset', () => {
  it('creates exactly three ordinary dataSeries, in COT pane order', () => {
    const parts = cotParts(addCot())
    expect(parts).toHaveLength(3)
    expect(parts.map((i) => i.defId)).toEqual(['dataSeries', 'dataSeries', 'dataSeries'])
    expect(parts.map((i) => i.inputs.source)).toEqual(
      ['sym:COT:NQ:COMM:close', 'sym:COT:NQ:LARGE:close', 'sym:COT:NQ:SMALL:close'])
    expect(parts.map((i) => i.display.compact)).toEqual(
      ['Commercials', 'Large Speculators', 'Small Speculators'])
  })

  it('each part is a pane of its OWN — three panes, not one shared', () => {
    const cs = addCot()
    const parts = cotParts(cs)
    for (const p of parts) {
      expect(resolveDisplayTarget(p, cs)).toBe('pane')
      expect(paneOwnerOf(p, cs)).toBe(p.instanceId)
    }
    const own = paneOwnKeys(cs.indicatorInstances, cs)
    expect(parts.every((p) => own.has(p.instanceId))).toBe(true)
  })

  it('⭐ ALL THREE DEFAULT TO HISTOGRAM', () => {
    const parts = cotParts(addCot())
    const def = registry.getDefinition('dataSeries')
    for (const p of parts) {
      expect(p.presentation?.plotStyle).toBe('histogram')
      expect(resolvePlotStyle(p, def.plots[0])).toBe('histogram')
      // ⛔ The category colour IS the identity — no green/red sign colouring over it.
      expect(p.presentation?.signColors).toBeUndefined()
    }
  })

  it('the family floor is histogram too, so no path creates COT as Area', () => {
    expect(FAMILY_DEFAULT_PLOT_STYLE.positioning).toBe('histogram')
    // A row that forgot its per-component presentation still arrives as a histogram.
    const bare = cotRow('NQ', 'Nasdaq-100 E-Mini', {
      presentation: undefined,
      component_rows: NQ.component_rows.map(({ presentation: _p, domain: _d, ...c }) => c),
    })
    for (const p of cotParts(addCot(undefined, bare))) {
      expect(p.presentation?.plotStyle).toBe('histogram')
    }
  })

  it('wears the COT tab’s own category colours', () => {
    const parts = cotParts(addCot())
    expect(parts.map((i) => i.inputs.color)).toEqual([
      SERIES_COLORS.commercials, SERIES_COLORS.largeSpecs, SERIES_COLORS.smallSpecs])
  })

  it('the three share ONE group, named for the dataset', () => {
    const parts = cotParts(addCot())
    const ids = new Set(parts.map((p) => p.group?.id))
    expect(ids.size).toBe(1)
    expect([...ids][0]).toBe(`grp:${parts[0].instanceId}`)
    expect(parts.every((p) => p.group.name === 'Nasdaq-100 E-Mini COT')).toBe(true)
  })

  it('an explicit member style still wins after creation', () => {
    const cs = addCot()
    const [first] = cotParts(cs)
    const def = registry.getDefinition('dataSeries')
    const lined = { ...first, presentation: { plotStyle: 'line' } }
    expect(resolvePlotStyle(lined, def.plots[0])).toBe('line')
  })
})

describe('one logical indicator', () => {
  it('removing ANY part removes all three, and nothing else', () => {
    const withRsi = addInstance({ indicatorInstances: [] }, 'rsi', registry)
    const cs = addCot(withRsi)
    for (const idx of [0, 1, 2]) {
      const target = cotParts(cs)[idx]
      const next = removeInstance(cs, target.instanceId, registry)
      expect(cotParts(next)).toHaveLength(0)
      expect(live(next).map((i) => i.defId)).toEqual(['rsi'])
    }
  })

  it('hiding ANY part hides all three; showing brings all three back', () => {
    const cs = addCot()
    const [, mid] = cotParts(cs)
    const hidden = setInstanceHidden(cs, mid.instanceId, true, registry)
    expect(cotParts(hidden).every((p) => p.hidden === true)).toBe(true)
    expect(paneOwnKeys(hidden.indicatorInstances, hidden).size).toBe(0)
    const shown = setInstanceHidden(hidden, cotParts(hidden)[2].instanceId, false, registry)
    expect(cotParts(shown).every((p) => p.hidden === false)).toBe(true)
  })

  it('an ungrouped instance still acts alone', () => {
    let cs = addInstance({ indicatorInstances: [] }, 'rsi', registry)
    cs = addInstance(cs, 'rsi', registry)
    const [a] = live(cs)
    expect(groupMemberIds(cs, a.instanceId).size).toBe(1)
    expect(live(removeInstance(cs, a.instanceId, registry))).toHaveLength(1)
  })

  it('a duplicate of one part is a standalone series, not a fourth member', () => {
    const cs = addCot()
    const [first] = cotParts(cs)
    const dup = duplicateInstance(cs, first.instanceId, registry)
    const copy = cotParts(dup).find((p) => !cotParts(cs).some((o) => o.instanceId === p.instanceId))
    expect(copy.group).toBeUndefined()
    expect(groupMemberIds(dup, first.instanceId).size).toBe(3)
  })

  it('adding the same dataset twice makes two independent groups (the duplicate policy)', () => {
    const twice = addCot(addCot())
    const parts = cotParts(twice)
    expect(parts).toHaveLength(6)
    expect(new Set(parts.map((p) => p.group.id)).size).toBe(2)
    const after = removeInstance(twice, parts[4].instanceId, registry)
    expect(cotParts(after)).toHaveLength(3)
  })
})

describe('persistence', () => {
  it('the blob survives mergeChartSettings with its group and presentation intact', () => {
    const cs = addCot()
    const stored = JSON.parse(JSON.stringify(cs))
    const merged = mergeChartSettings(stored)
    const parts = cotParts(merged)
    expect(parts).toHaveLength(3)
    expect(parts.map((p) => p.group.id)).toEqual(cotParts(cs).map((p) => p.group.id))
    expect(parts.every((p) => p.presentation.plotStyle === 'histogram')).toBe(true)
    // Nothing of the COT data itself is stored — only identity, style and group.
    expect(JSON.stringify(stored)).not.toMatch(/commercial_net|large_spec_net/)
  })

  it('reading the blob twice never restores six panes', () => {
    const once = mergeChartSettings(JSON.parse(JSON.stringify(addCot())))
    const twice = mergeChartSettings(JSON.parse(JSON.stringify(once)))
    expect(cotParts(twice)).toHaveLength(3)
    const { kept, dropped } = normalizeInstances(twice.indicatorInstances, registry)
    expect(dropped).toHaveLength(0)
    expect(kept.filter((i) => i.group)).toHaveLength(3)
  })

  it('a removed dataset stays removed after a round trip', () => {
    const cs = addCot()
    const gone = removeInstance(cs, cotParts(cs)[0].instanceId, registry)
    expect(cotParts(mergeChartSettings(JSON.parse(JSON.stringify(gone))))).toHaveLength(0)
  })
})

describe('AAII is untouched', () => {
  it('still one shared pane with independent, ungrouped components', () => {
    const res = productResult(AAII)
    expect(res.kind).toBe('breadth')
    expect(res.create.layout).toBeUndefined()
    expect(res.create.group).toBeUndefined()
    const cs = createFromResult({ indicatorInstances: [] }, res, registry)
    const parts = live(cs)
    expect(parts).toHaveLength(3)
    expect(parts.every((p) => !p.group)).toBe(true)
    expect(parts.slice(1).every((p) => paneOwnerOf(p, cs) === parts[0].instanceId)).toBe(true)
    // Removing one AAII component still removes only that one.
    expect(live(removeInstance(cs, parts[1].instanceId, registry))).toHaveLength(2)
  })
})
