// app/src/components/chart/engine/directSeriesLane.test.js
//
// ─── P2.1 §26, §27 · THE WHOLE VERTICAL, END TO END ─────────────────────────
//
//   catalogue result → instance writer → dataSeries instance → sym: source
//     → secondary fetch → projection → binder → identity compute → plot
//       → addSeries → own pane → setData
//
// ⭐⭐ THE CLAIM IS NOT "QQQ RENDERS". It is that **QQQ and UCTA50 are boringly
// identical to the engine** — same path, same binding structure, same compute —
// and that nothing anywhere learns which family it is looking at.
//
// ⛔ EVERY BEHAVIOURAL CASE RUNS TWICE, ONCE PER FAMILY. That is the Alerts
// lesson applied before the feature has a UI: two of three defects there survived
// a green suite because every fixture used one variant. `symbolBinding.test.js`
// made the same choice for `movingAverage`; this is its successor for the
// definition that computes nothing.

import { describe, it, expect, beforeEach } from 'vitest'
import { createBinder } from './binder'
import { resolvePlacement } from './placement'
import { createFakeChart, makeBars } from './__tests__/fakeChart'
import * as registry from './nativeRegistry'
import { symbolSource } from './sourceRef'
import { computePaneLayout, __setPaneModeForTest } from './paneLayout'
import { paneOwnKeys, paneFollowerKeys, resolveDisplayTarget } from './displayTarget'
import {
  clearSecondaryBars, primeSecondaryBars, ensureAll, inflightCount, cachedBars,
} from './secondaryBars'
import { mergeChartSettings } from '../chartDefaults'
import { createDirectSeries, DIRECT_SERIES_DEF_ID } from '../discoveryCatalog'

const SECURITY = 'QQQ'
const BREADTH = 'UCTA50'
const FAMILIES = [
  ['ordinary security', SECURITY],
  ['breadth pseudo-symbol', BREADTH],
]

const bars = makeBars(120)

/** Secondary bars on the SAME timeline, offset in value so a projection that
 *  silently fell back to the PRIMARY series would be unmissable. */
const secondaryFor = (offset) => bars.map((b) => ({ ...b, c: b.c + offset, v: b.v + offset }))

const instancesFor = (sources) => {
  let cs = mergeChartSettings({})
  for (const s of sources) cs = createDirectSeries(cs, s, registry)
  return (cs.indicatorInstances || []).filter((i) => i && i.deleted !== true)
}

const layoutFor = (instances) => {
  const cs = { indicatorInstances: instances }
  return computePaneLayout(instances, {
    chartHeight: 800,
    hasVolumeBand: false,
    excludeKeys: new Set([...paneFollowerKeys(instances, cs)]),
    includeKeys: paneOwnKeys(instances, cs),
    firstPaneIndex: 1,
  })
}

const ctxFor = (instances, secondary) => {
  const cs = { indicatorInstances: instances }
  const paneLayout = layoutFor(instances)
  return {
    enabled: true,
    instances,
    registry,
    bars,
    adjustTime: (t) => t,
    plan: { fresh: true },
    applyData: (series, data) => { if (series && data) series.setData(data) },
    // ⭐ THE REAL RESOLVER, through a REAL layout. A stub here would prove the
    // test's own idea of placement rather than the product's.
    resolvePlacement: (inst, def) => resolvePlacement(inst, def, {
      paneLayout,
      paneMargins: paneLayout.bands,
      volOverlaySet: new Set(),
      volSeparatePane: false,
      targetOf: (i) => resolveDisplayTarget(i, cs),
      derivedTargetOf: () => null,
    }),
    secondary,
    paneLayout,
  }
}

/** Finite values a binding actually DREW, read from the fake's call log.
 *  ⚠️ NOT from `applyData`: on a FIRST bind the binder calls `series.setData`
 *  directly whatever the plan says (binder.js "TRAP #1"). */
const drawnValues = (b, chart) => {
  if (!b || !b.series) return []
  const id = b.series.__id
  const last = [...chart.calls].reverse()
    .find((c) => c.on === 'series' && c.id === id && c.method === 'setData')
  return (last?.args?.[0] || []).map((p) => p.value).filter(Number.isFinite)
}

let fake
let binder
beforeEach(() => {
  fake = createFakeChart()
  binder = createBinder({ chart: fake.chart, LWC: fake.LWC })
  clearSecondaryBars()
  __setPaneModeForTest('panes')
})

// ─── §26, §27 · the two creation proofs, one lane ───────────────────────────

