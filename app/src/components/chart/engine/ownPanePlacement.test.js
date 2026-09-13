import { describe, it, expect } from 'vitest'
import { computePaneLayout, __setPaneModeForTest } from './paneLayout'
import { paneOwnKeys, paneFollowerKeys, volumeOverlayKeys, volumeOverlayPaneKeys,
  paneOwnersNeeded, resolveDisplayTarget } from './displayTarget'
import { resolvePlacement } from './placement'
import * as registry from './nativeRegistry'
import { mergeChartSettings } from '../chartDefaults'
import { setInstanceDisplayTarget, addInstance } from './instanceControls'

// ─── P2.0 · ACTIVE INSTANCE PLACEMENT IS AUTHORITATIVE ──────────────────────
//
// ⛔⛔ THE DEFECT. `isWritableDisplayTarget('pane')` accepts the move for ANY
// definition and `resolveDisplayTarget` returns it — but `paneTargetIds()` built
// the pane-eligible set from each DEFINITION's declared target, so a definition
// declaring `price` was allocated no pane however the member had configured it.
// `resolvePlacement` then failed closed and the series vanished, silently.
//
// ⭐ DEFINITION PLACEMENT IS THE DEFAULT. INSTANCE PLACEMENT IS THE ACTIVE STATE.
// These cases pin both halves: a choice becomes realisable, and a non-choice
// still resolves exactly as it always did.

/** Every shipped definition whose DEFAULT target is `price` — the affected class.
 *  Derived from the registry, never hand-listed, so a ninth cannot appear
 *  untested. */
const PRICE_DEFAULT_IDS = registry.listDefinitions()
  .filter((d) => d && d.placement && d.placement.target === 'price')
  .map((d) => d.id)

/** …and the ones that already declared `pane`, for the default regression. */
const PANE_DEFAULT_IDS = registry.listDefinitions()
  .filter((d) => d && d.placement && d.placement.target === 'pane')
  .map((d) => d.id)

const inst = (defId, extra = {}) => ({
  instanceId: `legacy:${defId}`, defId, inputs: {}, hidden: false, ...extra,
})
/** ⭐ P2.0c: a pane is keyed by its HOST INSTANCE, not by the definition. These
 *  fixtures use the deterministic `legacy:<defId>` instance id, so the expected
 *  pane key is that — which is exactly what changed. */
const host = (defId) => `legacy:${defId}`
const onPane = (defId) => inst(defId, { placement: { target: 'pane' } })

const layoutFor = (instances, cs = {}) => computePaneLayout(instances, {
  chartHeight: 800,
  hasVolumeBand: false,
  excludeKeys: new Set([...paneFollowerKeys(instances, cs)]),
  includeKeys: paneOwnKeys(instances, cs),
  // ⭐ THE THIRD SET `StockChart` PASSES, and leaving it out made this helper a
  // slightly different chart from the real one: a hidden owner with a visible
  // follower in its pane loses the pane, and the follower with it.
  keepKeys: paneOwnersNeeded(instances, cs),
  firstPaneIndex: 1,
})
const keysOf = (layout) => layout.panes.map((p) => p.key)

/** The placement plan the binder would receive — null means "binds nothing". */
const planFor = (instance, cs, layout) => resolvePlacement(
  instance, registry.getDefinition(instance.defId),
  {
    targetOf: (i) => resolveDisplayTarget(i, cs),
    paneLayout: layout,
    volSeparatePane: false,
    derivedTargetOf: () => null,
    volOverlaySet: new Set(),
  },
)

describe('the affected class is real and derived, not assumed', () => {
  it('⭐ the registry itself names the price-default definitions', () => {
    // If this list is empty the rest of the file proves nothing.
    expect(PRICE_DEFAULT_IDS.length).toBeGreaterThan(0)
    expect(PRICE_DEFAULT_IDS).toContain('movingAverage')
    expect(PRICE_DEFAULT_IDS).toContain('bb')
    expect(PRICE_DEFAULT_IDS).toContain('vwap')
  })
})

describe('⛔⛔ THE DEFECT — a price-default definition moved to its own pane', () => {
  it.each(PRICE_DEFAULT_IDS)('%s: an instance set to `pane` GETS a pane', (defId) => {
    __setPaneModeForTest('panes')
    const instances = [onPane(defId)]
    const cs = { indicatorInstances: instances }

    // The member's choice is what the resolver returns…
    expect(resolveDisplayTarget(instances[0], cs)).toBe('pane')
    // …and now the layout allocates for it.
    expect(keysOf(layoutFor(instances, cs))).toContain(host(defId))
  })

  it.each(PRICE_DEFAULT_IDS)('%s: and the binder receives a real placement, not null', (defId) => {
    __setPaneModeForTest('panes')
    const instances = [onPane(defId)]
    const cs = { indicatorInstances: instances }
    const plan = planFor(instances[0], cs, layoutFor(instances, cs))

    // ⛔ `null` is what made the series disappear. A plan with an integer pane
    // index is the whole repair.
    expect(plan).toBeTruthy()
    expect(Number.isInteger(plan.paneIndex)).toBe(true)
    expect(plan.scaleId).toBe('right')
  })
})

