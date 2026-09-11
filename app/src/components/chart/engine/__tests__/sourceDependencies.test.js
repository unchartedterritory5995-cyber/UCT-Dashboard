import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createBinder } from '../binder'
import { resolvePlacement } from '../placement'
import { createFakeChart, makeBars } from './fakeChart'
import { __setPaneModeForTest, computePaneLayout, SEPARATOR_PX } from '../paneLayout'
import * as registry from '../nativeRegistry'
import {
  instanceSource, parseSource, sourceDependsOn, barFieldSeries, orderByDependency,
  wouldCycle, resolveScaleDomain, derivedTargetFor, sourceOptions, instanceLabel,
  SOURCE_BAR_FIELDS,
} from '../sourceRef'
import {
  resolveDisplayTarget, paneOwnerOf, paneFollowerKeys, paneOwnersNeeded,
} from '../displayTarget'
import { setInstanceInput, setIndicatorInput } from '../instanceControls'
import { autoscaleProvider, AUTOSCALE_DEFAULT } from '../pool'

// ─── CALCULATION READS A NUMERIC SERIES ──────────────────────────────────────
//
// ⭐ Before this phase "source" meant nothing: every compute reached into `bars`
// and read `.c` or `.v` itself. The claim now is that a calculation consumes a
// SERIES — from bars, from another indicator's output, later from a formula —
// and does not care which. `MA(Close)`, `MA(Volume)` and `MA(RSI)` are the same
// feature with different sources, and these cases are what says so.

const bars = makeBars(300)
const defOf = (id) => registry.getDefinition(id)

const rsi = (over = {}) => ({
  instanceId: 'legacy:rsi', defId: 'rsi', inputs: {}, hidden: false, ...over,
})
const ma = (source, over = {}) => ({
  instanceId: 'inst:ma:1', defId: 'movingAverage', hidden: false,
  inputs: { source, ...(over.inputs || {}) },
  ...Object.fromEntries(Object.entries(over).filter(([k]) => k !== 'inputs')),
})

const csOf = (instances, legacy) => ({
  indicatorInstances: instances,
  ...(legacy ? { volumeOverlayIndicators: legacy } : {}),
})

const ctxFor = (instances, cs) => {
  const settings = cs || csOf(instances)
  const layout = computePaneLayout(instances, {
    chartHeight: 600, hasVolumeBand: false, separatorPx: SEPARATOR_PX,
    excludeKeys: paneFollowerKeys(instances, settings),
    keepKeys: paneOwnersNeeded(instances, settings),
  })
  return {
    enabled: true, instances, registry, bars,
    adjustTime: (t) => t,
    plan: { fresh: true },
    applyData: (series, data) => series.setData(data),
    paneLayout: layout,
    targetOf: (i) => resolveDisplayTarget(i, settings),
    resolvePlacement: (i, def) => resolvePlacement(i, def, {
      paneMargins: layout.bands,
      paneLayout: layout,
      volOverlaySet: new Set(),
      // A real volume pane exists, so a `volume` target has somewhere to land —
      // which is the shape `MA(Volume)` needs.
      volSeparatePane: true,
      VOL_PANE_INDEX: 1,
      targetOf: (x) => resolveDisplayTarget(x, settings),
    }),
  }
}

let fake
let binder
beforeEach(() => {
  __setPaneModeForTest('panes')
  fake = createFakeChart()
  binder = createBinder({ chart: fake.chart, LWC: fake.LWC })
})
afterEach(() => { __setPaneModeForTest(null) })

/** The data the renderer was handed, per binding key. */
const dataFor = (key) => {
  const b = binder.bindings().find((x) => x.key === key)
  if (!b) return null
  const calls = fake.callsOf('setData').filter((c) => c.on === 'series' && c.id === b.series.__id)
  return calls.length ? calls[calls.length - 1].args[0] : null
}

