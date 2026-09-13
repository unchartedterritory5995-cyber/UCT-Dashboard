// app/src/components/chart/engine/__tests__/paneComposition.test.js
//
// ─── P2.3 · MULTI-SERIES PANES, THROUGH THE MENU A MEMBER ACTUALLY USES ──────
//
// ⭐⭐ THE CLAIM. A trader can put two unrelated series in one pane by choosing a
// destination, and every layer underneath is the one that was already there:
// `createDirectSeries` mints the instance, `setInstanceDisplayTarget` writes the
// target, `resolveDisplayTarget` reads it, `paneOwnKeys`/`paneFollowerKeys` sort
// hosts from guests, `computePaneLayout` allocates, `resolvePlacement` binds.
// P2.3 added an option list and one writer guard; these cases have to fail if
// either is wrong AND if any of that older machinery is.
//
// ⛔ NOTHING HERE IS MOCKED THAT COULD ANSWER THE SAME WAY REGARDLESS OF LAYOUT.
// Panes are counted from a real `computePaneLayout` over real instances, and
// "they share a pane" is asserted as two placements resolving to ONE index — not
// as a stored string.
//
// ⛔ AND EVERY COMPOSITION CASE RUNS FOR AN ORDINARY SECURITY *AND* FOR BREADTH.
// The Alerts lesson: a fixture that cannot express the variant cannot protect the
// class. If a breadth-only branch ever appears, the UCTA50 row fails and the QQQ
// row does not.

import { describe, it, expect, beforeEach } from 'vitest'
import * as registry from './../nativeRegistry'
import { mergeChartSettings } from '../../chartDefaults'
import { createDirectSeries, lastCreatedInstance } from '../../discoveryCatalog'
import {
  addInstance, removeInstance, setInstanceDisplayTarget, setInstanceInput, findInstance,
} from '../instanceControls'
import {
  displayTargetOptions, resolveDisplayTarget, paneOwnKeys, paneFollowerKeys, paneOwnersNeeded,
} from '../displayTarget'
import { computePaneLayout, __setPaneModeForTest } from '../paneLayout'
import { resolvePlacement } from '../placement'
import { symbolSource, paneOfTarget } from '../sourceRef'

const defOf = (id) => registry.getDefinition(id)

// ─── fixtures: the real writers, never a hand-built blob ────────────────────

/** Add one direct series and hand back the settings AND the id it minted. */
function addSeries(cs, symbol) {
  const next = createDirectSeries(cs, symbolSource(symbol, 'close'), registry, { name: symbol })
  const minted = lastCreatedInstance(cs, next)
  expect(minted, `createDirectSeries refused ${symbol}`).toBeTruthy()
  return [next, minted.instanceId]
}

/** Add a moving average reading `source`, and hand back its id. */
function addMa(cs, source) {
  const added = addInstance(cs, 'movingAverage', registry)
  const minted = lastCreatedInstance(cs, added)
  expect(minted, 'addInstance refused movingAverage').toBeTruthy()
  const next = setInstanceInput(added, minted.instanceId, 'source', source, registry)
  expect(next, 'the source write was refused').not.toBe(added)
  return [next, minted.instanceId]
}

const live = (cs) => (cs.indicatorInstances || []).filter((i) => i && i.deleted !== true)

/** The REAL layout, over the real instances, with the real exclusion sets. */
function layoutOf(cs) {
  const instances = live(cs)
  return computePaneLayout(instances, {
    chartHeight: 800,
    hasVolumeBand: false,
    excludeKeys: new Set([...paneFollowerKeys(instances, cs)]),
    includeKeys: paneOwnKeys(instances, cs),
    keepKeys: paneOwnersNeeded(instances, cs),
    firstPaneIndex: 1,
  })
}

/** Where one instance's series is actually BOUND — the renderer's answer. */
function paneIndexOf(cs, instanceId) {
  const inst = findInstance(cs, instanceId)
  if (!inst) return null
  const layout = layoutOf(cs)
  const placed = resolvePlacement(inst, defOf(inst.defId), {
    paneLayout: layout,
    targetOf: (i) => resolveDisplayTarget(i, cs),
    derivedTargetOf: () => null,
  })
  return placed ? placed.paneIndex : null
}