describe('⭐⭐ §26, §27 · a direct series draws its SECONDARY symbol', () => {
  it.each(FAMILIES)('%s: the plotted values are %s\'s, not the chart\'s own', (_label, sym) => {
    const offset = 1000
    const secondary = new Map([[sym, { bars: secondaryFor(offset), status: 'available' }]])
    const [inst] = instancesFor([symbolSource(sym, 'close')])

    const r = binder.sync(ctxFor([inst], secondary))
    expect(r.ok, 'the sync failed outright').toBe(true)

    const held = binder.bindings()
    expect(held, `${sym} bound nothing at all`).toHaveLength(1)
    const b = held[0]
    expect(b.defId).toBe(DIRECT_SERIES_DEF_ID)
    expect(b.plotKey).toBe('value')

    const drew = drawnValues(b, fake)
    expect(drew.length, `${sym} drew no finite values`).toBeGreaterThan(100)

    // ⛔⛔ THE ACCEPTANCE CRITERION. The identity transform means the drawn column
    // IS the secondary close, bar for bar — so every value is offset from the
    // chart's own closes by exactly the amount the fixture offset them. A
    // fallback to the primary would land on the primary's values instead, and a
    // stale/blank column would land on nothing.
    const primaryCloses = bars.map((x) => x.c)
    for (let i = 0; i < drew.length; i++) {
      expect(drew[i], `${sym} bar ${i} is not the SECONDARY value`)
        .toBeCloseTo(primaryCloses[i] + offset, 8)
    }
    expect(drew.some((v) => primaryCloses.includes(v)),
      `${sym} drew a value that belongs to the chart's own bars`).toBe(false)
  })

  it.each(FAMILIES)('%s: it takes its OWN pane, and says so to the renderer', (_label, sym) => {
    const secondary = new Map([[sym, { bars: secondaryFor(500), status: 'available' }]])
    const [inst] = instancesFor([symbolSource(sym, 'close')])
    binder.sync(ctxFor([inst], secondary))

    const [b] = binder.bindings()
    // `ownPane` is the flag `placement` returns ONLY for the own-pane branch —
    // it is what tells the binder to CREATE a pane rather than join one.
    const created = fake.calls.find((c) => c.method === 'addSeries')
    expect(created, 'no series was created at all').toBeTruthy()
    expect(b.paneIndex, `${sym} did not get a pane above the candles`).toBeGreaterThan(0)
    expect(b.scaleId, `${sym} was put on a shared named scale`).toBe('right')
  })

  it.each(FAMILIES)('%s: an UNSUPPLIED symbol draws NOTHING — never the chart\'s bars', (_label, sym) => {
    // ⛔ THE FAILURE MODE THIS WHOLE SOURCE SYSTEM EXISTS TO PREVENT. A chart that
    // answers confidently about the wrong instrument is worse than one that
    // answers nothing.
    const [inst] = instancesFor([symbolSource(sym, 'close')])
    binder.sync(ctxFor([inst], new Map()))
    const held = binder.bindings()
    for (const b of held) {
      expect(drawnValues(b, fake), `${sym} fell back to the primary series`).toEqual([])
    }
  })

  it('⛔⛔ THE TWO FAMILIES PRODUCE THE SAME BINDING STRUCTURE', () => {
    // ⚰️ THE CASE THE PHASE EXISTS FOR. If a breadth lane ever appears, this goes
    // red on the DIFFERENCE — which is the only shape that catches a second
    // system before it has grown a second renderer.
    const shapeOf = (sym) => {
      const f = createFakeChart()
      const bd = createBinder({ chart: f.chart, LWC: f.LWC })
      const secondary = new Map([[sym, { bars: secondaryFor(7), status: 'available' }]])
      const [inst] = instancesFor([symbolSource(sym, 'close')])
      bd.sync(ctxFor([inst], secondary))
      const [b] = bd.bindings()
      const ctor = f.calls.find((c) => c.method === 'addSeries')?.args?.[0]
      return {
        defId: b.defId, plotKey: b.plotKey, poolKey: b.poolKey,
        paneIndex: b.paneIndex, scaleId: b.scaleId,
        // ⚠️ THE CONSTRUCTOR BY NAME, NOT BY IDENTITY. Each fake chart mints its
        // own series tokens, so comparing the objects would compare the harness
        // rather than the lane — green or red for the wrong reason.
        ctor: typeof ctor === 'string' ? ctor : (ctor && ctor.name) || String(ctor),
        drawn: drawnValues(b, f).length,
      }
    }
    const a = shapeOf(SECURITY)
    const z = shapeOf(BREADTH)
    // Field by field, so a failure NAMES the thing that diverged rather than
    // printing two objects and leaving the reader to diff them.
    for (const k of Object.keys(a)) {
      expect(z[k], `a breadth series and a security series differ in ${k}`).toEqual(a[k])
    }
    expect(Object.keys(z).sort()).toEqual(Object.keys(a).sort())
    // Non-vacuity: the shape really carries the facts that matter.
    expect(a.defId).toBe(DIRECT_SERIES_DEF_ID)
    expect(a.drawn).toBeGreaterThan(100)
  })
})

