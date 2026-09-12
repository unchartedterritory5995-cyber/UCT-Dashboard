import { describe, it, expect } from 'vitest'
import { computePaneLayout, __setPaneModeForTest } from './paneLayout'
import { paneOwnKeys, paneFollowerKeys, resolveDisplayTarget } from './displayTarget'
import { resolvePlacement } from './placement'
import * as registry from './nativeRegistry'

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
const onPane = (defId) => inst(defId, { placement: { target: 'pane' } })

const layoutFor = (instances, cs = {}) => computePaneLayout(instances, {
  chartHeight: 800,
  hasVolumeBand: false,
  excludeKeys: new Set([...paneFollowerKeys(instances, cs)]),
  includeKeys: paneOwnKeys(instances, cs),
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
    expect(keysOf(layoutFor(instances, cs))).toContain(defId)
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
    expect(keysOf(layoutFor(instances, cs))).not.toContain(defId)
  })

  it.each(PANE_DEFAULT_IDS)('%s with NO instance placement still gets its pane', (defId) => {
    __setPaneModeForTest('panes')
    const instances = [inst(defId)]
    const cs = { indicatorInstances: instances }
    expect(keysOf(layoutFor(instances, cs))).toContain(defId)
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
    expect(keysOf(layout)).toContain('movingAverage')

    // The pane one binds into the pane; the price one takes the price branch and
    // never consults the layout at all.
    expect(Number.isInteger(planFor(inPane, cs, layout).paneIndex)).toBe(true)
    expect(planFor(onPrice, cs, layout).scaleId).toBe('right')
  })

  it('⚠️ TWO own-pane instances of ONE definition SHARE that definition\'s pane', () => {
    // ⛔ NOT A DEFECT THIS SLICE INTRODUCED, AND NOT SILENTLY ACCEPTED EITHER.
    // `orderedPaneKeys` dedupes by `defId` — `seen.add(id)` — so the pane model
    // has always been ONE PANE PER DEFINITION, shared by its instances. Two RSIs
    // behave the same way today. This case exists to pin that as the CURRENT
    // model so a future phase that wants per-instance panes changes it
    // deliberately, against a red test, rather than by accident.
    __setPaneModeForTest('panes')
    const a = { ...onPane('movingAverage'), instanceId: 'inst:movingAverage:1' }
    const b = { ...onPane('movingAverage'), instanceId: 'inst:movingAverage:2' }
    const instances = [a, b]
    const cs = { indicatorInstances: instances }

    const keys = keysOf(layoutFor(instances, cs))
    expect(keys.filter((k) => k === 'movingAverage')).toHaveLength(1)
  })

  it('⭐ two DIFFERENT price-default definitions each get their own pane', () => {
    __setPaneModeForTest('panes')
    const instances = [onPane('movingAverage'), onPane('bb')]
    const cs = { indicatorInstances: instances }
    const keys = keysOf(layoutFor(instances, cs))
    expect(keys).toContain('movingAverage')
    expect(keys).toContain('bb')
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

    expect(paneOwnKeys(instances, cs).has('movingAverage')).toBe(false)
    const keys = keysOf(layoutFor(instances, cs))
    expect(keys).toContain('rsi')
    expect(keys).not.toContain('movingAverage')
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
    expect(paneFollowerKeys(instances, cs).has('movingAverage')).toBe(true)
    expect(keysOf(layoutFor(instances, cs))).not.toContain('movingAverage')
  })
})

describe('§O · MOVE BACK — the pane goes away again', () => {
  it('⭐ price → pane → price leaves no zombie pane', () => {
    __setPaneModeForTest('panes')
    const before = [inst('movingAverage')]
    const moved = [onPane('movingAverage')]
    const back = [inst('movingAverage')]

    expect(keysOf(layoutFor(before, { indicatorInstances: before }))).not.toContain('movingAverage')
    expect(keysOf(layoutFor(moved, { indicatorInstances: moved }))).toContain('movingAverage')
    expect(keysOf(layoutFor(back, { indicatorInstances: back }))).not.toContain('movingAverage')
  })

  it('⭐ removing the instance entirely removes the pane', () => {
    __setPaneModeForTest('panes')
    const withIt = [onPane('movingAverage'), inst('rsi')]
    const without = [inst('rsi')]
    expect(keysOf(layoutFor(withIt, { indicatorInstances: withIt }))).toContain('movingAverage')
    expect(keysOf(layoutFor(without, { indicatorInstances: without }))).not.toContain('movingAverage')
  })
})

describe('§J, §R · REGRESSIONS THE WIDENING MUST NOT CAUSE', () => {
  it('⛔ a HIDDEN own-pane instance reserves nothing', () => {
    __setPaneModeForTest('panes')
    const hidden = { ...onPane('movingAverage'), hidden: true }
    const instances = [hidden]
    expect(paneOwnKeys(instances, { indicatorInstances: instances }).has('movingAverage')).toBe(false)
    expect(keysOf(layoutFor(instances, { indicatorInstances: instances }))).not.toContain('movingAverage')
  })

  it('⛔ a VOLUME target does not become a pane', () => {
    __setPaneModeForTest('panes')
    const v = inst('movingAverage', { placement: { target: 'volume' } })
    const instances = [v]
    const cs = { indicatorInstances: instances }
    expect(resolveDisplayTarget(v, cs)).toBe('volume')
    expect(paneOwnKeys(instances, cs).has('movingAverage')).toBe(false)
    expect(keysOf(layoutFor(instances, cs))).not.toContain('movingAverage')
  })

  it('⛔ an explicit PRICE target does not become a pane', () => {
    __setPaneModeForTest('panes')
    const p = inst('rsi', { placement: { target: 'price' } })
    const instances = [p]
    const cs = { indicatorInstances: instances }
    expect(resolveDisplayTarget(p, cs)).toBe('price')
    expect(paneOwnKeys(instances, cs).has('rsi')).toBe(false)
  })

  it('⭐ ordinary pane definitions are completely unaffected', () => {
    __setPaneModeForTest('panes')
    const instances = [inst('rsi'), inst('macd')]
    const cs = { indicatorInstances: instances }
    const keys = keysOf(layoutFor(instances, cs))
    expect(keys).toContain('rsi')
    expect(keys).toContain('macd')
  })

  it('⛔ an ABSENT includeKeys behaves exactly as before — every existing caller', () => {
    __setPaneModeForTest('panes')
    const instances = [onPane('movingAverage'), inst('rsi')]
    const without = computePaneLayout(instances, { chartHeight: 800, firstPaneIndex: 1 })
    // No include set ⇒ the old answer: only the pane-declaring definition.
    expect(without.panes.map((p) => p.key)).toEqual(['rsi'])
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
    expect(keysOf(layout)).toContain('movingAverage')
    const plan = planFor(stored.indicatorInstances[0], stored, layout)
    expect(plan).toBeTruthy()
    expect(Number.isInteger(plan.paneIndex)).toBe(true)

    // ⛔ NO WRITE-ON-LOAD. Realisation was the defect; the stored bytes were
    // always correct and must not be rewritten.
    expect(JSON.stringify(stored)).toBe(snapshot)
  })
})