const labels = (cs, instanceId) =>
  displayTargetOptions(findInstance(cs, instanceId), cs, defOf).map((o) => o.label)
const values = (cs, instanceId) =>
  displayTargetOptions(findInstance(cs, instanceId), cs, defOf).map((o) => o.value)

beforeEach(() => { __setPaneModeForTest('panes') })

// ─── §3, §10 · what the menu offers, and what it calls things ───────────────

describe('the destinations a member is offered', () => {
  it('⭐ the three every chart has, then the panes the member made', () => {
    let cs = mergeChartSettings({})
    let qqq; [cs, qqq] = addSeries(cs, 'QQQ')
    let spy; [cs, spy] = addSeries(cs, 'SPY')

    // SPY's own menu: the shared three, then QQQ — and NOT SPY itself.
    expect(labels(cs, spy)).toEqual(['Price', 'Volume', 'Own pane', 'QQQ'])
    expect(values(cs, spy)).toEqual(['price', 'volume', 'pane', paneOfTarget(qqq)])
  })

  it('⛔ …and never itself — a series cannot be its own guest', () => {
    let cs = mergeChartSettings({})
    let qqq; [cs, qqq] = addSeries(cs, 'QQQ')
    expect(values(cs, qqq)).not.toContain(paneOfTarget(qqq))
    // The WRITER refuses it too, by identity, so no other door can store it.
    expect(setInstanceDisplayTarget(cs, qqq, paneOfTarget(qqq), registry)).toBe(cs)
  })

  it('⛔ a guest is never offered as a host — which is why a cycle cannot be built', () => {
    let cs = mergeChartSettings({})
    let qqq; [cs, qqq] = addSeries(cs, 'QQQ')
    let spy; [cs, spy] = addSeries(cs, 'SPY')
    cs = setInstanceDisplayTarget(cs, spy, paneOfTarget(qqq), registry)
    // SPY now draws in QQQ's pane. QQQ's menu must not offer SPY's "pane",
    // because SPY no longer owns one — offering it would let the member point the
    // two at each other and leave both with nowhere to draw.
    expect(values(cs, qqq)).not.toContain(paneOfTarget(spy))
    expect(labels(cs, qqq)).toEqual(['Price', 'Volume', 'Own pane'])
  })

  it('⭐ two of the SAME symbol are told apart the way the legend tells them apart', () => {
    let cs = mergeChartSettings({})
    let a; [cs, a] = addSeries(cs, 'QQQ')
    let b; [cs, b] = addSeries(cs, 'QQQ')
    let spy; [cs, spy] = addSeries(cs, 'SPY')
    expect(labels(cs, spy)).toEqual(['Price', 'Volume', 'Own pane', 'QQQ #1', 'QQQ #2'])
    // ⛔ AND THEY ARE SEPARATELY TARGETABLE — the point of instance-hosted panes.
    const vals = values(cs, spy)
    expect(vals).toContain(paneOfTarget(a))
    expect(vals).toContain(paneOfTarget(b))
    expect(new Set(vals).size, 'two hosts collapsed to one option').toBe(vals.length)
  })

  it('⛔ a dead host leaves the menu — it is not offered to anybody', () => {
    let cs = mergeChartSettings({})
    let qqq; [cs, qqq] = addSeries(cs, 'QQQ')
    let spy; [cs, spy] = addSeries(cs, 'SPY')
    expect(values(cs, spy)).toContain(paneOfTarget(qqq))
    cs = removeInstance(cs, qqq, registry)
    expect(values(cs, spy)).not.toContain(paneOfTarget(qqq))
    expect(labels(cs, spy)).toEqual(['Price', 'Volume', 'Own pane'])
  })

  it('⛔ a plain price overlay still gets NO menu — the gate that predates this', () => {
    // Bollinger declares `price` and reads no source: one place to draw, and an
    // inert entry for somewhere it cannot go is the thing the gate prevents.
    const cs = mergeChartSettings({ indicators: { bb: { enabled: true } } })
    const bb = live(cs).find((i) => i.defId === 'bb')
    expect(bb, 'no Bollinger instance to test the gate with').toBeTruthy()
    expect(displayTargetOptions(bb, cs, defOf)).toEqual([])
  })

  it('⭐⭐ …but an MA reading a SYMBOL does — the gate that was wrong', () => {
    // ⚰️ MEASURED: the old gate asked `derivedTargetFor` for a source pane and
    // bailed when it came back null. A `sym:` source resolves NO pane by design —
    // a canonical symbol is not an instance — so `MA(QQQ)`, the headline
    // workflow, had no destination menu at all while `MA(close)` had one.
    let cs = mergeChartSettings({})
    let ma; [cs, ma] = addMa(cs, symbolSource('QQQ', 'close'))
    expect(labels(cs, ma)).toEqual(['Price', 'Volume', 'Own pane'])
  })
})