// ─── §28 · three instruments, three panes ───────────────────────────────────

describe('⭐⭐ §28 · QQQ + SPY + UCTA50 — three independent panes', () => {
  it('three instances of ONE definition get THREE panes, with no series-specific logic', () => {
    const sources = [symbolSource('QQQ', 'close'), symbolSource('SPY', 'close'), symbolSource('UCTA50', 'close')]
    const instances = instancesFor(sources)
    expect(instances).toHaveLength(3)
    expect(new Set(instances.map((i) => i.defId))).toEqual(new Set([DIRECT_SERIES_DEF_ID]))

    const layout = layoutFor(instances)
    // ⭐ THIS FALLS OUT OF P2.0c AND NOTHING ELSE. Pane keys are host instance
    // ids, so three instances of one definition are three panes for free. If this
    // ever needed a `dataSeries` branch in the pane system, that would be the
    // signal to stop (owner §14).
    expect(layout.panes.map((p) => p.key)).toEqual(instances.map((i) => i.instanceId))
    expect(new Set(layout.panes.map((p) => p.index)).size).toBe(3)
    // …and every pane is keyed by an INSTANCE while every one carries the SAME
    // definition beside it.
    for (const p of layout.panes) expect(layout.defByKey.get(p.key)).toBe(DIRECT_SERIES_DEF_ID)
  })

  it('⭐ …and all three draw their own symbol through one binder pass', () => {
    const instances = instancesFor([
      symbolSource('QQQ', 'close'), symbolSource('SPY', 'close'), symbolSource('UCTA50', 'close'),
    ])
    const secondary = new Map([
      ['QQQ', { bars: secondaryFor(100), status: 'available' }],
      ['SPY', { bars: secondaryFor(200), status: 'available' }],
      ['UCTA50', { bars: secondaryFor(300), status: 'available' }],
    ])
    binder.sync(ctxFor(instances, secondary))
    const held = binder.bindings()
    expect(held).toHaveLength(3)

    const primaryCloses = bars.map((x) => x.c)
    const offsets = held.map((b) => {
      const drew = drawnValues(b, fake)
      return Math.round(drew[drew.length - 1] - primaryCloses[primaryCloses.length - 1])
    })
    expect(offsets.sort((a, z) => a - z), 'the three panes did not draw three different symbols')
      .toEqual([100, 200, 300])
  })

  it('⛔ two instances in DIFFERENT panes — not one pane shared by a definition', () => {
    const instances = instancesFor([symbolSource('QQQ', 'close'), symbolSource('SPY', 'close')])
    const layout = layoutFor(instances)
    expect(layout.panes).toHaveLength(2)
    expect(layout.panes[0].index).not.toBe(layout.panes[1].index)
  })
})

// ─── §29, §23 · duplicates and request dedup ────────────────────────────────

describe('⭐⭐ §29, §23 · two QQQ lines, ONE canonical request', () => {
  it('two instances of the same symbol get two panes', () => {
    const instances = instancesFor([symbolSource('QQQ', 'close'), symbolSource('QQQ', 'close')])
    expect(instances).toHaveLength(2)
    expect(instances[0].inputs.source).toBe(instances[1].inputs.source)
    const layout = layoutFor(instances)
    expect(layout.panes, 'the duplicate collapsed into one pane').toHaveLength(2)
  })

  it('⛔⛔ …and the canonical source is fetched ONCE for both', async () => {
    // ⭐ THE DEDUP IS `secondaryBars`' PER-URL CACHE AND NEEDS NOTHING FROM THE
    // FACADE. Two instances, one source string, one URL, one request — which is
    // exactly why a symbol is NOT owned by the instance that displays it.
    let calls = 0
    const fetcher = () => { calls += 1; return Promise.resolve({ bars: secondaryFor(1) }) }
    ensureAll(['QQQ', 'QQQ'], 'D', 300, fetcher)
    // ⚠️ THE FETCHER RUNS ON A MICROTASK. `fetchSecondaryBars` calls it inside a
    // `.then`, so a synchronous count reads zero and would pass for the wrong
    // reason. The in-flight map IS synchronous and is the dedup itself.
    expect(inflightCount(), 'one canonical symbol opened more than one request').toBe(1)
    await Promise.resolve()
    await Promise.resolve()
    expect(calls, 'one canonical symbol cost more than one request').toBe(1)
  })

  it('⭐ …and a THIRD consumer of the same symbol still costs nothing', async () => {
    let calls = 0
    const fetcher = () => { calls += 1; return Promise.resolve({ bars: secondaryFor(1) }) }
    ensureAll(['QQQ'], 'D', 300, fetcher)
    ensureAll(['QQQ', 'SPY'], 'D', 300, fetcher)
    expect(inflightCount(), 'the repeat ask opened a second QQQ request').toBe(2)
    await Promise.resolve()
    await Promise.resolve()
    // QQQ once, SPY once — the second QQQ ask was already in flight.
    expect(calls).toBe(2)
  })

  it('⭐ both copies draw the SAME values — one projection, two series', () => {
    const instances = instancesFor([symbolSource('QQQ', 'close'), symbolSource('QQQ', 'close')])
    const secondary = new Map([['QQQ', { bars: secondaryFor(42), status: 'available' }]])
    binder.sync(ctxFor(instances, secondary))
    const held = binder.bindings()
    expect(held).toHaveLength(2)
    expect(drawnValues(held[0], fake)).toEqual(drawnValues(held[1], fake))
  })
})