describe('§K · DEFAULTS ARE UNCHANGED — capability moved, defaults did not', () => {
  it.each(PRICE_DEFAULT_IDS)('%s with NO instance placement stays off the pane stack', (defId) => {
    __setPaneModeForTest('panes')
    const instances = [inst(defId)]
    const cs = { indicatorInstances: instances }
    expect(resolveDisplayTarget(instances[0], cs)).toBe('price')
    expect(keysOf(layoutFor(instances, cs))).not.toContain(host(defId))
  })

  it.each(PANE_DEFAULT_IDS)('%s with NO instance placement still gets its pane', (defId) => {
    __setPaneModeForTest('panes')
    const instances = [inst(defId)]
    const cs = { indicatorInstances: instances }
    expect(keysOf(layoutFor(instances, cs))).toContain(host(defId))
  })

  it('⛔ the definition declarations themselves are untouched', () => {
    // The forbidden fix was making definitions lie about their default.
    expect(registry.getDefinition('movingAverage').placement.target).toBe('price')
    expect(registry.getDefinition('bb').placement.target).toBe('price')
    expect(registry.getDefinition('vwap').placement.target).toBe('price')
    expect(registry.getDefinition('rsi').placement.target).toBe('pane')
  })
})

describe('§H · MULTIPLE INSTANCES', () => {
  it('⭐ one MA on price and one MA in a pane coexist', () => {
    __setPaneModeForTest('panes')
    const onPrice = { ...inst('movingAverage'), instanceId: 'inst:movingAverage:1' }
    const inPane = { ...onPane('movingAverage'), instanceId: 'inst:movingAverage:2' }
    const instances = [onPrice, inPane]
    const cs = { indicatorInstances: instances }

    expect(resolveDisplayTarget(onPrice, cs)).toBe('price')
    expect(resolveDisplayTarget(inPane, cs)).toBe('pane')

    const layout = layoutFor(instances, cs)
    // ⭐ ONLY the in-pane instance hosts a pane; the price one hosts nothing.
    expect(keysOf(layout)).toContain('inst:movingAverage:2')
    expect(keysOf(layout)).not.toContain('inst:movingAverage:1')

    // The pane one binds into the pane; the price one takes the price branch and
    // never consults the layout at all.
    expect(Number.isInteger(planFor(inPane, cs, layout).paneIndex)).toBe(true)
    expect(planFor(onPrice, cs, layout).scaleId).toBe('right')
  })

  it('⭐⭐ TWO own-pane instances of ONE definition GET TWO PANES', () => {
    // ⭐ THE P2.0c PRODUCT RULING, AND THE REVERSAL OF WHAT THIS FILE ASSERTED
    // ONE SLICE AGO. `orderedPaneKeys` used to dedupe by `defId`, so the pane
    // model was one pane per DEFINITION and this case pinned that. A definition
    // describes behaviour and defaults; it is not a presentation container, and
    // two independent visual objects must not collapse because they were made
    // from the same one.
    __setPaneModeForTest('panes')
    const a = { ...onPane('movingAverage'), instanceId: 'inst:movingAverage:1' }
    const b = { ...onPane('movingAverage'), instanceId: 'inst:movingAverage:2' }
    const instances = [a, b]
    const cs = { indicatorInstances: instances }

    const keys = keysOf(layoutFor(instances, cs))
    expect(keys).toContain('inst:movingAverage:1')
    expect(keys).toContain('inst:movingAverage:2')
    expect(new Set(keys).size).toBe(keys.length)          // no collision

    // …and each binds into a DIFFERENT pane index.
    const layout = layoutFor(instances, cs)
    const ia = planFor(a, cs, layout).paneIndex
    const ib = planFor(b, cs, layout).paneIndex
    expect(Number.isInteger(ia) && Number.isInteger(ib)).toBe(true)
    expect(ia).not.toBe(ib)
  })

  it('⭐⭐ TWO RSI instances, both own pane, get TWO panes', () => {
    // The same ruling on a definition whose DEFAULT is already `pane` — this is
    // the behaviour change P2.0c deliberately accepts.
    __setPaneModeForTest('panes')
    const a = { ...inst('rsi'), instanceId: 'inst:rsi:1' }
    const b = { ...inst('rsi'), instanceId: 'inst:rsi:2' }
    const instances = [a, b]
    const cs = { indicatorInstances: instances }
    const keys = keysOf(layoutFor(instances, cs))
    expect(keys).toContain('inst:rsi:1')
    expect(keys).toContain('inst:rsi:2')
  })

  it('⭐ two DIFFERENT price-default definitions each get their own pane', () => {
    __setPaneModeForTest('panes')
    const instances = [onPane('movingAverage'), onPane('bb')]
    const cs = { indicatorInstances: instances }
    const keys = keysOf(layoutFor(instances, cs))
    expect(keys).toContain(host('movingAverage'))
    expect(keys).toContain(host('bb'))
  })
})

