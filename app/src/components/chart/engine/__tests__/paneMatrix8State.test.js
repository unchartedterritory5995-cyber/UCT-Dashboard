// app/src/components/chart/engine/__tests__/paneMatrix8State.test.js
//
// ─── ONE ORDER, THREE READERS, EIGHT ARRANGEMENTS ───────────────────────────
//
// ⭐⭐ THE TRACK A INVARIANT, STATED ONCE AND CHECKED EVERYWHERE:
//
//     Chart Data grouping  ==  resolved pane order  ==  what the renderer stacks
//
// Three separate modules answer that question — `chartDataMap.paneMap` for the
// management surface, `paneOrder.resolvePaneOrder` for the durable order, and
// `paneLayout.defaultPaneKeys` for the geometry — and every Track A defect so
// far has been two of them disagreeing. `volumePeerPane`/`paneGuestSwap` pin
// individual mechanisms; this walks the whole arrangement space so a disagreement
// cannot hide in a topology nobody happened to try.
//
// ⛔ THE STATES ARE THE OWNER'S EIGHT, verbatim, plus the states this pass made
// expressible — primary Close in its own pane, an explicit QQQ guest on Price,
// MA(RSI), a second Data Series, and an explicitly resized pane.
//
// ⚠️ THIS IS THE CANONICAL LAYER, NOT THE PIXELS. Physical stacking was measured
// in the browser (pane-harness, 2026-09-15): moving QQQ above Price through
// Chart Data produced `paneOrder ["inst:dataSeries:1","price"]` and physical
// heights that swapped with their panes, 187/502. What a unit rail CAN own is
// that all three readers agree on the order those pixels are laid out in.

import { describe, it, expect } from 'vitest'
import * as registry from '../nativeRegistry'
import { addInstance, setInstanceDisplayTarget } from '../instanceControls'
import { paneOwnKeys, paneFollowerKeys, resolveDisplayTarget } from '../displayTarget'
import { defaultPaneKeys, computePaneLayout } from '../paneLayout'
import { resolvePaneOrder, setPaneOrder, PRICE_PANE, VOLUME_PANE } from '../paneOrder'
import { setPaneSize, storedPaneSizes } from '../paneSizes'
import { paneMap } from '../../chartDataMap'
import { listAllIndicators } from '../../indicatorRegistry'

const QQQ = 'sym:QQQ:close'
const insts = (cs) => (Array.isArray(cs.indicatorInstances) ? cs.indicatorInstances : [])
const defOf = (id) => registry.getDefinition(id)
const setSrc = (cs, id, source) => ({
  ...cs,
  indicatorInstances: insts(cs).map((i) => (i.instanceId === id
    ? { ...i, inputs: { ...i.inputs, source } } : i)),
})

/** The resolved visual order — what the geometry stacks. */
const order = (cs) => resolvePaneOrder(
  cs,
  defaultPaneKeys(insts(cs), {
    excludeKeys: paneFollowerKeys(insts(cs), cs),
    includeKeys: paneOwnKeys(insts(cs), cs),
  }),
  { volumePane: true },
)

/** The pane keys Chart Data shows, in the order it shows them. */
const grouping = (cs) => paneMap(listAllIndicators(cs, registry), cs, defOf,
  { volumeSeparatePane: true, blankVolume: false })
  // ⚠️ `g.id` IS THE PANE KEY; `g.host` is the whole ROW. Only the three
  // real-pane kinds count — `hidden` and `orphans` are groups Chart Data shows
  // for state the renderer allocates NO pane for, which is the distinction
  // `chartDataMap` exists to make.
  .filter((g) => g.kind === 'price' || g.kind === 'volume' || g.kind === 'pane')
  .map((g) => g.id)

/**
 * A chart carrying the full cast, before any arrangement is applied.
 * Returns the settings plus the ids the cases arrange by name.
 */
function cast() {
  let cs = { indicatorInstances: [] }

  cs = addInstance(cs, 'dataSeries', registry)                 // QQQ, own pane (declared)
  const qqq = insts(cs).find((i) => i.defId === 'dataSeries').instanceId
  cs = setSrc(cs, qqq, QQQ)

  cs = addInstance(cs, 'rsi', registry)                        // RSI, own pane
  const rsi = insts(cs).find((i) => i.defId === 'rsi').instanceId

  cs = addInstance(cs, 'movingAverage', registry)              // MA(RSI) — follows RSI
  const ma = insts(cs).find((i) => i.defId === 'movingAverage').instanceId
  cs = setSrc(cs, ma, `@${rsi}::rsi`)

  cs = addInstance(cs, 'dataSeries', registry)                 // a SECOND data series…
  const close = insts(cs).filter((i) => i.defId === 'dataSeries')
    .map((i) => i.instanceId).find((id) => id !== qqq)
  cs = setInstanceDisplayTarget(cs, close, 'pane', registry)   // …primary Close, OWN PANE

  return { cs, qqq, rsi, ma, close }
}

