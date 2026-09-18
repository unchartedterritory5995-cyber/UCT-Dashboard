// app/src/components/chart/engine/__tests__/volumePaneResidency.test.js
//
// ─── A PANE EXISTS IF SOMETHING LIVES IN IT ─────────────────────────────────
//
// ⭐⭐ THE LOCKED RULE, VERBATIM (owner, 2026-09-18):
//
//     A DISPLAY PANE EXISTS IF IT HAS A RESIDENT PLOTTED SERIES.
//     VOLUME BARS DO NOT OWN THE VOLUME PANE. DISPLAY RESIDENTS OWN THE PANE.
//     SOURCE ≠ DISPLAY.
//
// ⚰️⚰️ AND WHAT THE MEMBER MET. Indicators → Volume → Remove, with a moving
// average of Volume displayed in that pane. The bars go, the pane goes, AND THE
// MOVING AVERAGE GOES WITH THEM — not hidden, not re-homed, gone. It is still in
// the Indicators list, still computing, drawing nothing.
//
// ⛔ ONE LINE CAUSED IT, AND IT IS THE FIRST LINE OF THE ANSWER:
//
//     export function resolveVolumePresentation(o) {
//       const shown = o && o.shown === false ? false : true
//       if (!shown) return VOLUME_ABSENT          // ← before asking about guests
//       if (volumeHasOverlay(cs, o.instances)) return VOLUME_AS_PANE
//
// Removing Volume sets `shown: false`, so the answer was `'absent'` while a guest
// was resident. SEVENTEEN of the renderer's consumers were asking that predicate
// whether the RECTANGLE exists — pane order, pane count, stretch shares,
// `firstPaneIndex`, the realiser's `volumeKey` and `paneOf`, the chip router,
// Chart Data's map — and `placement.js:476` gates the whole GUEST BRANCH on it,
// which is why the guest did not merely lose its pane but bound nothing at all.
//
// ⭐ SO THERE ARE TWO PREDICATES NOW, and the split is the fix:
//   `nativeVolumeOwnsPane` — are the BARS in a pane instead of a band? (6 sites)
//   `volumePaneRequired`   — does the RECTANGLE exist?                (17 sites)
//
// ⚠️ CASE 2 IS THE DISCRIMINATOR. It fails on `ec4a00bd6` and passes here; every
// other case in this file passes on both, which is the point — the split is not
// allowed to move anything else.

import { describe, it, expect, afterEach } from 'vitest'
import { createChart, LineSeries } from 'lightweight-charts'
import { prepareArrangement, settleArrangement } from '../paneRealization'
import { createBinder } from '../binder'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  nativeVolumeOwnsPane, volumePaneRequired, volumeResidentKeys,
  resolveVolumePresentation, VOLUME_AS_PANE, VOLUME_AS_BAND, VOLUME_ABSENT,
} from '../volumePresentation'
import { resolveDisplayTarget, volumeOverlayPaneKeys, paneFollowerKeys, paneOwnKeys, paneOwnersNeeded } from '../displayTarget'
import { resolvePaneOrder, PRICE_PANE, VOLUME_PANE } from '../paneOrder'
import { defaultPaneKeys, computePaneLayout } from '../paneLayout'
import { resolvePlacement } from '../placement'
import { addInstance, setInstanceInput, setInstanceDisplayTarget } from '../instanceControls'
import * as registry from '../nativeRegistry'
import { mergeChartSettings } from '../../chartDefaults'
import { lastCreatedInstance } from '../../discoveryCatalog'

// ─────────────────────────────────────────────────────────────────────────────
// The chart the member actually has: Volume in its own pane, an MA of Volume
// displayed in it. Built through the SHIPPED writers, never hand-rolled — a
// literal instance would let the test agree with a rule the product does not.
// ─────────────────────────────────────────────────────────────────────────────
const BINDER_DIR = path.dirname(fileURLToPath(import.meta.url))
const fresh = (over) => mergeChartSettings(JSON.stringify(over || {}))

function withVolumeGuest(over) {
  const base = fresh({ volume: { visible: true, separatePane: true }, ...(over || {}) })
  const added = addInstance(base, 'movingAverage', registry)
  const id = lastCreatedInstance(base, added).instanceId
  return { cs: setInstanceInput(added, id, 'source', 'volume', registry), id }
}