describe('a source reference', () => {
  it('⛔ NEVER NAMES A POSITION — it is an instance id and an output key', () => {
    const ref = instanceSource('inst:rsi:2', 'rsi')
    expect(ref).toBe('@inst:rsi:2::rsi')
    expect(parseSource(ref)).toEqual({ kind: 'instance', instanceId: 'inst:rsi:2', plotKey: 'rsi' })
    // …and it round-trips an instance id that itself contains colons, which every
    // migrated one does (`legacy:rsi`).
    expect(parseSource(instanceSource('legacy:rsi', 'rsi')))
      .toEqual({ kind: 'instance', instanceId: 'legacy:rsi', plotKey: 'rsi' })
  })

  it('reads every bar field, and nothing else', () => {
    for (const f of SOURCE_BAR_FIELDS) expect(parseSource(f)).toEqual({ kind: 'bar', field: f })
    // ⚠️ UNREADABLE IS NULL, NEVER CLOSE. A typo that silently averaged the wrong
    // series and drew it as if it were right is the one failure this must not have.
    for (const bad of ['', 'clse', '@', '@x', '@x::', '@::y', null, 42, {}]) {
      expect(parseSource(bad), String(bad)).toBe(null)
    }
  })

  it('a bar field becomes the right numbers', () => {
    const b = [{ o: 1, h: 4, l: 2, c: 3, v: 9 }]
    expect(barFieldSeries(b, 'close')[0]).toBe(3)
    expect(barFieldSeries(b, 'volume')[0]).toBe(9)
    expect(barFieldSeries(b, 'hl2')[0]).toBe(3)
    expect(barFieldSeries(b, 'hlc3')[0]).toBeCloseTo(3, 10)
    expect(barFieldSeries(b, 'ohlc4')[0]).toBeCloseTo(2.5, 10)
  })

  it('⭐ two instances of one definition are DISTINGUISHABLE', () => {
    const a = rsi({ instanceId: 'legacy:rsi', inputs: { period: 14 } })
    const b = rsi({ instanceId: 'inst:rsi:2', inputs: { period: 7 } })
    const groups = sourceOptions(csOf([a, b]), defOf, 'inst:ma:1')
    const labels = groups.map(g => g.label)
    expect(labels).toContain('RSI (14)')
    expect(labels).toContain('RSI (7)')
    // …and the VALUES are instance ids, so a rename could never re-target one.
    const values = groups.flatMap(g => g.options.map(o => o.value))
    expect(values).toContain('@legacy:rsi::rsi')
    expect(values).toContain('@inst:rsi:2::rsi')
  })

  it('⛔ the consumer is never offered ITSELF', () => {
    const self = ma('close')
    const groups = sourceOptions(csOf([self]), defOf, self.instanceId)
    const values = groups.flatMap(g => g.options.map(o => o.value))
    expect(values.some(v => v.includes('inst:ma:1'))).toBe(false)
  })

  it('offers only outputs a reader would average — no guide lines', () => {
    const groups = sourceOptions(csOf([rsi()]), defOf, 'x')
    const rsiGroup = groups.find(g => g.label === 'RSI (14)')
    expect(rsiGroup.options.map(o => o.label)).toEqual(['RSI'])   // not 70/30, not 50
  })

  it('names MACD\'s three outputs separately', () => {
    const macd = { instanceId: 'legacy:macd', defId: 'macd', inputs: {}, hidden: false }
    const group = sourceOptions(csOf([macd]), defOf, 'x').find(g => g.label.startsWith('MACD'))
    expect(group.options.map(o => o.label)).toEqual(['MACD', 'Signal'])
    // ⚠️ `histogram` declares `legend.hide` — it is shape, not a reading — so it is
    // not offered. The REFERENCE still distinguishes it, which the case below holds.
    expect(instanceSource('legacy:macd', 'macd'))
      .not.toBe(instanceSource('legacy:macd', 'signal'))
  })
})

