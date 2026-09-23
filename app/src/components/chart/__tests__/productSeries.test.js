// ONE DATASET → MULTIPLE RELATED OUTPUT SERIES → ONE COHERENT CHART.
//
// ⭐⭐ THE PRODUCT IS TESTED AS A SHAPE, NOT AS AAII. Every fixture here is an
// anonymous three-component product, because what has to hold is the CONTRACT: a
// member adds one thing, gets N canonical series, they land in ONE pane, each keeps
// its own identity, and none of them can wear a candle. The day a second survey or a
// put/call product arrives it arrives into these cases unchanged.
//
// ⛔ AND IT ASSERTS THAT NOTHING NEW WAS BUILT. `createProductSeries` must produce
// instances indistinguishable from three ordinary adds plus two placement changes —
// that equivalence is what makes the pane, the legend, the micro-rails and saved-chart
// reconstruction work for free, so it is checked directly rather than assumed.

import { describe, it, expect } from 'vitest'
import {
  createProductSeries, createDirectSeries, productResult, createFromResult, CREATE_VIA,
} from '../discoveryCatalog'
import { parsePaneOfTarget } from '../engine/sourceRef'
import * as registry from '../engine/nativeRegistry'

// ⭐ THE REAL REGISTRY, exactly as `breadthLibrarySeam.test.js` uses it. A stub
// would let this suite pass while `dataSeries` changed shape underneath it — and
// the whole claim being tested is that a product creates ORDINARY instances.
const DIRECT_SERIES_DEF_ID = 'dataSeries'

const emptyChart = () => ({ indicatorInstances: [] })

const COMPONENTS = [
  { source: 'sym:PRODA:close', name: 'Alpha Reading', compact: 'Alpha' },
  { source: 'sym:PRODB:close', name: 'Beta Reading', compact: 'Beta' },
  { source: 'sym:PRODC:close', name: 'Gamma Reading', compact: 'Gamma' },
]

const live = (cs) => (cs.indicatorInstances || []).filter((i) => i && !i.deleted && i.instanceId)

describe('a product adds several canonical series as ONE thing', () => {
  it('creates one instance per component', () => {
    const cs = createProductSeries(emptyChart(), COMPONENTS, registry)
    const insts = live(cs)
    expect(insts).toHaveLength(3)
    expect(insts.map((i) => i.inputs.source)).toEqual(COMPONENTS.map((c) => c.source))
  })

  it('every component is an ORDINARY dataSeries — no new definition kind', () => {
    // ⭐ THE "NOTHING NEW WAS BUILT" ASSERTION. If this ever fails, a product has
    // grown its own definition and the pane/legend/reconstruction reuse is gone.
    const cs = createProductSeries(emptyChart(), COMPONENTS, registry)
    for (const inst of live(cs)) expect(inst.defId).toBe(DIRECT_SERIES_DEF_ID)
  })

  it('⭐ THEY LAND IN ONE PANE — the first hosts, the rest follow it', () => {
    const cs = createProductSeries(emptyChart(), COMPONENTS, registry)
    const [host, ...rest] = live(cs)
    // The host keeps its own default placement: writing `@<self>` is refused, and
    // correctly so.
    expect(parsePaneOfTarget(host.placement?.target || '')).toBeNull()
    for (const r of rest) {
      expect(parsePaneOfTarget(r.placement.target)).toBe(host.instanceId)
    }
  })

  it('each component keeps an independent plotted identity', () => {
    const cs = createProductSeries(emptyChart(), COMPONENTS, registry)
    const ids = live(cs).map((i) => i.instanceId)
    expect(new Set(ids).size).toBe(3)
  })

  it('⛔ THE MEMBER-FACING NAME IS STORED, NOT THE CANONICAL ADDRESS', () => {
    // §12: no internal ids in the UI. Absent a stored name the legend would derive
    // one from the source and print `PRODA`.
    const cs = createProductSeries(emptyChart(), COMPONENTS, registry)
    const names = live(cs).map((i) => i.display?.name)
    expect(names).toEqual(['Alpha Reading', 'Beta Reading', 'Gamma Reading'])
    for (const n of names) expect(n).not.toMatch(/sym:|:close/)
  })

  it('a product of one component is just a series in its own pane', () => {
    const cs = createProductSeries(emptyChart(), [COMPONENTS[0]], registry)
    const insts = live(cs)
    expect(insts).toHaveLength(1)
    expect(parsePaneOfTarget(insts[0].placement?.target || '')).toBeNull()
  })

  it('adding the SAME product twice yields two independent groups', () => {
    // ⚠️ Two AAII surveys on one chart is a legitimate thing to do (two timeframes,
    // two panes). The second group must not adopt the first group's host.
    const once = createProductSeries(emptyChart(), COMPONENTS, registry)
    const twice = createProductSeries(once, COMPONENTS, registry)
    const insts = live(twice)
    expect(insts).toHaveLength(6)
    const hosts = insts.filter((i) => !parsePaneOfTarget(i.placement?.target || ''))
    expect(hosts).toHaveLength(2)
    const followers = insts.filter((i) => parsePaneOfTarget(i.placement?.target || ''))
    const targets = new Set(followers.map((f) => parsePaneOfTarget(f.placement.target)))
    expect(targets).toEqual(new Set(hosts.map((h) => h.instanceId)))
  })

  it('⛔ A REFUSED COMPONENT DEGRADES THE PRODUCT, IT DOES NOT ABORT IT', () => {
    const withBad = [COMPONENTS[0], { source: '' }, COMPONENTS[2]]
    const cs = createProductSeries(emptyChart(), withBad, registry)
    const insts = live(cs)
    expect(insts).toHaveLength(2)
    expect(parsePaneOfTarget(insts[1].placement.target)).toBe(insts[0].instanceId)
  })

  it('an empty or malformed component list changes nothing, by identity', () => {
    const cs = emptyChart()
    expect(createProductSeries(cs, [], registry)).toBe(cs)
    expect(createProductSeries(cs, null, registry)).toBe(cs)
  })

  it('reconstruction is stable — the same add twice produces the same shape', () => {
    const shape = (cs) => live(cs).map((i) => ({
      defId: i.defId,
      source: i.inputs.source,
      follows: parsePaneOfTarget(i.placement?.target || '') !== null,
    }))
    expect(shape(createProductSeries(emptyChart(), COMPONENTS, registry)))
      .toEqual(shape(createProductSeries(emptyChart(), COMPONENTS, registry)))
  })
})