/** The member's Remove — `volume.removed`, which the renderer folds into `shown`. */
const removeVolume = (cs) => ({ ...cs, volume: { ...cs.volume, removed: true } })
/** …and the renderer's own gate, so a test says `shown` the way StockChart does. */
const shownOf = (cs) => !(cs.volume?.removed === true) && cs.volume?.visible !== false

const optsFor = (cs, extra) => ({
  cs, instances: cs.indicatorInstances, shown: shownOf(cs), ...(extra || {}),
})

const patch = (cs, id, fn) => ({
  ...cs,
  indicatorInstances: cs.indicatorInstances.map((i) => (i.instanceId === id ? fn(i) : i)),
})

// ─────────────────────────────────────────────────────────────────────────────
describe('⭐⭐ RESIDENCY, CASE BY CASE', () => {
  it('1. native Volume ON, no guest → the pane exists and the BARS own it', () => {
    const cs = fresh({ volume: { visible: true, separatePane: true } })
    expect(nativeVolumeOwnsPane(optsFor(cs))).toBe(true)
    expect(volumePaneRequired(optsFor(cs))).toBe(true)
    expect(volumeResidentKeys(cs, cs.indicatorInstances).size).toBe(0)
  })

  it('⛔⛔ 2. THE DEFECT — Volume REMOVED, a guest still resident → the pane EXISTS', () => {
    const { cs, id } = withVolumeGuest()
    const inst = cs.indicatorInstances.find((i) => i.instanceId === id)
    expect(resolveDisplayTarget(inst, cs), 'the guest is not in the volume pane').toBe('volume')

    const gone = removeVolume(cs)
    // The BARS are absent — that half was always right and must stay right.
    expect(nativeVolumeOwnsPane(optsFor(gone))).toBe(false)
    expect(resolveVolumePresentation(optsFor(gone))).toBe(VOLUME_ABSENT)
    // The RECTANGLE is not, because somebody is drawing in it.
    expect(volumePaneRequired(optsFor(gone)),
      'deleting the bars took the pane — and the guest with it').toBe(true)
    expect([...volumeResidentKeys(gone, gone.indicatorInstances)]).toEqual([id])
  })

  it('3. Volume removed with NOTHING resident → the pane is gone', () => {
    const cs = removeVolume(fresh({ volume: { visible: true, separatePane: true } }))
    expect(volumePaneRequired(optsFor(cs))).toBe(false)
    expect(nativeVolumeOwnsPane(optsFor(cs))).toBe(false)
  })

  it('4. Volume HIDDEN (not removed) with a guest → the pane stays', () => {
    // ⛔ `visible: false` is "hidden, still mine"; `removed` is "not on this
    // chart". Both reach `shown: false`, and both must leave a tenanted pane up.
    const { cs } = withVolumeGuest()
    const hidden = { ...cs, volume: { ...cs.volume, visible: false } }
    expect(shownOf(hidden)).toBe(false)
    expect(volumePaneRequired(optsFor(hidden))).toBe(true)
  })

  it('5. …and when the GUEST is hidden too, the pane finally goes', () => {
    const { cs, id } = withVolumeGuest()
    const both = patch(removeVolume(cs), id, (i) => ({ ...i, hidden: true }))
    expect(volumePaneRequired(optsFor(both)),
      'an empty rectangle survived — nothing plots in it').toBe(false)
  })

  it('6. a TOMBSTONED guest holds nothing open', () => {
    const { cs, id } = withVolumeGuest()
    const dead = patch(removeVolume(cs), id, (i) => ({ ...i, deleted: true }))
    expect(volumePaneRequired(optsFor(dead))).toBe(false)
  })

  it('7. BANDED volume, no guest → no pane, and the bars are a band', () => {
    const cs = fresh({ volume: { visible: true, separatePane: false } })
    expect(resolveVolumePresentation(optsFor(cs))).toBe(VOLUME_AS_BAND)
    expect(volumePaneRequired(optsFor(cs))).toBe(false)
  })

  it('8. BANDED volume + a guest sent to Volume → promoted to a pane (unchanged rule)', () => {
    const { cs } = withVolumeGuest({ volume: { visible: true, separatePane: false } })
    expect(nativeVolumeOwnsPane(optsFor(cs)), 'an overlay must force a real pane').toBe(true)
    expect(volumePaneRequired(optsFor(cs))).toBe(true)
  })

  it('⛔⛔ 9. SOURCE ≠ DISPLAY — an MA *of* Volume shown on PRICE holds no pane', () => {
    const { cs, id } = withVolumeGuest()
    const moved = setInstanceDisplayTarget(cs, id, 'price', registry)
    const gone = removeVolume(moved)
    expect(resolveDisplayTarget(moved.indicatorInstances.find((i) => i.instanceId === id), moved))
      .toBe('price')
    expect(volumePaneRequired(optsFor(gone)),
      'a SOURCE of volume was mistaken for a RESIDENT of the volume pane').toBe(false)
  })

  it('10. `blankVolume` still reserves a pane, and still only while shown', () => {
    const cs = fresh({ volume: { visible: true, separatePane: false } })
    expect(volumePaneRequired(optsFor(cs, { blankVolume: true }))).toBe(true)
    expect(volumePaneRequired(optsFor(removeVolume(cs), { blankVolume: true }))).toBe(false)
  })

  it('11. the `volumeSeparatePane` PROP still wins, and still only while shown', () => {
    const cs = fresh({ volume: { visible: true, separatePane: false } })
    expect(volumePaneRequired(optsFor(cs, { volumeSeparatePane: true }))).toBe(true)
    expect(nativeVolumeOwnsPane(optsFor(cs, { volumeSeparatePane: true }))).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('⭐ THE PANE STACK AGREES WITH THE ANSWER', () => {
  const keySets = (cs) => ({
    excludeKeys: new Set([
      ...volumeOverlayPaneKeys(cs.indicatorInstances, cs),
      ...paneFollowerKeys(cs.indicatorInstances, cs),
    ]),
    keepKeys: paneOwnersNeeded(cs.indicatorInstances, cs),
    includeKeys: paneOwnKeys(cs.indicatorInstances, cs),
  })
  const orderOf = (cs) => resolvePaneOrder(
    cs, defaultPaneKeys(cs.indicatorInstances, keySets(cs)),
    { volumePane: volumePaneRequired(optsFor(cs)) },
  )

  it('12. Volume removed + guest → `volume` is STILL a key in the pane order', () => {
    const { cs } = withVolumeGuest()
    const gone = removeVolume(cs)
    expect(orderOf(gone)).toEqual([PRICE_PANE, VOLUME_PANE])
    // ⛔ AND THE GUEST CARVES NONE OF ITS OWN. It is a follower; the pane it
    // draws in is Volume's. Two rectangles here would be the other failure.
    expect(orderOf(gone).length).toBe(2)
  })

  it('13. …and with the guest gone too, the key drops out', () => {
    const cs = removeVolume(fresh({ volume: { visible: true, separatePane: true } }))
    expect(orderOf(cs)).toEqual([PRICE_PANE])
  })

  it('⭐ 14. VOLUME ABOVE PRICE survives the delete — a stored arrangement is a preference', () => {
    // ⛔ PRICE IS SEMANTIC, NOT PHYSICAL PANE 0. A member who dragged Volume above
    // Price keeps that arrangement when the bars go, because the pane is still there.
    const { cs } = withVolumeGuest({ paneOrder: [VOLUME_PANE, PRICE_PANE] })
    const gone = removeVolume(cs)
    expect(orderOf(gone)).toEqual([VOLUME_PANE, PRICE_PANE])

    const layout = computePaneLayout(gone.indicatorInstances, {
      order: orderOf(gone), chartHeight: 600, separatorPx: 1,
      hasVolumeBand: false, ...keySets(gone),
      firstPaneIndex: 1 + 1, abovePct: [22, 78], mainPaneIndex: 0,
    })
    expect(layout.volumeIndex, 'the volume pane lost its arranged slot').toBe(0)
    expect(layout.priceIndex).toBe(1)
  })

  it('15. the layout gives the tenanted pane a real slot and a real height', () => {
    const { cs } = withVolumeGuest()
    const gone = removeVolume(cs)
    const layout = computePaneLayout(gone.indicatorInstances, {
      order: orderOf(gone), chartHeight: 600, separatorPx: 1,
      hasVolumeBand: false, ...keySets(gone),
      firstPaneIndex: 1 + 1, abovePct: [78, 22], mainPaneIndex: 0,
    })
    expect(layout.volumeIndex).toBe(1)
    expect(layout.keyByIndex.get(1)).toBe(VOLUME_PANE)
    expect(layout.paneCountRequired).toBeGreaterThanOrEqual(2)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('⛔⛔ AND THE GUEST ACTUALLY BINDS — `placement.js:476`', () => {
  const ctxFor = (cs) => ({
    paneMargins: null,
    paneLayout: null,
    volOverlaySet: new Set(),
    // The value StockChart hands the binder. THIS is the line that changed.
    volSeparatePane: volumePaneRequired(optsFor(cs)),
    VOL_PANE_INDEX: 1,
  })

  it('16. Volume removed, guest resident → the guest resolves INTO the volume pane', () => {
    const { cs, id } = withVolumeGuest()
    const gone = removeVolume(cs)
    const inst = gone.indicatorInstances.find((i) => i.instanceId === id)
    const p = resolvePlacement(inst, registry.getDefinition('movingAverage'), {
      ...ctxFor(gone), targetOf: (i) => resolveDisplayTarget(i, gone),
    })
    expect(p, 'the guest bound NOTHING — this is the member-visible disappearance').toBeTruthy()
    expect(p.paneIndex).toBe(1)
    // ⭐ THE UNITS ANSWER IS UNCHANGED: a guest takes the LEFT axis so Volume
    // keeps the right one. That stays true even with no bars on the right today —
    // re-adding Volume must not have to move anybody.
    expect(p.scaleId).toBe('left')
  })

  it('⛔⛔ 16b. WITH THE BARS GONE THE GUEST TAKES THE RIGHT AXIS — it is the host now', () => {
    // ⚰️⚰️ A VOLUME PANE WHOSE ONLY RESIDENT IS ON THE LEFT AXIS FREEZES THE
    // RENDERER. Measured in the live harness: `ChartWidget._adjustSizeImpl` throws
    // `Value is null` out of `ensureNotNull(paneWidget._leftPriceAxisWidget())` on
    // every draw AND every resize, so the canvas keeps its last good frame and
    // nothing afterwards paints. The member sees volume bars that are no longer on
    // the chart and a UI that has stopped responding.
    //
    // ⭐ `'left'` MEANS "SO VOLUME KEEPS THE RIGHT ONE". With no bars there is
    // nothing to keep it for, and the guest is the pane's host.
    const { cs, id } = withVolumeGuest()
    const gone = removeVolume(cs)
    const inst = gone.indicatorInstances.find((i) => i.instanceId === id)
    const def = registry.getDefinition('movingAverage')
    const targetOf = (i) => resolveDisplayTarget(i, gone)

    const withBars = resolvePlacement(inst, def, { ...ctxFor(gone), targetOf, nativeVolumeInPane: true })
    expect(withBars.scaleId, 'the bars still hold the right axis').toBe('left')

    const soloGuest = resolvePlacement(inst, def, { ...ctxFor(gone), targetOf, nativeVolumeInPane: false })
    expect(soloGuest.scaleId, 'the pane has nothing on its right axis — the renderer freezes').toBe('right')
    expect(soloGuest.paneIndex).toBe(1)
    expect(soloGuest.scaleOptions.visible).toBe(true)
    // …and it occupies the rectangle the bars did, not a different one.
    expect(soloGuest.scaleOptions.scaleMargins).toEqual({ top: 0.12, bottom: 0 })
  })

  it('⚠️ 16c. the flag ABSENT means the shipped answer — every older caller is unchanged', () => {
    const { cs, id } = withVolumeGuest()
    const inst = cs.indicatorInstances.find((i) => i.instanceId === id)
    const p = resolvePlacement(inst, registry.getDefinition('movingAverage'), {
      ...ctxFor(cs), targetOf: (i) => resolveDisplayTarget(i, cs),   // no `nativeVolumeInPane`
    })
    expect(p.scaleId).toBe('left')
  })

  it('17. …and with nothing resident it resolves nothing, as it always did', () => {
    const { cs, id } = withVolumeGuest()
    const moved = removeVolume(setInstanceDisplayTarget(cs, id, 'price', registry))
    const inst = moved.indicatorInstances.find((i) => i.instanceId === id)
    const p = resolvePlacement(inst, registry.getDefinition('movingAverage'), {
      ...ctxFor(moved), targetOf: (i) => resolveDisplayTarget(i, moved),
    })
    // Displayed on PRICE — not the volume branch, and certainly not pane 1.
    expect(p && p.paneIndex).not.toBe(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('⚠️ RECONSTRUCTION — a blob saved in this state must come back', () => {
  it('18. native Volume OFF + guest, round-tripped through `mergeChartSettings`', () => {
    // ⛔ THE COLD-LOAD PATH, WHICH IS THE ONE A LIVE SESSION NEVER TESTS. The
    // member closes the tab with Volume removed and an MA in its pane; the next
    // open has no renderer state at all, only this blob.
    const { cs } = withVolumeGuest()
    const saved = JSON.stringify(removeVolume(cs))
    const back = mergeChartSettings(saved)
    expect(back.volume.removed).toBe(true)
    expect(volumePaneRequired(optsFor(back)),
      'the pane did not come back on load — the guest draws nowhere').toBe(true)
    expect(volumeResidentKeys(back, back.indicatorInstances).size).toBe(1)
  })

  it('19. re-adding Volume gives exactly ONE pane, not a second', () => {
    const { cs } = withVolumeGuest()
    const gone = removeVolume(cs)
    const back = { ...gone, volume: { ...gone.volume, removed: false } }
    expect(volumePaneRequired(optsFor(back))).toBe(true)
    expect(nativeVolumeOwnsPane(optsFor(back)), 'the bars came back as a band').toBe(true)
    const order = resolvePaneOrder(
      back, defaultPaneKeys(back.indicatorInstances, {
        excludeKeys: new Set([
          ...volumeOverlayPaneKeys(back.indicatorInstances, back),
          ...paneFollowerKeys(back.indicatorInstances, back),
        ]),
        keepKeys: paneOwnersNeeded(back.indicatorInstances, back),
        includeKeys: paneOwnKeys(back.indicatorInstances, back),
      }),
      { volumePane: true },
    )
    expect(order.filter((k) => k === VOLUME_PANE).length, 'a duplicate volume pane').toBe(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('⛔ THE NATIVE HALF IS UNTOUCHED', () => {
  it('20. every native answer is byte-identical to the pre-split predicate', () => {
    // The old `volumeOwnsPane` expression, inlined. `nativeVolumeOwnsPane` must
    // agree with it on every combination — the split is allowed to ADD an answer,
    // never to change this one.
    const legacyAnswer = (o) => resolveVolumePresentation(o) === VOLUME_AS_PANE
    for (const visible of [true, false]) {
      for (const separatePane of [true, false]) {
        for (const removed of [true, false]) {
          for (const guest of [true, false]) {
            for (const blankVolume of [true, false]) {
              const built = guest
                ? withVolumeGuest({ volume: { visible, separatePane } }).cs
                : fresh({ volume: { visible, separatePane } })
              const cs = removed ? removeVolume(built) : built
              const o = optsFor(cs, { blankVolume })
              expect(nativeVolumeOwnsPane(o),
                `native drifted at visible=${visible} sep=${separatePane} removed=${removed} guest=${guest} blank=${blankVolume}`)
                .toBe(legacyAnswer(o))
            }
          }
        }
      }
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// ⭐⭐ AND NOW WITH A REAL RENDERER. Everything above is arithmetic; this is the
// rectangle. `prepareArrangement` creates the panes the layout asked for and
// `settleArrangement` reclaims the ones nothing draws in — the two halves that
// have to agree for a guest-only volume pane to exist at all.
// ─────────────────────────────────────────────────────────────────────────────
describe('⛔⛔ THE PANE, REALISED — real lightweight-charts', () => {
  const BARS = Array.from({ length: 20 }, (_, i) => ({
    time: `2026-09-${String(i + 1).padStart(2, '0')}`, value: 100 + i,
  }))
  const open = []
  afterEach(() => {
    while (open.length) {
      const h = open.pop()
      try { h.chart.remove() } catch { /* going anyway */ }
      try { h.el.remove() } catch { /* idem */ }
    }
  })

  function coldChart() {
    const el = document.createElement('div')
    document.body.appendChild(el)
    const chart = createChart(el, { width: 600, height: 500, timeScale: { visible: false } })
    const candles = chart.addSeries(LineSeries, {}, 0)
    candles.setData(BARS)
    const h = { el, chart, candles, series: new Map([[PRICE_PANE, candles]]) }
    open.push(h)
    return h
  }

  /** The layout StockChart would compute for `order`, through the real builder. */
  const layoutFor = (cs, order) => computePaneLayout(cs.indicatorInstances, {
    order, chartHeight: 500, separatorPx: 1, hasVolumeBand: false,
    excludeKeys: new Set([
      ...volumeOverlayPaneKeys(cs.indicatorInstances, cs),
      ...paneFollowerKeys(cs.indicatorInstances, cs),
    ]),
    keepKeys: paneOwnersNeeded(cs.indicatorInstances, cs),
    includeKeys: paneOwnKeys(cs.indicatorInstances, cs),
    firstPaneIndex: 1 + (order.includes(VOLUME_PANE) ? 1 : 0),
    abovePct: order.includes(VOLUME_PANE) ? [78, 22] : [100],
    mainPaneIndex: 0,
  })

  it('21. Volume removed + guest → the pane is CREATED and the guest draws in it', () => {
    const { cs } = withVolumeGuest()
    const gone = removeVolume(cs)
    const order = [PRICE_PANE, VOLUME_PANE]
    const layout = layoutFor(gone, order)
    const h = coldChart()

    // ⛔ THE COUNT IS THE WHOLE OF STEP 1. With `paneCountRequired` absent — which
    // is what this path returned before — `need` is 0, nothing is created, and the
    // guest has no pane to be placed into.
    expect(Number.isInteger(layout.paneCountRequired)).toBe(true)
    const opts = {
      order, paneCountRequired: layout.paneCountRequired, pinned: 0,
      priceKey: PRICE_PANE, volumeKey: VOLUME_PANE,
      paneOf: (key) => {
        const s = h.series.get(key)
        try { return s ? s.getPane() : null } catch { return null }
      },
    }
    prepareArrangement(h.chart, opts)
    expect(h.chart.panes().length, 'the volume pane was never created').toBe(2)

    // The binder's guest, at the index `placement.js` resolved.
    const guest = h.chart.addSeries(LineSeries, {}, layout.volumeIndex)
    guest.setData(BARS)
    h.series.set(VOLUME_PANE, guest)

    settleArrangement(h.chart, opts)
    expect(h.chart.panes().length, 'the sweep reclaimed a pane a guest draws in').toBe(2)
    expect(guest.getPane().paneIndex()).toBe(1)
    expect(h.candles.getPane().paneIndex()).toBe(0)
  })

  it('⭐ 22. VOLUME ABOVE PRICE, bars removed → the guest lands at slot 0, not 1', () => {
    // ⚰️ THE LITERAL `1`. `VOL_PANE_INDEX` fell back to a hard-coded 1 whenever
    // the layout reported no `volumeIndex`, which was EVERY chart with no
    // oscillator pane. A member who dragged Volume to the top got the guest, the
    // volume MA and the extended-hours shading in PRICE's pane instead.
    const { cs } = withVolumeGuest({ paneOrder: [VOLUME_PANE, PRICE_PANE] })
    const gone = removeVolume(cs)
    const order = [VOLUME_PANE, PRICE_PANE]
    const layout = layoutFor(gone, order)
    expect(layout.volumeIndex, 'the arranged slot was lost').toBe(0)

    const h = coldChart()
    const opts = {
      order, paneCountRequired: layout.paneCountRequired, pinned: 0,
      priceKey: PRICE_PANE, volumeKey: VOLUME_PANE,
      paneOf: (key) => {
        const s = h.series.get(key)
        try { return s ? s.getPane() : null } catch { return null }
      },
    }
    prepareArrangement(h.chart, opts)
    const guest = h.chart.addSeries(LineSeries, {}, layout.volumeIndex)
    guest.setData(BARS)
    h.series.set(VOLUME_PANE, guest)
    settleArrangement(h.chart, opts)

    expect(h.chart.panes().length).toBe(2)
    expect(guest.getPane().paneIndex(), 'the guest drew in PRICE’s pane').toBe(0)
    expect(h.candles.getPane().paneIndex()).toBe(1)
  })

  it('23. …and when the guest goes too, the rectangle finally does', () => {
    const { cs } = withVolumeGuest()
    const gone = removeVolume(cs)
    const h = coldChart()
    const opts = {
      order: [PRICE_PANE, VOLUME_PANE], paneCountRequired: 2, pinned: 0,
      priceKey: PRICE_PANE, volumeKey: VOLUME_PANE,
      paneOf: (key) => {
        const s = h.series.get(key)
        try { return s ? s.getPane() : null } catch { return null }
      },
    }
    prepareArrangement(h.chart, opts)
    const guest = h.chart.addSeries(LineSeries, {}, 1)
    guest.setData(BARS)
    h.series.set(VOLUME_PANE, guest)
    settleArrangement(h.chart, opts)
    expect(h.chart.panes().length).toBe(2)

    // The member deletes the MA as well: no resident, no pane.
    h.chart.removeSeries(guest); h.series.delete(VOLUME_PANE)
    const bare = patch(gone, gone.indicatorInstances[0].instanceId, (i) => ({ ...i, deleted: true }))
    expect(volumePaneRequired(optsFor(bare))).toBe(false)
    settleArrangement(h.chart, {
      order: [PRICE_PANE], paneCountRequired: 1, pinned: 0,
      priceKey: PRICE_PANE, volumeKey: null, paneOf: opts.paneOf,
    })
    expect(h.chart.panes().length, 'a ghost strip survived').toBe(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// ⛔⛔ THE CHART'S LEFT AXIS TRACKS ITS TENANTS — the render freeze, railed.
// ─────────────────────────────────────────────────────────────────────────────
describe('⚰️⚰️ A VACATED LEFT SCALE FREEZES THE CHART', () => {
  /** The smallest chart the binder will talk to, recording option writes. */
  function fakeChart() {
    const opts = { leftPriceScale: { visible: false }, rightPriceScale: { visible: true } }
    const writes = []
    const scale = () => ({ applyOptions: () => {}, options: () => ({}) })
    const pane = { paneIndex: () => 1, getHeight: () => 100, getSeries: () => [] }
    return {
      writes, opts,
      options: () => opts,
      applyOptions: (o) => {
        writes.push(o)
        if (o && o.leftPriceScale && 'visible' in o.leftPriceScale) {
          opts.leftPriceScale = { ...opts.leftPriceScale, ...o.leftPriceScale }
        }
      },
      panes: () => [pane],
      addSeries: () => ({
        setData: () => {}, applyOptions: () => {}, priceScale: scale,
        getPane: () => pane, moveToPane: () => {}, seriesType: () => 'Line',
      }),
      removeSeries: () => {},
    }
  }

  it('24. deleting the last indicator turns the left axis back OFF', () => {
    // ⛔ THE DISABLED EXIT IS THE ONE THAT MATTERS. Removing the last instance
    // takes `sync` down `enabled === false`, which returns before any placement is
    // resolved — so an assertion that only ran in pass two never ran at all, and
    // the axis a volume guest turned on stayed on with nothing drawn against it.
    const chart = fakeChart()
    chart.opts.leftPriceScale.visible = true              // a guest left it on
    const binder = createBinder({ chart, LWC: {} })
    binder.sync({ enabled: false })
    expect(chart.opts.leftPriceScale.visible,
      'the axis outlived its last tenant — the next pane swap throws').toBe(false)
  })

  it('25. …and it is idempotent — no write when the value is already right', () => {
    const chart = fakeChart()
    const binder = createBinder({ chart, LWC: {} })
    binder.sync({ enabled: false })                       // already false
    expect(chart.writes.filter((w) => w && w.leftPriceScale).length).toBe(0)
  })

  it('⛔ 26. the assertion is spelled BEFORE the scale writes, not after', () => {
    // ⚰️ ORDER IS THE WHOLE FIX ON THE WAY BACK UP. `series.priceScale()
    // .applyOptions({visible:true})` flips the chart-level flag WITHOUT recreating
    // the pane widgets, so a draw between that write and a `chart.applyOptions`
    // walks panes with no left axis widget and throws. Measured as exactly three
    // `Value is null` exceptions on the frame a member restores Volume beside a
    // guest. This reads the source because the ordering is the contract.
    const body = readFileSync(path.resolve(BINDER_DIR, '../binder.js'), 'utf8')
    const assertAt = body.indexOf('assertLeftAxis(prepared.some(')
    const passTwoAt = body.indexOf('── PASS TWO')
    expect(assertAt, 'the pre-pass assertion is gone').toBeGreaterThan(0)
    expect(passTwoAt).toBeGreaterThan(0)
    expect(assertAt, 'the left axis is asserted AFTER the scales are written')
      .toBeLessThan(passTwoAt)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// ⛔⛔ A RESIDENT IS AN INTENT — THE SERIES HAS NOT MOVED YET.
// ─────────────────────────────────────────────────────────────────────────────
describe('⚰️ MOVING AN EXISTING OVERLAY INTO VOLUME', () => {
  it('27. the engine says the pane is required the instant Display flips to Volume', () => {
    // ⚰️⚰️ THE DEFECT, MEASURED IN THE LIVE HARNESS 2026-09-18. With native Volume
    // removed and NO volume pane on screen, "Display in: Volume" did nothing: the
    // MA stayed in the candles. `displayTarget` names a resident by INTENT, and in
    // that frame the series is still sitting in PRICE's pane — so the renderer's
    // `paneOf('volume')` answered with PRICE's rectangle, `prepareArrangement`
    // swapped Price out of slot 0 to make room for a pane it already had, the
    // binder placed the guest at the volume index (Price's old pane), and the
    // sweep reclaimed the leftover. One pane, and the member's choice lost.
    //
    // ⭐ `null` IS THE HONEST MID-TRANSITION ANSWER — the volume key has no pane
    // YET. The renderer creates one and the binder moves the guest into it.
    const base = fresh({ volume: { visible: true, separatePane: true } })
    const added = addInstance(base, 'movingAverage', registry)
    const id = lastCreatedInstance(base, added).instanceId
    // A PRICE overlay: source is the candles, home is the candles.
    const onPrice = setInstanceDisplayTarget(added, id, 'price', registry)
    const gone = removeVolume(onPrice)
    expect(volumePaneRequired(optsFor(gone)), 'a price overlay held the volume pane').toBe(false)

    const toVolume = setInstanceDisplayTarget(gone, id, 'volume', registry)
    expect(resolveDisplayTarget(toVolume.indicatorInstances.find((i) => i.instanceId === id), toVolume))
      .toBe('volume')
    expect(volumePaneRequired(optsFor(toVolume)),
      'the member sent it to Volume and the pane was not required').toBe(true)
  })

  it('28. …and sending it back to Price gives the pane up again', () => {
    const base = fresh({ volume: { visible: true, separatePane: true } })
    const added = addInstance(base, 'movingAverage', registry)
    const id = lastCreatedInstance(base, added).instanceId
    const gone = removeVolume(setInstanceDisplayTarget(added, id, 'volume', registry))
    expect(volumePaneRequired(optsFor(gone))).toBe(true)
    const back = setInstanceDisplayTarget(gone, id, 'price', registry)
    expect(volumePaneRequired(optsFor(back)), 'an empty rectangle survived the move out').toBe(false)
  })

  it('⛔ 29. the renderer never names the CANDLES’ pane as the volume pane', () => {
    // The ordering contract, read from the source: `_volResidentPane` is what both
    // `paneOf('volume')` and the native bars' creation index go through, and it
    // must skip a resident still sitting in Price. Without the skip, `addSeries`
    // draws the volume bars straight over the candles.
    const body = readFileSync(path.resolve(BINDER_DIR, '../../../StockChart.jsx'), 'utf8')
    const fn = body.slice(body.indexOf('const _volResidentPane'), body.indexOf('const _volResidentPane') + 900)
    expect(fn, 'the price-pane exclusion is gone').toMatch(/priceIdx/)
    expect(fn).toMatch(/gp\.paneIndex\?\.\(\) === priceIdx\) continue/)
    // …and both consumers go through it rather than scanning bindings themselves.
    expect(body).toContain('return _volResidentPane()')
    expect(body).toContain('const i = _volResidentPane()?.paneIndex?.()')
  })
})