describe('§I, §Q · FOLLOWERS KEEP FOLLOWING', () => {
  it('⛔⛔ MA(RSI) STILL DRAWS IN RSI\'S PANE — no pane of its own', () => {
    // The risk this slice had to avoid: now that a price-default definition CAN
    // own a pane, a follower must not accidentally be given one. `paneOwnKeys`
    // reads the RESOLVED target, and a follower resolves to `@rsi`, not `pane`.
    __setPaneModeForTest('panes')
    const rsi = inst('rsi')
    const ma = {
      instanceId: 'inst:movingAverage:1', defId: 'movingAverage', hidden: false,
      inputs: { source: '@legacy:rsi::rsi' },
    }
    const instances = [rsi, ma]
    const cs = { indicatorInstances: instances }

    expect(paneOwnKeys(instances, cs).has(host('movingAverage'))).toBe(false)
    const keys = keysOf(layoutFor(instances, cs))
    expect(keys).toContain(host('rsi'))
    expect(keys).not.toContain(host('movingAverage'))
  })

  it('⭐ a follower is still excluded even if something else put its defId in scope', () => {
    __setPaneModeForTest('panes')
    const rsi = inst('rsi')
    const follower = {
      instanceId: 'inst:movingAverage:1', defId: 'movingAverage', hidden: false,
      inputs: { source: '@legacy:rsi::rsi' },
    }
    const instances = [rsi, follower]
    const cs = { indicatorInstances: instances }
    expect(paneFollowerKeys(instances, cs).has('inst:movingAverage:1')).toBe(true)
    expect(keysOf(layoutFor(instances, cs))).not.toContain(host('movingAverage'))
  })
})

describe('§O · MOVE BACK — the pane goes away again', () => {
  it('⭐ price → pane → price leaves no zombie pane', () => {
    __setPaneModeForTest('panes')
    const before = [inst('movingAverage')]
    const moved = [onPane('movingAverage')]
    const back = [inst('movingAverage')]

    expect(keysOf(layoutFor(before, { indicatorInstances: before }))).not.toContain(host('movingAverage'))
    expect(keysOf(layoutFor(moved, { indicatorInstances: moved }))).toContain(host('movingAverage'))
    expect(keysOf(layoutFor(back, { indicatorInstances: back }))).not.toContain(host('movingAverage'))
  })

  it('⭐ removing the instance entirely removes the pane', () => {
    __setPaneModeForTest('panes')
    const withIt = [onPane('movingAverage'), inst('rsi')]
    const without = [inst('rsi')]
    expect(keysOf(layoutFor(withIt, { indicatorInstances: withIt }))).toContain(host('movingAverage'))
    expect(keysOf(layoutFor(without, { indicatorInstances: without }))).not.toContain(host('movingAverage'))
  })
})

describe('§J, §R · REGRESSIONS THE WIDENING MUST NOT CAUSE', () => {
  it('⛔ a HIDDEN own-pane instance reserves nothing', () => {
    __setPaneModeForTest('panes')
    const hidden = { ...onPane('movingAverage'), hidden: true }
    const instances = [hidden]
    expect(paneOwnKeys(instances, { indicatorInstances: instances }).has(host('movingAverage'))).toBe(false)
    expect(keysOf(layoutFor(instances, { indicatorInstances: instances }))).not.toContain('movingAverage')
  })

  it('⛔ a VOLUME target does not become a pane', () => {
    __setPaneModeForTest('panes')
    const v = inst('movingAverage', { placement: { target: 'volume' } })
    const instances = [v]
    const cs = { indicatorInstances: instances }
    expect(resolveDisplayTarget(v, cs)).toBe('volume')
    expect(paneOwnKeys(instances, cs).has(host('movingAverage'))).toBe(false)
    expect(keysOf(layoutFor(instances, cs))).not.toContain(host('movingAverage'))
  })

  it('⛔ an explicit PRICE target does not become a pane', () => {
    __setPaneModeForTest('panes')
    const p = inst('rsi', { placement: { target: 'price' } })
    const instances = [p]
    const cs = { indicatorInstances: instances }
    expect(resolveDisplayTarget(p, cs)).toBe('price')
    expect(paneOwnKeys(instances, cs).has(host('rsi'))).toBe(false)
  })

  it('⭐ ordinary pane definitions are completely unaffected', () => {
    __setPaneModeForTest('panes')
    const instances = [inst('rsi'), inst('macd')]
    const cs = { indicatorInstances: instances }
    const keys = keysOf(layoutFor(instances, cs))
    expect(keys).toContain(host('rsi'))
    expect(keys).toContain(host('macd'))
  })

  it('⛔ an ABSENT includeKeys behaves exactly as before — every existing caller', () => {
    __setPaneModeForTest('panes')
    const instances = [onPane('movingAverage'), inst('rsi')]
    const without = computePaneLayout(instances, { chartHeight: 800, firstPaneIndex: 1 })
    // No include set ⇒ the old answer: only the pane-declaring definition.
    expect(without.panes.map((p) => p.key)).toEqual([host('rsi')])
  })
})