describe('dependency ordering', () => {
  it('⭐⭐ a SOURCE computes before its consumer, whatever the array order', () => {
    // The MA is stored FIRST, which is what happens when it is added first.
    const { ordered, cyclic } = orderByDependency(
      [ma(instanceSource('legacy:rsi', 'rsi')), rsi()], defOf,
    )
    expect(ordered.map(i => i.instanceId)).toEqual(['legacy:rsi', 'inst:ma:1'])
    expect([...cyclic]).toEqual([])
  })

  it('handles depth — C depends on A depends on B — with the same sort', () => {
    const a = ma(instanceSource('legacy:rsi', 'rsi'), { instanceId: 'inst:ma:1' })
    const b = { ...ma(instanceSource('inst:ma:1', 'ma')), instanceId: 'inst:ma:2' }
    const { ordered } = orderByDependency([b, a, rsi()], defOf)
    expect(ordered.map(i => i.instanceId)).toEqual(['legacy:rsi', 'inst:ma:1', 'inst:ma:2'])
  })

  it('⛔ a CYCLE is reported, not spun on', () => {
    const a = { ...ma(instanceSource('inst:ma:2', 'ma')), instanceId: 'inst:ma:1' }
    const b = { ...ma(instanceSource('inst:ma:1', 'ma')), instanceId: 'inst:ma:2' }
    const { ordered, cyclic } = orderByDependency([a, b], defOf)
    expect([...cyclic].sort()).toEqual(['inst:ma:1', 'inst:ma:2'])
    expect(ordered).toEqual([])
  })

  it('a MISSING source is not a dependency — it must not deadlock the pass', () => {
    const { ordered, cyclic } = orderByDependency([ma('@gone::rsi')], defOf)
    expect(ordered.map(i => i.instanceId)).toEqual(['inst:ma:1'])
    expect([...cyclic]).toEqual([])
  })
})

describe('cycle and self-reference refusal, at the setter', () => {
  it('⛔ an instance cannot source ITSELF', () => {
    expect(wouldCycle([ma('close')], defOf, 'inst:ma:1', instanceSource('inst:ma:1', 'ma')))
      .toBe(true)
  })

  it('⛔ nor close a longer loop', () => {
    const a = { ...ma(instanceSource('inst:ma:2', 'ma')), instanceId: 'inst:ma:1' }
    const b = { ...ma('close'), instanceId: 'inst:ma:2' }
    // Pointing ma:2 at ma:1 would close 1 → 2 → 1.
    expect(wouldCycle([a, b], defOf, 'inst:ma:2', instanceSource('inst:ma:1', 'ma'))).toBe(true)
  })

  it('…and an ordinary assignment is allowed', () => {
    expect(wouldCycle([rsi(), ma('close')], defOf, 'inst:ma:1',
      instanceSource('legacy:rsi', 'rsi'))).toBe(false)
    expect(wouldCycle([ma('close')], defOf, 'inst:ma:1', 'volume')).toBe(false)
  })

  it('⭐ the WRITE DOOR refuses it, so an impossible source is never stored', () => {
    const cs = csOf([ma('close')])
    const same = setInstanceInput(cs, 'inst:ma:1', 'source',
      instanceSource('inst:ma:1', 'ma'), registry)
    expect(same, 'a self-reference was stored').toBe(cs)
  })
})

