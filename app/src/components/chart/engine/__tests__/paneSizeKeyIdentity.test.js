// app/src/components/chart/engine/__tests__/paneSizeKeyIdentity.test.js
//
// ─── THE SLOT→KEY MAP IS WHAT MAKES A SIZE BELONG TO A PANE ─────────────────
//
// ⚰️⚰️ LIVE 2026-09-15, FAILURE A. A member with Price + a separate Volume pane
// (and a QQQ data series guesting inside Volume) dragged the separator to make
// VOLUME large, then sent QQQ back to its own pane. Both Volume and QQQ came back
// enormous and Price was crushed.
//
// ⛔ THE FIRST DIVERGENCE IS NOT IN THE TRANSITION AT ALL — it is in what the
// DRAG recorded. `computePaneLayout`'s no-instance-panes answer (`pane0Only`)
// built `keyByIndex` with
//
//     pinned = max(0, firstPaneIndex - (volume is a BAND ? 1 : 0) - 1)
//
// which is right for a banded volume (firstPaneIndex 1, band present → 0) and
// WRONG for a separate volume pane (firstPaneIndex 2, no band → 1). Price was
// labelled slot 1 and Volume slot 2, on a chart whose panes are 0 and 1.
//
// ⭐⭐ AND IT HID, BECAUSE THE ERROR CANCELS ITSELF WHILE THE CHART STAYS SMALL.
// `sizesFromStretch` RECORDS through this map and `applyPaneSizes` APPLIES
// through it, so storing Volume's share under `price` at slot 1 and then applying
// `price` to slot 1 puts the pixels back where the member left them. Two-pane
// resize therefore looks perfect — measured, repeatedly. The lie only surfaces
// when a THIRD pane appears: the panes-mode builder is correct, `price` starts
// meaning price, and the member's Volume enlargement is handed to the Price pane
// while Volume and the newcomer split what is left — both inflating.
//
// ⛔ MEASURED IN THE LIVE HARNESS: after enlarging Volume to 352px of a 689px
// stack (0.511 of it), `cs.paneSizes` read `{ price: 0.5109 }` — Volume's share,
// stored under Price's name, and no entry for Volume at all.

import { describe, it, expect } from 'vitest'
import { computePaneLayout } from '../paneLayout'
import { sizesFromStretch, applyPaneSizes } from '../paneSizes'

const PRICE = 'price'
const VOLUME = 'volume'
const STACK = 700

/** The layout a Price + SEPARATE-VOLUME chart produces — no instance panes. */
function twoPaneLayout(order = [PRICE, VOLUME]) {
  return computePaneLayout([], {
    order,
    chartHeight: STACK,
    hasVolumeBand: false,          // ⭐ SEPARATE pane, which is what every surface ships
    separatorPx: 1,
    firstPaneIndex: 2,             // 1 + separate volume
    abovePct: [78, 22],
    mainPaneIndex: 0,              // no Model Book index pane
  })
}

const asMap = (l) => [...(l.keyByIndex || [])].sort((a, b) => a[0] - b[0])

describe('⚰️⚰️ a two-pane chart names its own slots correctly', () => {
  it('⛔ price is slot 0 and volume is slot 1 — they are the only panes there are', () => {
    expect(asMap(twoPaneLayout())).toEqual([[0, PRICE], [1, VOLUME]])
  })

  it('⭐ and the arrangement is honoured when the member swaps them', () => {
    expect(asMap(twoPaneLayout([VOLUME, PRICE]))).toEqual([[0, VOLUME], [1, PRICE]])
  })

  it('⛔ a BANDED volume still names only price, at slot 0', () => {
    // The case the old arithmetic was written for, kept honest.
    const banded = computePaneLayout([], {
      order: [PRICE],
      chartHeight: STACK,
      hasVolumeBand: true,
      separatorPx: 1,
      firstPaneIndex: 1,
      abovePct: [100],
      mainPaneIndex: 0,
    })
    expect(asMap(banded)).toEqual([[0, PRICE]])
  })

  it('⭐ a Model Book index pane above the arrangement shifts both by one', () => {
    // `mainPaneIndex: 1` is the index-comparison pane hoisted to slot 0; it is
    // NOT part of the arrangement, so it is exactly what the offset is for.
    const withIdx = computePaneLayout([], {
      order: [PRICE, VOLUME],
      chartHeight: STACK,
      hasVolumeBand: false,
      separatorPx: 1,
      firstPaneIndex: 3,
      abovePct: [60, 22, 18],
      mainPaneIndex: 1,
    })
    expect(asMap(withIdx)).toEqual([[1, PRICE], [2, VOLUME]])
  })
})