describe('§M, §P · AN EXISTING BROKEN CHART RECOVERS WITHOUT MIGRATION', () => {
  it('⭐⭐ a stored blob that renders NOTHING today begins rendering', () => {
    __setPaneModeForTest('panes')
    // Exactly what a member who moved their MA to Own Pane has stored right now.
    const stored = JSON.parse(JSON.stringify({
      indicatorInstances: [
        { instanceId: 'legacy:movingAverage', defId: 'movingAverage',
          inputs: { period: 20 }, placement: { target: 'pane' }, hidden: false },
      ],
    }))
    const snapshot = JSON.stringify(stored)

    const layout = layoutFor(stored.indicatorInstances, stored)
    expect(keysOf(layout)).toContain(host('movingAverage'))
    const plan = planFor(stored.indicatorInstances[0], stored, layout)
    expect(plan).toBeTruthy()
    expect(Number.isInteger(plan.paneIndex)).toBe(true)

    // ⛔ NO WRITE-ON-LOAD. Realisation was the defect; the stored bytes were
    // always correct and must not be rewritten.
    expect(JSON.stringify(stored)).toBe(snapshot)
  })
})

// ─── P2.0c · INSTANCE-HOSTED PANES ──────────────────────────────────────────

describe('⭐⭐ §17 · TWO FOLLOWER GROUPS STAY ISOLATED', () => {
  // The critical acceptance test of the key widening. Before P2.0c both MAs
  // resolved to `@rsi` — the DEFINITION — so both landed in whichever single RSI
  // pane existed, and one member's `MA(RSI B)` drew on the other RSI.
  const rsiA = { instanceId: 'inst:rsi:1', defId: 'rsi', inputs: {}, hidden: false }
  const rsiB = { instanceId: 'inst:rsi:2', defId: 'rsi', inputs: {}, hidden: false }
  const maA = {
    instanceId: 'inst:movingAverage:1', defId: 'movingAverage', hidden: false,
    inputs: { source: '@inst:rsi:1::rsi' },
  }
  const maB = {
    instanceId: 'inst:movingAverage:2', defId: 'movingAverage', hidden: false,
    inputs: { source: '@inst:rsi:2::rsi' },
  }
  const instances = [rsiA, rsiB, maA, maB]
  const cs = { indicatorInstances: instances }

  it('each MA resolves to ITS OWN source instance, not to the definition', () => {
    expect(resolveDisplayTarget(maA, cs)).toBe('@inst:rsi:1')
    expect(resolveDisplayTarget(maB, cs)).toBe('@inst:rsi:2')
    // ⛔ The old answer was '@rsi' for BOTH.
    expect(resolveDisplayTarget(maA, cs)).not.toBe(resolveDisplayTarget(maB, cs))
  })

  it('⛔⛔ MA(RSI A) lands in RSI A\'s pane and MA(RSI B) in RSI B\'s', () => {
    __setPaneModeForTest('panes')
    const layout = layoutFor(instances, cs)
    const keys = keysOf(layout)
    expect(keys).toContain('inst:rsi:1')
    expect(keys).toContain('inst:rsi:2')

    const paneOf = (i) => planFor(i, cs, layout).paneIndex
    const idxOf = (key) => layout.panes.find((p) => p.key === key).index
    expect(paneOf(maA)).toBe(idxOf('inst:rsi:1'))
    expect(paneOf(maB)).toBe(idxOf('inst:rsi:2'))
    expect(paneOf(maA)).not.toBe(paneOf(maB))
  })

  it('⛔ neither MA reserves a pane of its own', () => {
    __setPaneModeForTest('panes')
    const keys = keysOf(layoutFor(instances, cs))
    expect(keys).not.toContain('inst:movingAverage:1')
    expect(keys).not.toContain('inst:movingAverage:2')
    expect(keys).toHaveLength(2)          // exactly the two RSI hosts
  })
})

