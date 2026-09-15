// app/src/components/chart/engine/__tests__/paneStability.repro.test.js
//
// ─── PHASE 0 REPRO: DOES ADDING AN UNRELATED SERIES MOVE AN EXISTING PANE? ───
//
// Owner, on production: "I had an existing chart with Price + Volume in their
// current positions. I added a data series (QQQ). Without touching Volume,
// Volume moved to the TOP of the chart layout by itself."
//
// The invariant under test is the one the brief states:
//
//   ADDING / REMOVING / EDITING ONE SERIES MUST NOT REORDER UNRELATED PANES.
//
// This file is the MEASUREMENT, written before any fix. It drives the REAL
// `addInstance` control and the REAL `resolvePaneOrder`, so whatever it prints
// is what the product does.

import { describe, it, expect } from 'vitest'
import { addInstance, withInstances } from '../instanceControls'
import { resolvePaneOrder, setPaneOrder, PRICE_PANE, VOLUME_PANE } from '../paneOrder'
import { defaultPaneKeys } from '../paneLayout'
import * as registry from '../nativeRegistry'

const instancesOf = (cs) => (Array.isArray(cs.indicatorInstances) ? cs.indicatorInstances : [])

/** The visual stack, exactly as StockChart asks for it. */
const order = (cs, { volumePane = true } = {}) =>
  resolvePaneOrder(cs, defaultPaneKeys(instancesOf(cs), {}), { volumePane })

/** Readable: pane keys with instance ids collapsed to their definition. */
const shape = (keys, cs) => keys.map((k) => {
  if (k === PRICE_PANE || k === VOLUME_PANE) return k
  const inst = instancesOf(cs).find((i) => i && i.instanceId === k)
  return inst ? `${inst.defId}` : k
})

describe('⚰️ REPRO A — adding a data series must not move Volume', () => {
  it('MEASUREMENT: an UNARRANGED chart (no stored paneOrder)', () => {
    let cs = { indicatorInstances: [] }
    const before = order(cs)
    cs = addInstance(cs, 'dataSeries', registry)
    const after = order(cs)

    console.log('  unarranged before:', JSON.stringify(before))
    console.log('  unarranged after :', JSON.stringify(shape(after, cs)))

    // Price and Volume must keep their RELATIVE order.
    const rel = (arr) => [arr.indexOf(PRICE_PANE), arr.indexOf(VOLUME_PANE)]
    const [p0, v0] = rel(before)
    const [p1, v1] = rel(after)
    expect(p0 < v0, 'baseline: Price above Volume').toBe(true)
    expect(p1 < v1, `Volume moved relative to Price: ${JSON.stringify(shape(after, cs))}`).toBe(true)
    expect(after.indexOf(VOLUME_PANE), 'Volume jumped to the top').not.toBe(0)
  })

  it('MEASUREMENT: an ARRANGED chart — the member has reordered before', () => {
    // The owner HAS been reordering panes; the live blob therefore carries a
    // stored arrangement. This is the state the bug was reported from.
    let cs = { indicatorInstances: [] }
    cs = setPaneOrder(cs, [PRICE_PANE, VOLUME_PANE])
    const before = order(cs)
    cs = addInstance(cs, 'dataSeries', registry)
    const after = order(cs)

    console.log('  arranged stored  :', JSON.stringify(cs.paneOrder))
    console.log('  arranged before  :', JSON.stringify(before))
    console.log('  arranged after   :', JSON.stringify(shape(after, cs)))

    expect(after.indexOf(PRICE_PANE) < after.indexOf(VOLUME_PANE),
      `Volume moved relative to Price: ${JSON.stringify(shape(after, cs))}`).toBe(true)
    expect(after.indexOf(VOLUME_PANE), 'Volume jumped to the top').not.toBe(0)
  })

  it('MEASUREMENT: a chart arranged WITHOUT volume in the stored list', () => {
    // ⚠️ THE SHAPE I SUSPECT. `setPaneOrder` stores whatever list it is handed.
    // If the volume pane did not exist when the member arranged (volume was a
    // BAND inside Price), the stored list has no `volume` key at all — and then
    // a separate volume pane appears later.
    let cs = { indicatorInstances: [] }
    cs = addInstance(cs, 'rsi', registry)
    const rsiId = instancesOf(cs)[0].instanceId
    // arranged while volume was a band: RSI above Price, no volume key stored
    cs = setPaneOrder(cs, [rsiId, PRICE_PANE])
    console.log('  stored (no volume):', JSON.stringify(cs.paneOrder))

    const before = order(cs, { volumePane: true })
    console.log('  before           :', JSON.stringify(shape(before, cs)))
    let cs2 = addInstance(cs, 'dataSeries', registry)
    const after = order(cs2, { volumePane: true })
    console.log('  after add QQQ    :', JSON.stringify(shape(after, cs2)))

    expect(after.indexOf(VOLUME_PANE), 'Volume jumped to the top').not.toBe(0)
  })

  it('MEASUREMENT: does withInstances re-sorting change the pane key order?', () => {
    // The brief's explicit warning: computation order must never become visual
    // order. `withInstances` sorts by DEFINITION RANK on every canonical write.
    let cs = { indicatorInstances: [] }
    cs = addInstance(cs, 'dataSeries', registry)   // QQQ-like
    cs = addInstance(cs, 'rsi', registry)
    const keysA = defaultPaneKeys(instancesOf(cs), {})
    const defsA = keysA.map((k) => instancesOf(cs).find((i) => i.instanceId === k)?.defId)

    // add a THIRD, unrelated definition and see whether the first two swap
    const cs2 = addInstance(cs, 'macd', registry)
    const keysB = defaultPaneKeys(instancesOf(cs2), {})
    const defsB = keysB.map((k) => instancesOf(cs2).find((i) => i.instanceId === k)?.defId)

    console.log('  default keys before:', JSON.stringify(defsA))
    console.log('  default keys after :', JSON.stringify(defsB))

    // the first two must keep their relative order
    const ia = defsB.indexOf(defsA[0]), ib = defsB.indexOf(defsA[1])
    expect(ia < ib, `adding macd reordered the existing panes: ${JSON.stringify(defsB)}`).toBe(true)
  })
})