const STATES = [
  ['1. PRICE / VOLUME', (k) => [PRICE_PANE, VOLUME_PANE]],
  ['2. QQQ / PRICE / VOLUME', (k) => [k.qqq, PRICE_PANE, VOLUME_PANE]],
  ['3. PRICE / QQQ / VOLUME', (k) => [PRICE_PANE, k.qqq, VOLUME_PANE]],
  ['4. PRICE / VOLUME / QQQ', (k) => [PRICE_PANE, VOLUME_PANE, k.qqq]],
  ['5. VOLUME / PRICE / QQQ', (k) => [VOLUME_PANE, PRICE_PANE, k.qqq]],
  ['6. QQQ / VOLUME / PRICE', (k) => [k.qqq, VOLUME_PANE, PRICE_PANE]],
  ['7. QQQ / RSI / PRICE / VOLUME', (k) => [k.qqq, k.rsi, PRICE_PANE, VOLUME_PANE]],
  ['8. VOLUME / RSI / QQQ / PRICE', (k) => [VOLUME_PANE, k.rsi, k.qqq, PRICE_PANE]],
]

describe('⭐⭐ the eight arrangements — every reader agrees', () => {
  for (const [name, arrange] of STATES) {
    it(name, () => {
      const k = cast()
      const wanted = arrange(k)
      const cs = setPaneOrder(k.cs, wanted)

      const resolved = order(cs)
      // ⛔ EVERY ARRANGED PANE APPEARS, IN THE ARRANGED ORDER. Panes the case did
      // not name (the Close own-pane, RSI where unarranged) still exist — the
      // rail checks the RELATIVE order of what it arranged, which is what a
      // member actually established.
      const seen = wanted.map((key) => resolved.indexOf(key))
      expect(seen.every((i) => i >= 0), `a named pane vanished from ${JSON.stringify(resolved)}`).toBe(true)
      expect(seen, `arranged order broken in ${JSON.stringify(resolved)}`)
        .toEqual([...seen].sort((a, b) => a - b))

      // ⛔⛔ AND CHART DATA SHOWS THE SAME STACK. This is the equality the owner
      // stated: grouping == resolved order.
      expect(grouping(cs), 'Chart Data disagrees with the resolved pane order')
        .toEqual(resolved)
    })
  }
})

describe('⛔ the cast keeps its identity across every arrangement', () => {
  it('destinations, ownership and provenance are arrangement-independent', () => {
    for (const [, arrange] of STATES) {
      const k = cast()
      const cs = setPaneOrder(k.cs, arrange(k))
      const own = paneOwnKeys(insts(cs), cs)

      // QQQ: automatic, own pane — no stored target at all.
      expect(resolveDisplayTarget(insts(cs).find((i) => i.instanceId === k.qqq), cs)).toBe('pane')
      expect(insts(cs).find((i) => i.instanceId === k.qqq).placement).toBeUndefined()
      expect(own.has(k.qqq)).toBe(true)

      // Primary Close: EXPLICIT own pane — the state this pass made expressible.
      const closeInst = insts(cs).find((i) => i.instanceId === k.close)
      expect(closeInst.inputs.source).toBe('close')
      expect(closeInst.placement).toEqual({ target: 'pane', targetExplicit: true })
      expect(own.has(k.close), 'the explicit Close pane was not realised').toBe(true)

      // MA(RSI): automatic, follows RSI — never a pane owner, never on Price.
      expect(resolveDisplayTarget(insts(cs).find((i) => i.instanceId === k.ma), cs)).toBe(`@${k.rsi}`)
      expect(own.has(k.ma), 'MA(RSI) took a pane of its own').toBe(false)
      expect(paneFollowerKeys(insts(cs), cs).has(k.ma)).toBe(true)

      // Two Data Series, two identities, two panes — never collapsed onto one.
      expect(k.qqq).not.toBe(k.close)
      expect(own.has(k.qqq) && own.has(k.close)).toBe(true)
    }
  })

  it('⭐ an explicit QQQ guest on Price drops out of every arrangement', () => {
    for (const [, arrange] of STATES) {
      const k = cast()
      let cs = setPaneOrder(k.cs, arrange(k))
      cs = setInstanceDisplayTarget(cs, k.qqq, 'price', registry)
      expect(order(cs), 'a guest kept a pane slot').not.toContain(k.qqq)
      expect(grouping(cs), 'Chart Data still showed a pane for a guest').toEqual(order(cs))
      // …and it is a genuine, provenance-bearing override.
      expect(insts(cs).find((i) => i.instanceId === k.qqq).placement)
        .toEqual({ target: 'price', targetExplicit: true })
    }
  })

  it('⛔ an explicitly resized pane keeps its weight in every arrangement', () => {
    for (const [, arrange] of STATES) {
      const k = cast()
      const cs = setPaneSize(setPaneOrder(k.cs, arrange(k)), k.qqq, 0.33)
      expect(storedPaneSizes(cs)[k.qqq], 'an arrangement rewrote a member’s size').toBe(0.33)
      expect(order(cs)).toContain(k.qqq)
    }
  })
})