describe('§28 · THE PROPERTY P2.1 NEEDS — three instances of ONE definition', () => {
  it('⭐⭐ three own-pane instances of one definition get THREE panes', () => {
    // The generic `series` definition does not exist yet, so this proves the
    // property structurally on a definition that does. If this holds, three
    // `series` instances carrying QQQ / SPY / UCTA50 will hold too — the pane
    // model cannot tell them apart, which is the entire point.
    __setPaneModeForTest('panes')
    const mk = (n) => ({
      instanceId: `inst:movingAverage:${n}`, defId: 'movingAverage', hidden: false,
      inputs: {}, placement: { target: 'pane' },
    })
    const instances = [mk(1), mk(2), mk(3)]
    const cs = { indicatorInstances: instances }
    const keys = keysOf(layoutFor(instances, cs))
    expect(keys).toHaveLength(3)
    expect(new Set(keys).size).toBe(3)

    // …and three DISTINCT pane indices.
    const layout = layoutFor(instances, cs)
    const idx = instances.map((i) => planFor(i, cs, layout).paneIndex)
    expect(new Set(idx).size).toBe(3)
  })

  it('⭐ §30 deleting the MIDDLE one leaves the other two intact', () => {
    __setPaneModeForTest('panes')
    const mk = (n) => ({
      instanceId: `inst:movingAverage:${n}`, defId: 'movingAverage', hidden: false,
      inputs: {}, placement: { target: 'pane' },
    })
    const after = [mk(1), mk(3)]
    const cs = { indicatorInstances: after }
    const keys = keysOf(layoutFor(after, cs))
    expect(keys).toEqual(['inst:movingAverage:1', 'inst:movingAverage:3'])
  })
})

describe('§9 · LEGACY `@<defId>` FOLLOW TARGETS STILL RESOLVE', () => {
  it('⭐ an old definition-addressed target finds the definition\'s pane', () => {
    // Nothing shipped stores one — a target equal to the default has its key
    // DELETED — but interpreting it costs three lines and removes a silent
    // disappearance. Read compatibility, never a rewrite.
    __setPaneModeForTest('panes')
    const rsi = inst('rsi')
    const follower = {
      instanceId: 'inst:movingAverage:9', defId: 'movingAverage', hidden: false,
      inputs: {}, placement: { target: '@rsi' },       // the OLD vocabulary
    }
    const instances = [rsi, follower]
    const cs = { indicatorInstances: instances }
    const layout = layoutFor(instances, cs)

    const plan = planFor(follower, cs, layout)
    expect(plan).toBeTruthy()
    expect(plan.paneIndex).toBe(layout.panes.find((p) => p.key === host('rsi')).index)
  })
})

// ─── §15, §22 · WHAT THE HOST-KEY WIDENING MUST **NOT** TOUCH ───────────────
//
// ⛔⛔ THE FIRST CUT OF P2.0c FAILED 180 ENGINE TESTS, and every one of them was
// the same mistake wearing a different hat: `key` inside `resolvePlacement` was
// answering FOUR questions at once, and widening it to the host instance widened
// all four. Three of them are DEFINITION questions and had to stay put:
//
//   1. the `'bands'`-mode named price scale  — `'rsi'`, not `'legacy:rsi'`
//   2. the `'bands'`-mode band lookup        — `paneMargins['rsi']`
//   3. the legacy `volumeOverlayIndicators`  — `cs` stores definition ids
//
// Only the FOURTH — which pane in `paneLayout.panes` this instance hosts — is
// about identity, and it is the only one that moved. These cases are the rail:
// re-widen any of the three and the byte-exact parity suites go red, but they go
// red 180 at a time in nine files, which is a diagnosis nobody wants twice.
describe('§15, §22 · the widening is SURGICAL — three definition questions stay', () => {
  const bandCtx = (instance, margins, volOverlay = []) => ({
    targetOf: () => 'pane',
    derivedTargetOf: () => null,
    paneMargins: margins,
    paneLayout: null,
    volSeparatePane: volOverlay.length > 0,
    volOverlaySet: new Set(volOverlay),
    VOL_PANE_INDEX: 1,
  })

  it('⛔ 1 · the `bands` scale is named after the DEFINITION, never the host', () => {
    // `'rsi'` is a PRICE SCALE ID the renderer keys its axis by, not a pane key.
    // Renaming it to `'legacy:rsi'` moved every series onto a brand-new axis with
    // none of the old one's options — the shape the nine flip-parity suites pin
    // byte for byte, and the discriminator `flipB`'s `rsiSeries()` uses.
    __setPaneModeForTest('bands')
    const i = inst('rsi')
    const plan = resolvePlacement(i, registry.getDefinition('rsi'),
      bandCtx(i, { rsi: { top: 0.85, bottom: 0 } }))
    expect(plan.scaleId, 'the named scale took the host key').toBe('rsi')
    __setPaneModeForTest(null)
  })

  it('⛔ 2 · the `bands` band is looked up by the DEFINITION id', () => {
    // Same key, second reader. A miss here does not throw — it silently returns
    // the 0.82/0 fallback band, so the indicator draws in a plausible-looking
    // slice that is simply not the one the layout reserved.
    __setPaneModeForTest('bands')
    const i = inst('rsi')
    const mine = { top: 0.85, bottom: 0 }
    const plan = resolvePlacement(i, registry.getDefinition('rsi'), bandCtx(i, { rsi: mine }))
    expect(plan.scaleOptions.scaleMargins, 'the band lookup took the host key')
      .toEqual(mine)
    __setPaneModeForTest(null)
  })

  it('⛔ 3 · the legacy volume-overlay list is matched by DEFINITION id', () => {
    // `cs.volumeOverlayIndicators` is READ-ONLY legacy data full of definition
    // ids. Matching it against the host key never matched, and an oscillator the
    // member had overlaid on volume quietly went back to a pane of its own.
    __setPaneModeForTest('bands')
    const i = inst('rsi')
    const plan = resolvePlacement(i, registry.getDefinition('rsi'),
      bandCtx(i, { rsi: { top: 0.85, bottom: 0 } }, ['rsi']))
    expect(plan.paneIndex, 'the legacy overlay list stopped being read').toBe(1)
    expect(plan.scaleId).toBe('left')
    __setPaneModeForTest(null)
  })

  it('⭐ 4 · …and the pane lookup DOES take the host key — the half that moved', () => {
    __setPaneModeForTest('panes')
    const a = { instanceId: 'inst:rsi:1', defId: 'rsi', inputs: {}, hidden: false }
    const b = { instanceId: 'inst:rsi:2', defId: 'rsi', inputs: {}, hidden: false }
    const instances = [a, b]
    const cs = { indicatorInstances: instances }
    const layout = layoutFor(instances, cs)
    expect(keysOf(layout)).toEqual(['inst:rsi:1', 'inst:rsi:2'])
    expect(planFor(a, cs, layout).paneIndex)
      .not.toBe(planFor(b, cs, layout).paneIndex)
  })

  it('⭐ 5 · the definition behind each host is carried BESIDE the key', () => {
    // `defByKey` is what lets a definition-shaped consumer — pane heights, the
    // right-click menu, the `'bands'` map — get back from a host to its
    // definition WITHOUT parsing the key. The moment a consumer starts splitting
    // on `':'` the key has become a format instead of an id.
    __setPaneModeForTest('panes')
    const a = { instanceId: 'inst:rsi:1', defId: 'rsi', inputs: {}, hidden: false }
    const b = inst('macd')
    const layout = layoutFor([a, b], { indicatorInstances: [a, b] })
    expect(layout.defByKey.get('inst:rsi:1')).toBe('rsi')
    expect(layout.defByKey.get('legacy:macd')).toBe('macd')
  })

  it('⛔ 6 · the `bands` MAP is definition-keyed, because its readers are', () => {
    // Two readers, one map: `paneMargins[def.id]` above, and `chartRegion`'s
    // bands resolver, whose key becomes the right-click menu's `region.key` —
    // and that menu is definition-shaped end to end.
    __setPaneModeForTest('panes')
    const instances = [inst('rsi'), inst('macd')]
    const layout = layoutFor(instances, { indicatorInstances: instances })
    expect(Object.keys(layout.bands).sort()).toEqual(['macd', 'main', 'rsi'])
  })
})

