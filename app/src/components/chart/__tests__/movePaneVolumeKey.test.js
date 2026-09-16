// app/src/components/chart/__tests__/movePaneVolumeKey.test.js
//
// ─── A REORDER MAY NOT WRITE AWAY A PANE THE CHART HAS ──────────────────────
//
// ⚰️⚰️ THE MECHANISM BEHIND THE LIVE 2026-09-15 REGRESSION, isolated from the
// React surface so it can be bitten. `ChartSettingsIndicators` does not ask the
// volume predicate itself — it reads the GROUPS `chartDataMap.paneMap` returns
// and derives the writer's options from them:
//
//     const paneOpts = { volumePane: arrangeable.some(g => g.kind === 'volume') }
//     movePane(settings, paneKeysNow, id, delta, paneOpts)
//
// So the volume answer travels from `paneMap` into the ORDER WRITER. Give
// `paneMap` the host's real inputs and the stored order contains `volume`; give
// it nothing and the SAME gesture stores an order with the volume key missing —
// on a chart that is, at that moment, drawing a volume pane.
//
// ⛔ THE STORED ORDER IS DURABLE, WHICH IS WHY THIS IS NOT SELF-HEALING. It
// survives the reload that would otherwise re-derive a correct default, so one
// wrong click leaves the chart permanently describing a stack it does not have.

import { describe, it, expect } from 'vitest'
import * as registry from '../engine/nativeRegistry'
import { addInstance } from '../engine/instanceControls'
import { paneMap } from '../chartDataMap'
import { listAllIndicators } from '../indicatorRegistry'
import { movePane, PRICE_PANE, VOLUME_PANE } from '../engine/paneOrder'

const QQQ = 'sym:QQQ:close'
const defOf = (id) => registry.getDefinition(id)
const insts = (cs) => (Array.isArray(cs.indicatorInstances) ? cs.indicatorInstances : [])

/** A chart the RENDERER draws as three panes: Price · Volume · QQQ. */
function threePaneChart() {
  const cs = addInstance({ indicatorInstances: [] }, 'dataSeries', registry)
  const id = insts(cs)[0].instanceId
  return [{
    ...cs,
    indicatorInstances: insts(cs).map((i) => ({ ...i, inputs: { ...i.inputs, source: QQQ } })),
  }, id]
}

/** Exactly what `ChartSettingsIndicators` does with `paneMap`'s answer. */
function nudgeThrough(cs, volumeOpts, id, delta) {
  const groups = paneMap(listAllIndicators(cs, registry), cs, defOf, volumeOpts)
  const arrangeable = groups.filter((g) => ['price', 'volume', 'pane'].includes(g.kind))
  const paneKeysNow = groups.filter((g) => g.kind === 'pane').map((g) => g.id)
  const paneOpts = { volumePane: arrangeable.some((g) => g.kind === 'volume') }
  return { next: movePane(cs, paneKeysNow, id, delta, paneOpts), paneOpts, arrangeable: arrangeable.map((g) => g.id) }
}

const HOST_INPUTS = { volumeSeparatePane: true, blankVolume: false }

describe('⚰️⚰️ the regression: without the host inputs the volume key is written away', () => {
  it('⛔ THE DEFECT — a reorder stores an order with no volume in it', () => {
    const [cs, id] = threePaneChart()
    const { next, paneOpts, arrangeable } = nudgeThrough(cs, null, id, -1)

    // The map itself already disagrees with the chart…
    expect(arrangeable, 'volume was listed as a real pane — the defect is gone?')
      .not.toContain(VOLUME_PANE)
    expect(paneOpts.volumePane).toBe(false)
    // …and the durable write inherits that disagreement.
    expect(next.paneOrder, 'this is the corrupted order measured live')
      .toEqual([id, PRICE_PANE])
    expect(next.paneOrder, 'the volume pane was written out of the arrangement')
      .not.toContain(VOLUME_PANE)
  })

  it('⭐⭐ THE FIX — given the host inputs, the same gesture keeps volume', () => {
    const [cs, id] = threePaneChart()
    const { next, paneOpts, arrangeable } = nudgeThrough(cs, HOST_INPUTS, id, -1)

    expect(arrangeable).toContain(VOLUME_PANE)
    expect(paneOpts.volumePane).toBe(true)
    expect(next.paneOrder).toContain(VOLUME_PANE)
    expect(next.paneOrder, 'QQQ crossed Volume, and all three panes survived')
      .toEqual([PRICE_PANE, id, VOLUME_PANE])
  })

  it('⛔ and the stored order still names every pane after a second move', () => {
    const [cs, id] = threePaneChart()
    const once = nudgeThrough(cs, HOST_INPUTS, id, -1).next
    const twice = nudgeThrough(once, HOST_INPUTS, id, -1).next
    expect(twice.paneOrder).toEqual([id, PRICE_PANE, VOLUME_PANE])
    expect(new Set(twice.paneOrder).size, 'a key was duplicated or lost').toBe(3)
  })
})