describe('source domain inheritance', () => {
  const domain = (instances, subject) => resolveScaleDomain(subject, defOf, instances)

  it('⭐⭐ MA(RSI) inherits 0-100 — an average of a bounded series is bounded', () => {
    const m = ma(instanceSource('legacy:rsi', 'rsi'))
    expect(domain([rsi(), m], m)).toEqual({ min: 0, max: 100 })
  })

  it('⭐ MA(Williams %R) inherits -100..0 — the domain is whatever the source declares', () => {
    const w = { instanceId: 'legacy:williamsR', defId: 'williamsR', inputs: {}, hidden: false }
    const m = ma(instanceSource('legacy:williamsR', 'williams_r'))
    expect(domain([w, m], m)).toEqual({ min: -100, max: 0 })
  })

  it('⛔ MA(Volume) and MA(Close) stay DYNAMIC — market data is unbounded', () => {
    expect(domain([ma('volume')], ma('volume'))).toBe(null)
    expect(domain([ma('close')], ma('close'))).toBe(null)
  })

  it('⛔ MA(MACD) stays dynamic, because MACD is', () => {
    const macd = { instanceId: 'legacy:macd', defId: 'macd', inputs: {}, hidden: false }
    const m = ma(instanceSource('legacy:macd', 'macd'))
    expect(domain([macd, m], m)).toBe(null)
  })

  it('⛔⛔ A DEFINITION THAT DOES NOT CLAIM `inherit` DOES NOT GET ONE', () => {
    // The guard against a future Difference or Ratio taking a range it has no
    // right to. Same instance, same source; only the definition's claim differs.
    const claimed = defOf('movingAverage')
    expect(claimed.domainBehavior).toBe('inherit')
    const notClaimed = (id) => (id === 'movingAverage'
      ? { ...claimed, domainBehavior: undefined } : defOf(id))
    const m = ma(instanceSource('legacy:rsi', 'rsi'))
    expect(resolveScaleDomain(m, notClaimed, [rsi(), m])).toBe(null)
  })

  it('⭐ and the RENDERER gets it — MA(RSI) is handed RSI\'s ladder', () => {
    const m = ma(instanceSource('legacy:rsi', 'rsi'))
    binder.sync(ctxFor([rsi(), m]))
    const maOpts = fake.callsOf('addSeries').map(c => c.args[1])
      .filter(o => o.color === defOf('movingAverage').plots[0].color || true)
    expect(maOpts.length).toBeGreaterThan(1)
    const providers = fake.callsOf('addSeries').map(c => c.args[1].autoscaleInfoProvider)
    for (const p of providers) {
      expect(p, 'a series in the RSI pane is not on the 0-100 ladder')
        .toBe(autoscaleProvider('default', { min: 0, max: 100 }))
    }
  })

  it('…and MA(Close) is NOT — it is a guest on the candle axis', () => {
    // ⛔ `EXCLUDE`, not `DEFAULT`, and that is the stronger answer: a price
    // overlay must not size the candles' scale at all, let alone pin it. The
    // point of the case is that no ladder is inherited, and `exclude` outranks a
    // domain by design (`pool.autoscaleProvider`).
    const f2 = createFakeChart()
    const b2 = createBinder({ chart: f2.chart, LWC: f2.LWC })
    b2.sync(ctxFor([ma('close')]))
    const providers = f2.callsOf('addSeries').map(c => c.args[1].autoscaleInfoProvider)
    expect(providers.length).toBeGreaterThan(0)
    for (const p of providers) {
      expect(p).not.toBe(autoscaleProvider('default', { min: 0, max: 100 }))
      expect(p(() => null), 'it pinned a range on the candles').toBe(null)
    }
  })
})