// ─── §22 · THE VOLUME PANE IS A **SHARED HOST**, AND IT DID NOT MOVE ─────────
//
// ⛔⛔ THE OTHER HALF OF THE BLAST RADIUS. `excludeKeys` subtracts the indicators
// that reserve no pane of their own, and `StockChart` fed it the legacy
// definition-keyed volume-overlay list. Pane keys became instance ids, so the
// subtraction stopped matching ANYTHING: every oscillator the member had overlaid
// onto volume silently reserved a band for a pane the binder never creates, and
// every index below it was one out — the same off-by-one `orderedPaneKeys` skips
// hidden instances to avoid, arriving by a second door.
//
// ⭐ TWO SETS, TWO DOMAINS, ON PURPOSE. `volumeOverlayKeys` stays keyed by
// DEFINITION because its readers are definition questions (`placement.js`'s
// overlay branch, and the legacy list itself, which stores defIds and is never
// rewritten). `volumeOverlayPaneKeys` is the same answer in pane-key language.
describe('§22 · a volume overlay reserves NO pane, in pane-key language', () => {
  const onVolume = (defId, instanceId) => ({
    instanceId, defId, inputs: {}, hidden: false, placement: { target: 'volume' },
  })

  it('⛔ an overlaid oscillator reserves no pane — the subtraction still bites', () => {
    __setPaneModeForTest('panes')
    const overlaid = onVolume('rsi', 'legacy:rsi')
    const keeps = inst('macd')
    const instances = [overlaid, keeps]
    const cs = { indicatorInstances: instances }
    const layout = computePaneLayout(instances, {
      chartHeight: 800,
      hasVolumeBand: false,
      excludeKeys: new Set([
        ...volumeOverlayPaneKeys(instances, cs), ...paneFollowerKeys(instances, cs),
      ]),
      includeKeys: paneOwnKeys(instances, cs),
      firstPaneIndex: 1,
    })
    expect(keysOf(layout), 'the overlaid RSI reserved a pane nothing draws in')
      .toEqual([host('macd')])
  })

  it('⛔ …and the DEFINITION-keyed set is unchanged, because its readers are', () => {
    const overlaid = onVolume('rsi', 'legacy:rsi')
    const cs = { indicatorInstances: [overlaid] }
    expect([...volumeOverlayKeys([overlaid], cs)]).toEqual(['rsi'])
    expect([...volumeOverlayPaneKeys([overlaid], cs)]).toEqual(['legacy:rsi'])
  })

  it('⭐ TWO instances of one definition, one overlaid and one not, separate', () => {
    // The case a definition-keyed exclusion cannot express at all: subtracting
    // `'rsi'` would have taken BOTH out, and the one that still owns a pane would
    // have vanished.
    __setPaneModeForTest('panes')
    const a = onVolume('rsi', 'inst:rsi:1')
    const b = { instanceId: 'inst:rsi:2', defId: 'rsi', inputs: {}, hidden: false }
    const instances = [a, b]
    const cs = { indicatorInstances: instances }
    const layout = computePaneLayout(instances, {
      chartHeight: 800,
      hasVolumeBand: false,
      excludeKeys: new Set([
        ...volumeOverlayPaneKeys(instances, cs), ...paneFollowerKeys(instances, cs),
      ]),
      includeKeys: paneOwnKeys(instances, cs),
      firstPaneIndex: 1,
    })
    expect(keysOf(layout), 'the overlaid copy took its sibling\'s pane with it')
      .toEqual(['inst:rsi:2'])
  })

  it('⛔ a HIDDEN overlaid instance is in neither set', () => {
    const hiddenOverlay = { ...onVolume('rsi', 'legacy:rsi'), hidden: true }
    const cs = { indicatorInstances: [hiddenOverlay] }
    expect([...volumeOverlayPaneKeys([hiddenOverlay], cs)]).toEqual([])
    expect([...volumeOverlayKeys([hiddenOverlay], cs)]).toEqual([])
  })
})