// ─── §6, §7, §8 · composing, and taking it apart again ─────────────────────

const FAMILIES = [
  ['an ordinary security', 'QQQ', 'SPY'],
  ['a breadth measure', 'UCTA50', 'UCTNH'],
]

describe.each(FAMILIES)('two series in one pane — %s', (_name, A, B) => {
  it('⭐⭐ starts as two panes, becomes one, and comes back as two', () => {
    let cs = mergeChartSettings({})
    let a; [cs, a] = addSeries(cs, A)
    let b; [cs, b] = addSeries(cs, B)

    // Two own panes.
    expect(layoutOf(cs).panes.length).toBe(2)
    const before = [paneIndexOf(cs, a), paneIndexOf(cs, b)]
    expect(before[0]).not.toBe(before[1])

    // ⭐ B JOINS A'S PANE. One write, through the one writer.
    cs = setInstanceDisplayTarget(cs, b, paneOfTarget(a), registry)
    expect(findInstance(cs, b).placement.target).toBe(paneOfTarget(a))
    expect(layoutOf(cs).panes.length, 'the pane B vacated was not reclaimed').toBe(1)
    expect(paneIndexOf(cs, b), 'B did not land in A\'s pane').toBe(paneIndexOf(cs, a))
    expect(paneIndexOf(cs, a), 'A stopped owning a pane').not.toBeNull()

    // ⛔ AND NOTHING ABOUT THE DATA MOVED. Placement is not sourcing.
    expect(findInstance(cs, b).inputs.source).toBe(symbolSource(B, 'close'))
    expect(findInstance(cs, a).inputs.source).toBe(symbolSource(A, 'close'))

    // ⭐ BACK TO ITS OWN PANE — two panes again, no zombie, no data reset.
    cs = setInstanceDisplayTarget(cs, b, 'pane', registry)
    expect(layoutOf(cs).panes.length).toBe(2)
    expect(paneIndexOf(cs, b)).not.toBe(paneIndexOf(cs, a))
    expect(findInstance(cs, b).inputs.source).toBe(symbolSource(B, 'close'))
    // ⛔ "BACK TO DEFAULT" IS SPELLED BY ABSENCE — `dataSeries` declares `pane`,
    // so the key is DELETED rather than written, and the blob is the shape a
    // chart that never touched the control writes.
    expect(findInstance(cs, b).placement?.target).toBeUndefined()
  })

  it('⭐⭐ …and a moving average of it joins the same pane — the headline', () => {
    let cs = mergeChartSettings({})
    let host; [cs, host] = addSeries(cs, A)
    let ma; [cs, ma] = addMa(cs, symbolSource(A, 'close'))

    // The MA's DEFAULT is the candles — its source is a canonical symbol, not the
    // host instance, and P2.3 does not change that.
    expect(resolveDisplayTarget(findInstance(cs, ma), cs)).toBe('price')

    // ⭐ THE MEMBER PICKS THE HOST BY NAME. The option is there and it is labelled
    // with the symbol, not with `dataSeries` or an instance id.
    const opt = displayTargetOptions(findInstance(cs, ma), cs, defOf)
      .find((o) => o.value === paneOfTarget(host))
    expect(opt, `${A} was not offered to its own moving average`).toBeTruthy()
    expect(opt.label).toBe(A)
    expect(opt.group).toBe('panes')

    cs = setInstanceDisplayTarget(cs, ma, opt.value, registry)
    expect(layoutOf(cs).panes.length).toBe(1)
    expect(paneIndexOf(cs, ma)).toBe(paneIndexOf(cs, host))

    // ⛔⛔ AND THE MA STILL READS THE CANONICAL SYMBOL, NOT THE VISUAL HOST. The
    // whole separation in one assertion: its DATA comes from `sym:`, only its
    // PRESENTATION names the host.
    expect(findInstance(cs, ma).inputs.source).toBe(symbolSource(A, 'close'))

    // ⭐ THE GUEST READS THE HOST'S LADDER, which is what makes the pair legible.
    const placed = resolvePlacement(findInstance(cs, ma), defOf('movingAverage'), {
      paneLayout: layoutOf(cs),
      targetOf: (i) => resolveDisplayTarget(i, cs),
      derivedTargetOf: () => null,
    })
    expect(placed.scaleId).toBe('right')
    expect(placed.scaleOptions, 'a guest rewrote the host\'s scale').toBeNull()
    expect(placed.follows).toBe(host)
  })
})