describe('derived placement — a default, never a weld', () => {
  it('⭐ MA(RSI) defaults into RSI\'s pane', () => {
    const m = ma(instanceSource('legacy:rsi', 'rsi'))
    const cs = csOf([rsi(), m])
    expect(resolveDisplayTarget(m, cs)).toBe('@rsi')
    expect(paneOwnerOf(m, cs)).toBe('rsi')
  })

  it('⭐ MA(Volume) defaults into the volume pane, MA(Close) onto the candles', () => {
    expect(resolveDisplayTarget(ma('volume'), csOf([ma('volume')]))).toBe('volume')
    expect(resolveDisplayTarget(ma('close'), csOf([ma('close')]))).toBe('price')
  })

  it('⭐⭐ it FOLLOWS its source onto Volume rather than detaching', () => {
    const overlaid = rsi({ placement: { target: 'volume' } })
    const m = ma(instanceSource('legacy:rsi', 'rsi'))
    expect(resolveDisplayTarget(m, csOf([overlaid, m]))).toBe('volume')
  })

  it('⛔ AND AN EXPLICIT PLACEMENT OUTRANKS IT — source and target stay separable', () => {
    const m = ma(instanceSource('legacy:rsi', 'rsi'), { placement: { target: 'pane' } })
    expect(resolveDisplayTarget(m, csOf([rsi(), m]))).toBe('pane')
    expect(paneOwnerOf(m, csOf([rsi(), m])), 'it did not get a pane of its OWN')
      .toBe('movingAverage')
  })

  it('⛔ a follower RESERVES NO PANE OF ITS OWN', () => {
    const m = ma(instanceSource('legacy:rsi', 'rsi'))
    const cs = csOf([rsi(), m])
    expect([...paneFollowerKeys([rsi(), m], cs)]).toEqual(['movingAverage'])
  })

  it('a MISSING source derives nothing — it falls back to the definition', () => {
    const m = ma('@gone::rsi')
    expect(resolveDisplayTarget(m, csOf([m]))).toBe('price')
  })

  it('⭐ and the pane is addressed by KEY, never by index — so the owner can move', () => {
    const m = ma(instanceSource('legacy:rsi', 'rsi'))
    const below = csOf([rsi(), m])
    const above = csOf([rsi({ placement: { position: 'above' } }), m])
    // The same answer in both, because the answer is "RSI's pane" and not "pane 2".
    expect(resolveDisplayTarget(m, below)).toBe('@rsi')
    expect(resolveDisplayTarget(m, above)).toBe('@rsi')
  })
})

describe('MA(RSI), numerically', () => {
  const rsiCol = () => registry.computeFor(defOf('rsi'), bars, {}).rsi

  it('⭐⭐ every MA value IS the average of the last five RSI values', () => {
    const m = ma(instanceSource('legacy:rsi', 'rsi'), { inputs: { period: 5 } })
    binder.sync(ctxFor([rsi(), m]))
    const out = dataFor('inst:ma:1::ma')
    expect(out, 'the MA bound nothing').toBeTruthy()

    const src = rsiCol()
    const byTime = new Map(out.map(p => [p.time, p.value]))
    let checked = 0
    for (let i = 5; i < bars.length; i++) {
      const window = [src[i - 4], src[i - 3], src[i - 2], src[i - 1], src[i]]
      if (!window.every(Number.isFinite)) continue
      const want = window.reduce((a, b) => a + b, 0) / 5
      const got = byTime.get(bars[i].t)
      if (got === undefined) continue
      expect(got, `bar ${i}`).toBeCloseTo(want, 10)
      checked++
    }
    // Non-vacuity: this really did compare hundreds of bars, not zero.
    expect(checked, 'no bar was actually compared').toBeGreaterThan(200)
  })

  it('⭐ the LAST value is the average of the last five — the number a reader sees', () => {
    const m = ma(instanceSource('legacy:rsi', 'rsi'), { inputs: { period: 5 } })
    binder.sync(ctxFor([rsi(), m]))
    const out = dataFor('inst:ma:1::ma')
    const last = out[out.length - 1]
    const src = rsiCol()
    const n = bars.length
    const want = (src[n - 1] + src[n - 2] + src[n - 3] + src[n - 4] + src[n - 5]) / 5
    expect(last.time).toBe(bars[n - 1].t)
    expect(last.value).toBeCloseTo(want, 10)
  })

  it('⛔ the WARM-UP is honest — no value until five FINITE inputs exist', () => {
    // RSI(14) has a NaN head, so MA(5, RSI(14)) cannot start before bar 18. A
    // window that averaged NaNs as zeros would emit a number much earlier.
    const m = ma(instanceSource('legacy:rsi', 'rsi'), { inputs: { period: 5 } })
    binder.sync(ctxFor([rsi(), m]))
    const out = dataFor('inst:ma:1::ma')
    const src = rsiCol()
    let firstFiniteSrc = -1
    for (let i = 0; i < src.length; i++) if (Number.isFinite(src[i])) { firstFiniteSrc = i; break }
    expect(firstFiniteSrc, 'RSI has no warm-up at all — the case is vacuous').toBeGreaterThan(0)
    // The head is WHITESPACE — a time with no value — which is the honest shape:
    // the bar exists on the axis, the average does not exist yet.
    const firstValued = out.findIndex(p => Number.isFinite(p.value))
    expect(firstValued, 'the MA never produced a value at all').toBeGreaterThan(-1)
    const firstEmitted = bars.findIndex(b => b.t === out[firstValued].time)
    expect(firstEmitted, 'the MA emitted before five finite inputs existed')
      .toBeGreaterThanOrEqual(firstFiniteSrc + 4)
  })

  it('⭐ MA(Volume) is the average of VOLUME, not of close', () => {
    const m = ma('volume', { inputs: { period: 20 } })
    binder.sync(ctxFor([m]))
    const out = dataFor('inst:ma:1::ma')
    const n = bars.length
    let want = 0
    for (let i = n - 20; i < n; i++) want += bars[i].v
    want /= 20
    expect(out[out.length - 1].value).toBeCloseTo(want, 6)
  })
})