// ─── §30 · the symbol outlives its consumers ────────────────────────────────

describe('⛔⛔ §30 · deleting one consumer does not retire the symbol', () => {
  it('the canonical bars stay cached and fetchable after a consumer goes', () => {
    primeSecondaryBars('QQQ', 'D', 300, { bars: secondaryFor(9) })
    expect(cachedBars('QQQ', 'D', 300), 'the prime did not land').toBeTruthy()

    // Every consumer removed — the instance list is the only thing that changed.
    const none = []
    binder.sync(ctxFor(none, new Map()))

    // ⭐ THE SYMBOL IS UNTOUCHED. A canonical source has no delete: removing the
    // last consumer does not retire it, and a later consumer resolves normally.
    const still = cachedBars('QQQ', 'D', 300)
    expect(still, 'the canonical symbol was retired with its last consumer').toBeTruthy()
    expect(still.bars.length).toBe(bars.length)
  })

  it('⭐ a surviving consumer of the same symbol keeps drawing it', () => {
    const instances = instancesFor([symbolSource('QQQ', 'close'), symbolSource('QQQ', 'close')])
    const secondary = new Map([['QQQ', { bars: secondaryFor(11), status: 'available' }]])
    binder.sync(ctxFor(instances, secondary))
    expect(binder.bindings()).toHaveLength(2)

    // Drop the FIRST consumer and re-sync with only the second.
    const survivor = [instances[1]]
    binder.sync(ctxFor(survivor, secondary))
    const held = binder.bindings()
    expect(held, 'the survivor was released too').toHaveLength(1)
    const drew = drawnValues(held[0], fake)
    expect(drew.length, 'the survivor stopped drawing when its sibling went').toBeGreaterThan(100)
    const primaryCloses = bars.map((x) => x.c)
    expect(drew[drew.length - 1]).toBeCloseTo(primaryCloses[primaryCloses.length - 1] + 11, 8)
  })
})

// ─── §10 · the compute is source-family blind ───────────────────────────────

describe('⛔⛔ §10 · the identity compute knows nothing about families', () => {
  it('the compute returns its source unchanged, whatever the source is', () => {
    const def = registry.getDefinition(DIRECT_SERIES_DEF_ID)
    const src = Float64Array.from({ length: bars.length }, (_, i) => i * 1.5)
    const cols = registry.computeFor(def, bars, {}, { source: src })
    expect(Object.keys(cols)).toEqual(['value'])
    expect(cols.value.length).toBe(bars.length)
    for (let i = 0; i < bars.length; i++) expect(cols.value[i]).toBeCloseTo(i * 1.5, 10)
  })

  it('⛔ NO FALLBACK TO CLOSE — an unresolved source computes an all-NaN column', () => {
    const def = registry.getDefinition(DIRECT_SERIES_DEF_ID)
    const cols = registry.computeFor(def, bars, {}, {})
    expect(cols.value.length).toBe(bars.length)
    expect([...cols.value].every(Number.isNaN), 'the identity compute invented values').toBe(true)
    expect(registry.hasAnyFinite(cols.value)).toBe(false)
  })

  it('⛔ the definition names no symbol, family or endpoint anywhere', () => {
    // ⭐ A STRUCTURAL CHECK, not a reading of the comments. The definition object
    // is the whole of what the engine knows about a direct series; if `QQQ`,
    // `UCTA50`, `breadth` or `security` appear in it, a family has leaked into
    // the generic layer.
    const json = JSON.stringify(registry.getDefinition(DIRECT_SERIES_DEF_ID))
    for (const word of ['QQQ', 'UCTA50', 'breadth', 'security', 'ticker']) {
      expect(json.toLowerCase(), `the definition names ${word}`).not.toContain(word.toLowerCase())
    }
    // …and the probe can see a word that IS there, or it proves nothing.
    expect(json.toLowerCase()).toContain('source')
  })
})