// ─── §27 · A PANE KEY IS DERIVED, NEVER STORED ──────────────────────────────
//
// ⭐⭐ THE WHOLE REASON THIS CHANGE NEEDS NO MIGRATION. `orderedPaneKeys` builds
// the key set from the live instance list on every paint; what the blob carries
// is `instanceId`, `placement.target` and `placement.position` — three facts that
// did not change shape. So a chart saved before P2.0c and reloaded after it gets
// the new identity for free, and a chart saved after it can be read by code that
// predates it.
//
// ⛔ AND THE RAIL IS THAT NO PANE KEY EVER REACHES THE BLOB. The moment one is
// persisted it becomes a second source of truth that the next add, delete or
// reorder can contradict — the failure mode `paneLayout` was decomposed to end.
describe('§27 · template / reload — the blob carries instances, not panes', () => {
  /** A JSON *STRING*, per the migration suite's rule: an object literal would
   *  skip the very step being exercised. */
  const reload = (cs) => mergeChartSettings(JSON.parse(JSON.stringify(cs)))

  const twoOwnPaneRsis = () => {
    const base = mergeChartSettings({ indicators: { rsi: { enabled: true } } })
    const seeded = base.indicatorInstances.find((i) => i.defId === 'rsi')
    expect(seeded, 'the fold seeded no rsi instance').toBeTruthy()
    return {
      ...base,
      indicatorInstances: [
        seeded,
        { ...seeded, instanceId: 'inst:rsi:1', inputs: { ...(seeded.inputs || {}), period: 7 } },
      ],
    }
  }

  it('⭐⭐ two own-pane RSIs survive a save/reload and still make TWO panes', () => {
    __setPaneModeForTest('panes')
    const saved = twoOwnPaneRsis()
    const before = layoutFor(saved.indicatorInstances, saved)
    expect(keysOf(before)).toEqual(['legacy:rsi', 'inst:rsi:1'])

    const back = reload(saved)
    const ids = back.indicatorInstances.filter((i) => i.defId === 'rsi').map((i) => i.instanceId)
    expect(ids, 'the reload dropped or renamed an instance').toEqual(['legacy:rsi', 'inst:rsi:1'])
    expect(keysOf(layoutFor(back.indicatorInstances, back)), 'the panes did not come back')
      .toEqual(keysOf(before))
  })

  it('⛔ nothing pane-shaped is written to the blob at all', () => {
    // Structural, not a spot check: walk the serialised blob and assert no key
    // and no string value is one of the pane keys the layout just derived.
    __setPaneModeForTest('panes')
    const saved = twoOwnPaneRsis()
    const keys = new Set(keysOf(layoutFor(saved.indicatorInstances, saved)))
    const seen = []
    const walk = (node, path) => {
      if (node === null || typeof node !== 'object') {
        if (typeof node === 'string' && keys.has(node) && !/instanceId$/.test(path)) {
          seen.push(`${path} = ${node}`)
        }
        return
      }
      for (const [k, v] of Object.entries(node)) {
        if (keys.has(k)) seen.push(`${path}.${k} (as a KEY)`)
        walk(v, `${path}.${k}`)
      }
    }
    walk(JSON.parse(JSON.stringify(reload(saved))), 'cs')
    expect(seen, 'a pane key reached the persisted blob — it is DERIVED, and a '
      + 'stored copy is a second source of truth the next add or delete contradicts')
      .toEqual([])
  })

  it('⭐ a MOVE is persisted as a target on the instance, and only there', () => {
    // `setInstanceDisplayTarget` is the one writer. It stores `placement.target`
    // on the instance — never a pane key, never an index — which is why moving a
    // pane cannot desynchronise a layout that is rebuilt from scratch anyway.
    __setPaneModeForTest('panes')
    const cs = mergeChartSettings({ indicators: { rsi: { enabled: true } } })
    const moved = setInstanceDisplayTarget(cs, 'legacy:rsi', 'volume', registry)
    const inst0 = moved.indicatorInstances.find((i) => i.instanceId === 'legacy:rsi')
    expect(inst0.placement.target).toBe('volume')
    expect(Object.keys(inst0.placement).some((k) => /pane(Key|Index)/i.test(k))).toBe(false)
    // …and it survives the round trip.
    expect(reload(moved).indicatorInstances.find((i) => i.instanceId === 'legacy:rsi')
      .placement.target).toBe('volume')
  })

  it('⭐ a freshly ADDED second instance gets a pane without any migration', () => {
    // The add path, not a hand-built fixture: `addInstance` mints the id and the
    // layout picks it up on the next paint with nothing else written.
    __setPaneModeForTest('panes')
    const one = mergeChartSettings({ indicators: { rsi: { enabled: true } } })
    const two = addInstance(one, 'rsi', registry)
    const ids = two.indicatorInstances.filter((i) => i.defId === 'rsi').map((i) => i.instanceId)
    expect(ids.length, 'addInstance did not mint a second RSI').toBe(2)
    expect(keysOf(layoutFor(two.indicatorInstances, two))).toEqual(ids)
  })
})