describe('invalidation — what recomputes and what does not', () => {
  const computesOn = (instancesA, instancesB) => {
    const f2 = createFakeChart()
    const b2 = createBinder({ chart: f2.chart, LWC: f2.LWC })
    b2.sync(ctxFor(instancesA))
    const before = f2.callsOf('setData').length
    f2.reset()
    b2.sync(ctxFor(instancesB))
    return { before, after: f2.callsOf('setData').length }
  }

  it('⭐⭐ a SOURCE PARAMETER change recomputes the dependent', () => {
    // RSI 14 → 21 must move MA(RSI): the column is a new array, so the memo misses.
    const m = ma(instanceSource('legacy:rsi', 'rsi'), { inputs: { period: 5 } })
    const f2 = createFakeChart()
    const b2 = createBinder({ chart: f2.chart, LWC: f2.LWC })
    b2.sync(ctxFor([rsi({ inputs: { period: 14 } }), m]))
    const at14 = fakeLast(f2, 'inst:ma:1::ma', b2)
    b2.sync(ctxFor([rsi({ inputs: { period: 21 } }), m]))
    const at21 = fakeLast(f2, 'inst:ma:1::ma', b2)
    expect(at21, 'MA(RSI) did not move when RSI\'s period did').not.toEqual(at14)
  })

  it('⛔ a source PRESENTATION change does not — the column is the same array', () => {
    const m = ma(instanceSource('legacy:rsi', 'rsi'))
    const plain = rsi()
    const restyled = rsi({ presentation: { plotStyle: 'dots' } })
    const f2 = createFakeChart()
    const b2 = createBinder({ chart: f2.chart, LWC: f2.LWC })
    b2.sync(ctxFor([plain, m]))
    const a = fakeLast(f2, 'inst:ma:1::ma', b2)
    b2.sync(ctxFor([restyled, m]))
    const b = fakeLast(f2, 'inst:ma:1::ma', b2)
    expect(b).toEqual(a)
  })

  it('⛔ nor does a source PLACEMENT change', () => {
    const m = ma(instanceSource('legacy:rsi', 'rsi'))
    const f2 = createFakeChart()
    const b2 = createBinder({ chart: f2.chart, LWC: f2.LWC })
    b2.sync(ctxFor([rsi(), m]))
    const a = fakeLast(f2, 'inst:ma:1::ma', b2)
    b2.sync(ctxFor([rsi({ placement: { position: 'above' } }), m]))
    expect(fakeLast(f2, 'inst:ma:1::ma', b2)).toEqual(a)
  })

  it('⭐ changing the MA\'s OWN source recomputes it — that IS a calculation change', () => {
    const f2 = createFakeChart()
    const b2 = createBinder({ chart: f2.chart, LWC: f2.LWC })
    b2.sync(ctxFor([rsi(), ma('close')]))
    const onClose = fakeLast(f2, 'inst:ma:1::ma', b2)
    b2.sync(ctxFor([rsi(), ma(instanceSource('legacy:rsi', 'rsi'))]))
    expect(fakeLast(f2, 'inst:ma:1::ma', b2)).not.toEqual(onClose)
  })

  function fakeLast(f, key, b) {
    const bind = b.bindings().find((x) => x.key === key)
    if (!bind) return null
    const calls = f.callsOf('setData').filter((c) => c.id === bind.series.__id)
    return calls.length ? calls[calls.length - 1].args[0] : null
  }
})