describe('⚰️⚰️ THE LIVE DEFECT: a Volume drag must be recorded against VOLUME', () => {
  it('⛔ enlarging Volume stores volume — not price wearing volume’s number', () => {
    const layout = twoPaneLayout()
    // What the layout wanted: Price 78 / Volume 22.
    const computed = [STACK * 0.78, STACK * 0.22]
    // What the member dragged it to: Volume enlarged to ~51% of the stack.
    const observed = [STACK * 0.489, STACK * 0.511]

    const stored = sizesFromStretch(observed, computed, layout.keyByIndex)

    expect(stored[VOLUME], 'the member’s Volume height was never recorded').toBeCloseTo(0.511, 2)
    expect(stored[PRICE], 'Price was recorded as ~0.49, not as Volume’s share').toBeCloseTo(0.489, 2)
    // ⛔ THE EXACT LIVE SYMPTOM: `{price: 0.5109}` — volume's share under price's
    // name — with no volume entry at all.
    expect(stored[PRICE], 'Volume’s share was stored under Price').not.toBeCloseTo(0.511, 2)
    expect(Object.keys(stored).sort()).toEqual([PRICE, VOLUME])
  })

  it('⭐⭐ …so a THIRD pane cannot inherit the member’s Volume enlargement', () => {
    // The transition that failed live: QQQ leaves Volume and becomes a host.
    // With the drag recorded correctly, Price keeps the share the member left it,
    // Volume keeps its own, and the newcomer takes what is actually spare.
    const stored = { [PRICE]: 0.489, [VOLUME]: 0.511 }
    const three = new Map([[0, PRICE], [1, VOLUME], [2, 'inst:dataSeries:1']])
    const plan = applyPaneSizes([463, 154, 81], three, stored)
    const total = plan.reduce((a, b) => a + b, 0)
    const share = plan.map((v) => v / total)

    expect(share[0], `price took ${(share[0] * 100).toFixed(1)}%`).toBeGreaterThan(0.40)
    // ⛔ AND PRICE IS NOT HANDED VOLUME'S HEIGHT, which is the live failure.
    expect(share[0]).toBeLessThan(0.55)
    expect(share[1], `volume took ${(share[1] * 100).toFixed(1)}%`).toBeGreaterThan(0.40)
  })
})

describe('⚰️⚰️ FAILURE A end to end — a guest leaving Volume gets its OWN default', () => {
  // The live sequence: Price + Volume, a QQQ series guesting INSIDE Volume, the
  // member drags Volume large, then sends QQQ back to its own pane.
  const BASE_3 = [463, 154, 81]          // the canonical three-pane plan
  const THREE = new Map([[0, PRICE], [1, VOLUME], [2, 'inst:dataSeries:1']])

  it('⛔ the newcomer is not clamped to a sliver by a stale two-pane partition', () => {
    // What the member's Volume drag legitimately stores while only two panes
    // exist: a COMPLETE partition of the stack.
    const stale = { [PRICE]: 0.4427, [VOLUME]: 0.5573 }
    expect(stale[PRICE] + stale[VOLUME]).toBeCloseTo(1, 3)

    const plan = applyPaneSizes(BASE_3, THREE, stale)
    const total = plan.reduce((a, b) => a + b, 0)
    const share = plan.map((v) => v / total)

    // ⭐ THE NEWCOMER GETS ITS CANONICAL COMPACT DEFAULT, ~81/698.
    expect(share[2], `QQQ took ${(share[2] * 100).toFixed(1)}%`)
      .toBeCloseTo(BASE_3[2] / BASE_3.reduce((a, b) => a + b, 0), 2)
    // …and it is NOT the 4% sliver the MIN_SHARE floor used to leave.
    expect(share[2]).toBeGreaterThan(0.08)
  })

  it('⭐ …while the member’s Volume-over-Price RATIO is preserved exactly', () => {
    const stale = { [PRICE]: 0.4427, [VOLUME]: 0.5573 }
    const plan = applyPaneSizes(BASE_3, THREE, stale)
    expect(plan[1] / plan[0], 'the member’s relative intent was rewritten')
      .toBeCloseTo(stale[VOLUME] / stale[PRICE], 2)
    expect(plan[1], 'Volume did not stay the larger of the two').toBeGreaterThan(plan[0])
  })

  it('⛔ and a DELIBERATE single-pane enlargement is still honoured in full', () => {
    // The opposite case, which the first attempt at this fix broke: one pinned
    // pane grown on purpose, with room to spare. The unpinned panes shrink
    // proportionally — that is the member getting what they asked for.
    const plan = applyPaneSizes(BASE_3, THREE, { 'inst:dataSeries:1': 0.35 })
    const total = plan.reduce((a, b) => a + b, 0)
    expect(plan[2] / total, 'an explicit 35% was clamped away').toBeCloseTo(0.35, 2)
  })
})