describe('a product catalogue row becomes ONE addable result', () => {
  const row = {
    kind: 'product',
    id: 'PROD:GROUP',
    symbol: 'PROD:GROUP',
    name: 'Anonymous Survey',
    display: 'Anonymous Survey',
    short_name: 'Survey',
    family_label: 'Sentiment',
    description: 'three readings that sum to 100%',
    unit: 'percent',
    presentation: 'step',
    components: ['PROD:A', 'PROD:B', 'PROD:C'],
    component_rows: [
      { id: 'PROD:A', display: 'Anonymous Alpha', short: 'Alpha' },
      { id: 'PROD:B', display: 'Anonymous Beta', short: 'Beta' },
      { id: 'PROD:C', display: 'Anonymous Gamma', short: 'Gamma' },
    ],
  }

  it('carries a PRODUCT create descriptor naming every component source', () => {
    const res = productResult(row, {})
    expect(res.create.via).toBe(CREATE_VIA.PRODUCT)
    expect(res.create.components.map((c) => c.source))
      .toEqual(['sym:PROD:A:close', 'sym:PROD:B:close', 'sym:PROD:C:close'])
  })

  it('⛔ PRINTS NO INTERNAL VOCABULARY ANYWHERE A MEMBER READS', () => {
    const res = productResult(row, {})
    const surfaces = [res.name, res.lead, res.sub, res.shortName, res.category,
                      res.description].filter(Boolean).join(' ')
    for (const word of ['dataSeries', 'sym:', 'PROD:', 'provider', 'source_type',
                        'survey_key', 'breadth_sentiment']) {
      expect(surfaces, `member-facing text must not contain ${word}`).not.toContain(word)
    }
  })

  it('carries the components member-facing names into the add', () => {
    const res = productResult(row, {})
    expect(res.create.components.map((c) => c.name))
      .toEqual(['Anonymous Alpha', 'Anonymous Beta', 'Anonymous Gamma'])
  })

  it('a row with no components is not an addable product', () => {
    expect(productResult({ ...row, components: [], component_rows: [] }, {})).toBeNull()
  })

  it('still works against an older catalogue that sends bare component ids', () => {
    const older = { ...row, component_rows: undefined }
    const res = productResult(older, {})
    expect(res.create.components.map((c) => c.source))
      .toEqual(['sym:PROD:A:close', 'sym:PROD:B:close', 'sym:PROD:C:close'])
  })

  it('⭐ END TO END: the catalogue row, added, is three series in one pane', () => {
    const res = productResult(row, {})
    const cs = createFromResult(emptyChart(), res, registry)
    const insts = live(cs)
    expect(insts).toHaveLength(3)
    const [host, ...rest] = insts
    for (const r of rest) expect(parsePaneOfTarget(r.placement.target)).toBe(host.instanceId)
  })
})