describe('⚰️⚰️ §14 — the OTHER half of pane eligibility', () => {
  // ⛔ FOUND BY BITE-CHECK, 2026-09-15. The matrix above does NOT exercise
  // `includeKeys`: `dataSeries` DECLARES `'pane'`, so even its explicit Close
  // pane is eligible through the declared half (`paneIds.has(defId)`), and
  // disabling the resolved half left every case above green. The mechanism only
  // carries weight for a definition that declares `'price'` — and that is
  // exactly the case it was written for:
  //
  //     `paneLayout.orderedPaneKeys`:
  //       if (!paneIds.has(id0) && !(include && include.has(id))) continue
  //
  // Without the second clause `isWritableDisplayTarget('pane')` accepts the move,
  // `resolveDisplayTarget` returns it, and the layout allocates nothing — the
  // series vanishes silently, which is the failure `paneOwnKeys` was created for.
  it('a PRICE-declared indicator moved to its own pane is actually allocated one', () => {
    let cs = addInstance({ indicatorInstances: [] }, 'movingAverage', registry)
    const ma = insts(cs).find((i) => i.defId === 'movingAverage').instanceId
    expect(registry.getDefinition('movingAverage').placement.target,
      'movingAverage no longer declares price — pick another probe').toBe('price')

    // Its declaration gives it no pane…
    expect(order(cs), 'the MA already had a pane before being moved').not.toContain(ma)

    // …and the member's explicit choice must.
    cs = setInstanceDisplayTarget(cs, ma, 'pane', registry)
    expect(resolveDisplayTarget(insts(cs).find((i) => i.instanceId === ma), cs)).toBe('pane')
    expect(paneOwnKeys(insts(cs), cs).has(ma)).toBe(true)
    expect(order(cs), 'the resolved own-pane never reached the stack — the series would vanish')
      .toContain(ma)
    expect(grouping(cs), 'Chart Data disagrees about the new pane').toEqual(order(cs))
  })
})

describe('⭐⭐ §14 — order stays correct WHILE sizing stays correct', () => {
  // ⚰️ FAILURE 4's DETERMINATION, pinned. The live screenshot showed a stack whose
  // ORDER looked wrong, but the panes were also catastrophically mis-sized by the
  // legacy volume writer (see `chart/__tests__/volumeStretchThirdPane.test.js`):
  // the auxiliary pane swelled past 35% while Price was crushed. Identifying
  // which pane is which by eye, on a chart where SPY (757) and QQQ (704) carry
  // nearly identical axis ranges, is not evidence — so this rail asserts the two
  // properties TOGETHER, in every arrangement, rather than trusting appearance.
  //
  // ⛔ NO SECOND FIX WAS INVENTED FOR FAILURE 4. Measured with both fixes active,
  // the exact live sequence settles at Chart Data [QQQ, Volume, Price] and
  // physical [QQQ 80, volume 152, price 456] — agreeing, and stable across 5s of
  // reconciliation. What follows is the canonical half of that, for all eight.
  const AUX_MAX_SHARE = 0.25   // an auxiliary pane is COMPACT, never a co-equal

  for (const [name, arrange] of STATES) {
    it(`${name} — the auxiliary pane stays compact wherever it sits`, () => {
      const k = cast()
      const cs = setPaneOrder(k.cs, arrange(k))
      const resolved = order(cs)

      // Chart Data still agrees with the resolved order in this arrangement…
      expect(grouping(cs)).toEqual(resolved)

      // …and the sizing the layout hands out does not depend on WHERE a pane sits.
      const layout = computePaneLayout(insts(cs), {
        order: resolved,
        chartHeight: 700,
        hasVolumeBand: false,
        excludeKeys: paneFollowerKeys(insts(cs), cs),
        includeKeys: paneOwnKeys(insts(cs), cs),
        separatorPx: 1,
        firstPaneIndex: 2,
        abovePct: [78, 22],
      })
      const total = 700
      for (const p of layout.panes) {
        expect(p.heightPx / total, `${p.key} took ${(p.heightPx / total * 100).toFixed(1)}% in ${name}`)
          .toBeLessThan(AUX_MAX_SHARE)
        expect(p.heightPx, `${p.key} collapsed in ${name}`).toBeGreaterThan(20)
      }
    })
  }
})