// ─── §9 · the existing technical workflow, unregressed ─────────────────────

describe('an ordinary technical pane', () => {
  it('⭐ a second oscillator can be sent into the first one\'s pane', () => {
    let cs = mergeChartSettings({ indicators: { rsi: { enabled: true }, mfi: { enabled: true } } })
    const rsi = live(cs).find((i) => i.defId === 'rsi')
    const mfi = live(cs).find((i) => i.defId === 'mfi')
    expect(rsi && mfi, 'the RSI/MFI fixture did not materialise').toBeTruthy()
    expect(layoutOf(cs).panes.length).toBe(2)

    const opt = displayTargetOptions(mfi, cs, defOf).find((o) => o.value === paneOfTarget(rsi.instanceId))
    expect(opt, 'RSI was not offered as a destination').toBeTruthy()
    expect(opt.label).toBe('RSI (14)')

    cs = setInstanceDisplayTarget(cs, mfi.instanceId, opt.value, registry)
    expect(layoutOf(cs).panes.length).toBe(1)
    expect(paneIndexOf(cs, mfi.instanceId)).toBe(paneIndexOf(cs, rsi.instanceId))
  })

  it('⛔ FOLLOW SOURCE and an explicit placement stay distinguishable', () => {
    // `MA(RSI)` FOLLOWS its source: nothing is stored, and the answer is computed
    // from where RSI is. Moving it stores a target that OUTRANKS that. The two
    // must not become the same state, or "put it back with its source" would be
    // unspellable.
    let cs = mergeChartSettings({ indicators: { rsi: { enabled: true } } })
    const rsi = live(cs).find((i) => i.defId === 'rsi')
    let ma; [cs, ma] = addMa(cs, `@${rsi.instanceId}::rsi`)

    // ⚠️ `addInstance` STAMPS THE DECLARED TARGET, and `resolveDisplayTarget`
    // rule (1) deliberately refuses to read a stamp as an override — "a target
    // that restates the definition is not an override". So FOLLOWING is spelled
    // "nothing that differs from the declaration", and the MA still resolves into
    // RSI's pane.
    expect(findInstance(cs, ma).placement?.target).toBe('price')
    expect(resolveDisplayTarget(findInstance(cs, ma), cs)).toBe(paneOfTarget(rsi.instanceId))

    // ⭐ AN EXPLICIT MOVE TO A PANE OF ITS OWN IS A REAL OVERRIDE, and it outranks
    // the derived default — which is the half of the distinction that matters.
    cs = setInstanceDisplayTarget(cs, ma, 'pane', registry)
    expect(findInstance(cs, ma).placement.target).toBe('pane')
    expect(resolveDisplayTarget(findInstance(cs, ma), cs)).toBe('pane')
    expect(paneIndexOf(cs, ma)).not.toBe(paneIndexOf(cs, rsi.instanceId))

    // ⭐ AND CHOOSING THE SOURCE PANE AGAIN RETURNS IT TO *FOLLOWING* — the stored
    // override is deleted, because the chosen target IS what the default resolves
    // to. One spelling of the default.
    cs = setInstanceDisplayTarget(cs, ma, paneOfTarget(rsi.instanceId), registry)
    expect(findInstance(cs, ma).placement?.target).toBeUndefined()
    expect(resolveDisplayTarget(findInstance(cs, ma), cs)).toBe(paneOfTarget(rsi.instanceId))
    expect(paneIndexOf(cs, ma)).toBe(paneIndexOf(cs, rsi.instanceId))
  })
})