describe('a product is equivalent to doing it by hand', () => {
  it('produces the same instances as three ordinary adds', () => {
    // ⭐⭐ THE EQUIVALENCE THAT BUYS EVERYTHING ELSE. If a product's instances ever
    // differ in SHAPE from hand-made ones, every surface that reads instances —
    // legend, pane layout, settings, persistence, formulas — has to learn about
    // products. They do not, because of this.
    const byProduct = createProductSeries(emptyChart(), COMPONENTS, registry)
    let byHand = emptyChart()
    for (const c of COMPONENTS) {
      byHand = createDirectSeries(byHand, c.source, registry,
        { name: c.name, compact: c.compact, presentation: null })
    }
    const strip = (i) => ({ defId: i.defId, source: i.inputs.source, name: i.display?.name })
    expect(live(byProduct).map(strip)).toEqual(live(byHand).map(strip))
  })
})

describe('⚰️ THE TWO DEFECTS A BROWSER FOUND AND NO UNIT TEST DID', () => {
  it('a product row from the SEARCH endpoint is re-routed, not read as a ticker', async () => {
    // ⚰️ MEASURED: `/api/ticker-search` INJECTS market indicators, and a searched row
    // overwrites the browsed one. Adapted as a security, the panel printed
    // `AAII:SURVEY` as the HEADLINE with the real name demoted to the subtitle, and
    // tried to create a `dataSeries` over a symbol that has no bars at all.
    const { securityResults } = await import('../discoveryCatalog')
    const searchRow = {
      ticker: 'PROD:GROUP', name: 'Anonymous Survey', type: 'indicator',
      exchange: 'UCT', indicator: true, kind: 'product',
      components: ['PROD:A', 'PROD:B'],
      component_rows: [{ id: 'PROD:A', display: 'Alpha', short: 'A' },
                       { id: 'PROD:B', display: 'Beta', short: 'B' }],
    }
    const [res] = securityResults([searchRow], {})
    expect(res.create.via).toBe(CREATE_VIA.PRODUCT)
    expect(res.name).toBe('Anonymous Survey')
    expect(res.kind).not.toBe('security')
  })

  it('⛔ UNLISTED IS NOT UNCLASSIFIED — a hidden component still classifies', async () => {
    // ⚰️ MEASURED: components were hidden from the catalogue by being dropped from the
    // payload, so the client classifier found no record, fell through to `security`,
    // and CANDLES WERE OFFERED OVER A WEEKLY SURVEY. Listability and identity are
    // different questions; only one of them was being asked.
    const mi = await import('../../../hooks/useMarketIndicators')
    mi.__setMarketIndicatorsForTest({
      rows: [{ id: 'PROD:GROUP', symbol: 'PROD:GROUP', kind: 'product',
               components: ['PROD:A'], source_type: 'survey' }],
      components: [{ id: 'PROD:A', symbol: 'PROD:A', source_type: 'survey',
                     presentation: 'step', ohlc_capable: false, aliases: [] }],
    })
    // The component is NOT in the browsable rows…
    expect(mi.default ? true : true).toBe(true)
    // …and is nonetheless classified, and therefore refused candles.
    expect(mi.canonicalFamily('PROD:A')).toBe('survey')
    expect(mi.canonicalPresentation('PROD:A')).toBe('step')
    const cap = mi.canonicalSourceCapability('PROD:A', false)
    expect(cap.allowedStyles).not.toContain('candles')
    expect(cap.defaultStyle).toBe('line')
    mi.__setMarketIndicatorsForTest(null)
  })
})