// ─── §22 · "KEEP THIS PANE ALIVE" IS A HOST-KEY COMPARISON ──────────────────
//
// `paneOwnersNeeded` answers "whose pane must survive its owner being hidden,
// because something VISIBLE is still drawing in it". It compares the host a
// follower names against the follower's own key — and the follower's own key is
// its INSTANCE id now, not its definition.
//
// ⚠️ HONEST NOTE ON THE COMPARISON ITSELF. Moving that guard from `inst.defId` to
// `inst.instanceId` has NO REACHABLE BEHAVIOUR CHANGE, and this block does not
// pretend otherwise: the loop already skips every hidden instance, and `keepKeys`
// is only ever consulted FOR a hidden one, so the only input that could tell the
// two guards apart — an instance naming itself as its own host — can never reach
// the difference. It was changed for consistency with the rest of the host-key
// vocabulary, and it is recorded as such rather than dressed in a case that would
// pass either way. What IS load-bearing, and what these cases pin, is that the
// host `owner` carries is an instance id end to end.
describe('§22 · paneOwnersNeeded compares host key to HOST KEY', () => {
  it('⭐ a hidden RSI keeps its pane while MA(RSI) is still visible', () => {
    const rsi = inst('rsi', { hidden: true })
    const follower = {
      instanceId: 'inst:ma:1', defId: 'movingAverage', hidden: false,
      inputs: {}, placement: { target: `@${host('rsi')}` },
    }
    const instances = [rsi, follower]
    const cs = { indicatorInstances: instances }
    expect([...paneOwnersNeeded(instances, cs)]).toEqual([host('rsi')])
    __setPaneModeForTest('panes')
    expect(keysOf(layoutFor(instances, cs)), 'hiding RSI took its follower with it')
      .toEqual([host('rsi')])
  })

  it('⛔⛔ a hidden instance that names ITSELF keeps NOTHING alive', () => {
    // The hidden skip is what makes this true, and it is the property worth
    // pinning: an empty rectangle must not survive the eye icon. Nothing visible
    // draws in this pane, so nothing keeps it.
    const selfHosted = inst('rsi', { hidden: true, placement: { target: `@${host('rsi')}` } })
    const instances = [selfHosted]
    const cs = { indicatorInstances: instances }
    expect([...paneOwnersNeeded(instances, cs)],
      'a hidden instance kept its OWN pane alive by naming itself')
      .toEqual([])
    __setPaneModeForTest('panes')
    expect(keysOf(layoutFor(instances, cs))).toEqual([])
  })

  it('⭐ …and with something visible in it, the SAME pane does survive', () => {
    // Non-vacuity for the case above: the difference is the second instance, not
    // the hiding.
    const selfHosted = inst('rsi', { hidden: true, placement: { target: `@${host('rsi')}` } })
    const guest = {
      instanceId: 'inst:ma:1', defId: 'movingAverage', hidden: false,
      inputs: {}, placement: { target: `@${host('rsi')}` },
    }
    const instances = [selfHosted, guest]
    const cs = { indicatorInstances: instances }
    expect([...paneOwnersNeeded(instances, cs)]).toEqual([host('rsi')])
  })
})