describe('a HIDDEN or MISSING source', () => {
  it('⭐⭐ VISIBILITY IS NOT EXISTENCE — a hidden RSI still feeds its MA', () => {
    // Hiding an indicator is a statement about ink. An eye icon that silently
    // emptied a dependent's numbers would be a very strange thing to discover.
    const m = ma(instanceSource('legacy:rsi', 'rsi'), { inputs: { period: 5 } })
    binder.sync(ctxFor([rsi({ hidden: true }), m]))
    const out = dataFor('inst:ma:1::ma')
    expect(out, 'the MA went blank when its source was hidden').toBeTruthy()
    expect(out.length).toBeGreaterThan(200)
  })

  it('⛔ a DELETED source leaves the MA configured and drawing NOTHING', () => {
    // Not silently re-pointed at Close, not deleted, not crashing.
    const m = ma(instanceSource('legacy:rsi', 'rsi'))
    binder.sync(ctxFor([m]))
    expect(dataFor('inst:ma:1::ma'), 'it drew something from a source that is gone').toBe(null)
    expect(m.inputs.source, 'the stored source was rewritten').toBe('@legacy:rsi::rsi')
  })

  it('…and re-adding an indicator with the same NAME does not silently re-bind it', () => {
    const m = ma(instanceSource('legacy:rsi', 'rsi'))
    // A NEW RSI instance — same definition, different id, which is what "re-added"
    // means. Identity is the id, so the MA stays unresolved until the user picks it.
    const fresh = rsi({ instanceId: 'inst:rsi:9' })
    binder.sync(ctxFor([fresh, m]))
    expect(dataFor('inst:ma:1::ma')).toBe(null)
  })
})

describe('instanceLabel', () => {
  it('names an indicator the way its own legend does', () => {
    expect(instanceLabel(defOf('rsi'), rsi({ inputs: { period: 7 } }))).toBe('RSI (7)')
    expect(instanceLabel(defOf('rsi'), rsi())).toBe('RSI (14)')   // the default
    expect(instanceLabel(defOf('obv'), { defId: 'obv', inputs: {} })).toBe('OBV')
  })
})

// ─── A MULTI-OUTPUT SOURCE ──────────────────────────────────────────────────
//
// ⭐⭐ THE REFERENCE IS `instance + OUTPUT`, and MACD is where that stops being a
// detail. It publishes three series on one instance, so "average MACD" is an
// ambiguous sentence and `@legacy:macd::macd` is not. If the reference were an
// instance id alone — the obvious simplification — these two would be the same
// dependency and would necessarily draw the same line.