// ─── §14 · it survives a round-trip ────────────────────────────────────────

describe('an explicit pane share is ordinary persisted state', () => {
  it('⭐ survives a settings round-trip with no new field and no new id', () => {
    let cs = mergeChartSettings({})
    let qqq; [cs, qqq] = addSeries(cs, 'QQQ')
    let spy; [cs, spy] = addSeries(cs, 'SPY')
    cs = setInstanceDisplayTarget(cs, spy, paneOfTarget(qqq), registry)

    const reloaded = mergeChartSettings(JSON.parse(JSON.stringify(cs)))
    expect(resolveDisplayTarget(findInstance(reloaded, spy), reloaded)).toBe(paneOfTarget(qqq))
    expect(layoutOf(reloaded).panes.length).toBe(1)
    expect(paneIndexOf(reloaded, spy)).toBe(paneIndexOf(reloaded, qqq))

    // ⛔ THE REPRESENTATION IS THE EXISTING ONE: a target on the guest, naming the
    // HOST INSTANCE. No pane id is minted, stored or persisted anywhere.
    const stored = findInstance(reloaded, spy)
    expect(Object.keys(stored.placement)).toEqual(['target'])
    expect(stored.placement.target).toBe(`@${qqq}`)
    expect(JSON.stringify(reloaded)).not.toMatch(/"paneId"|"panes"\s*:/)
  })
})

// ─── §15 · deleting the host ───────────────────────────────────────────────

describe('deleting a pane HOST', () => {
  it('⛔ the guest keeps its data and its source; nothing is gravestoned', () => {
    let cs = mergeChartSettings({})
    let qqq; [cs, qqq] = addSeries(cs, 'QQQ')
    let spy; [cs, spy] = addSeries(cs, 'SPY')
    cs = setInstanceDisplayTarget(cs, spy, paneOfTarget(qqq), registry)

    const after = removeInstance(cs, qqq, registry)
    const guest = findInstance(after, spy)

    // ⭐⭐ THE CANONICAL SOURCE IS UNTOUCHED. `severReferencesTo` severs INSTANCE
    // references (`@inst::plot` → `!@inst::plot`); `sym:SPY:close` is not one, and
    // a canonical symbol cannot be retired by a visual host disappearing.
    expect(guest.inputs.source).toBe(symbolSource('SPY', 'close'))
    expect(guest.inputs.source.startsWith('!')).toBe(false)

    // ⛔ NO PHANTOM PANE. The host is a tombstone, so it allocates nothing —
    // including for the follower that still names it.
    const layout = layoutOf(after)
    expect(layout.panes.map((p) => p.key)).not.toContain(qqq)

    // ⚠️ AND THE EXISTING, DOCUMENTED FAIL-CLOSED ANSWER, PINNED AS-IS: "no pane
    // for the owner means no binding, not a guess" (`placement.js`). The guest
    // binds nothing until the member sends it somewhere — it is NOT silently
    // re-homed onto an arbitrary sibling or onto the candles. This case exists to
    // make that a decision the next reader can see, not an accident.
    expect(paneIndexOf(after, spy)).toBeNull()

    // ⭐ AND IT IS ONE MENU CHOICE AWAY FROM BEING VISIBLE AGAIN.
    const back = setInstanceDisplayTarget(after, spy, 'pane', registry)
    expect(paneIndexOf(back, spy)).not.toBeNull()
  })
})