describe('an instance with THREE outputs', () => {
  const macd = { instanceId: 'legacy:macd', defId: 'macd', inputs: {}, hidden: false }
  const maOf = (plotKey, instanceId) => ({
    instanceId, defId: 'movingAverage', hidden: false,
    inputs: { source: instanceSource('legacy:macd', plotKey), period: 5, maType: 'sma' },
  })

  it('⭐⭐ MA(MACD) and MA(SIGNAL) are DIFFERENT LINES from one source instance', () => {
    const a = maOf('macd', 'inst:ma:1')
    const b = maOf('signal', 'inst:ma:2')
    binder.sync(ctxFor([macd, a, b]))
    const la = dataFor('inst:ma:1::ma')
    const lb = dataFor('inst:ma:2::ma')
    expect(la, 'MA(MACD.macd) bound nothing').toBeTruthy()
    expect(lb, 'MA(MACD.signal) bound nothing').toBeTruthy()

    const valued = (d) => d.filter((p) => Number.isFinite(p.value))
    expect(valued(la).length).toBeGreaterThan(100)
    expect(valued(lb).length).toBeGreaterThan(100)

    // Not "not identical objects" — genuinely different numbers, on most bars.
    const byTime = new Map(lb.map((p) => [p.time, p.value]))
    let differ = 0
    let compared = 0
    for (const p of valued(la)) {
      const other = byTime.get(p.time)
      if (!Number.isFinite(other)) continue
      compared++
      if (Math.abs(p.value - other) > 1e-9) differ++
    }
    expect(compared, 'the two lines share no bars').toBeGreaterThan(100)
    expect(differ / compared, 'the two outputs produced the same series')
      .toBeGreaterThan(0.9)
  })

  it('…and BOTH default into MACD’s pane — one source, one home', () => {
    const a = maOf('macd', 'inst:ma:1')
    const b = maOf('signal', 'inst:ma:2')
    const cs = csOf([macd, a, b])
    expect(resolveDisplayTarget(a, cs)).toBe('@macd')
    expect(resolveDisplayTarget(b, cs)).toBe('@macd')
    expect(paneOwnerOf(a, cs)).toBe('macd')
  })

  it('⛔ and the ORDER is still right with two consumers of one source', () => {
    const { ordered, cyclic } = orderByDependency(
      [maOf('signal', 'inst:ma:2'), maOf('macd', 'inst:ma:1'), macd], defOf,
    )
    expect(ordered[0].instanceId).toBe('legacy:macd')
    expect(ordered.map((i) => i.instanceId).slice(1).sort())
      .toEqual(['inst:ma:1', 'inst:ma:2'])
    expect([...cyclic]).toEqual([])
  })
})


// ─── THE CYCLE GUARD HAS TO STAND AT BOTH DOORS ────────────────────────
//
// ⛔⛔ `applyRowPatch` routes a USER-ADDED instance through `setInstanceInput` and
// the FOLD's instance (`legacy:<defId>`) through `setIndicatorInput`, so that the
// legacy mirror keeps agreeing with it. A guard on one door is therefore half a
// guard: a loop closed through the fold's half was accepted. Measured live —
// `legacy:movingAverage` → `inst:movingAverage:1` → `legacy:movingAverage`, stored
// without complaint, then dropped by the binder's cycle set, and the chart
// quietly lost two lines with nothing said about why.

describe('a loop is refused at whichever door it arrives', () => {
  const two = () => ([
    rsi(),
    { ...ma(instanceSource('legacy:rsi', 'rsi')), instanceId: 'legacy:movingAverage' },
    { ...ma(instanceSource('legacy:movingAverage', 'ma')), instanceId: 'inst:movingAverage:1' },
  ])

  it('⛔ the USER-ADDED door refuses — `setInstanceInput`', () => {
    const cs = csOf(two())
    const back = instanceSource('inst:movingAverage:1', 'ma')
    expect(setInstanceInput(cs, 'legacy:movingAverage', 'source', back, registry)).toBe(cs)
  })

  it('⛔⛔ …and so does the FOLD door — `setIndicatorInput`', () => {
    const cs = csOf(two())
    const back = instanceSource('inst:movingAverage:1', 'ma')
    const next = setIndicatorInput(cs, 'movingAverage', 'source', back, registry)
    expect(next, 'the loop was stored through the legacy mirror').toBe(cs)
    // …and the MIRROR is untouched too, which is the half a `return cs` guarantees
    // and a late bail-out would not.
    expect(next.indicators?.movingAverage?.source).toBeUndefined()
  })

  it('✅ a source that closes NO loop still writes through that door', () => {
    const cs = csOf(two())
    const next = setIndicatorInput(cs, 'movingAverage', 'source', 'volume', registry)
    expect(next).not.toBe(cs)
    const fold = next.indicatorInstances.find((i) => i.instanceId === 'legacy:movingAverage')
    expect(fold.inputs.source).toBe('volume')
  })
})
