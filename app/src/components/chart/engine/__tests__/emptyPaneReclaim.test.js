// app/src/components/chart/engine/__tests__/emptyPaneReclaim.test.js
//
// ─── DELETE THE LAST RESIDENT, LOSE THE PANE ────────────────────────────────
//
// ⚰️⚰️ THE GHOST PANE, AS THE MEMBER MET IT. Indicators → Volume → Remove. The
// bars go; the RECTANGLE does not. A divider and an empty strip stay at the
// bottom of the chart, holding height nothing draws in. Measured in the live
// harness on a Price+Volume chart: panes `[538, sep, 152, axis]` BEFORE the
// delete and `[538, sep, 152, axis]` after it — byte-identical, with the volume
// pane still carrying its four canvases.
//
// ⛔ AND THE RECLAIM CODE WAS ALREADY THERE. `settleArrangement`'s tail walks the
// stack removing panes that hold no series — that is what keeps `addPane(true)`
// placeholders from surviving a cold build. It never ran, because forty lines
// above it the function says:
//
//     if (order.length <= 1) return
//
// A Price+Volume chart that loses Volume has an order of exactly ONE key. The
// guard is right about the MOVES (there is nothing to arrange with one pane) and
// wrong about the SWEEP, which is precisely the case a shrinking chart hits.
//
// ⭐ SO THE TWO HALVES ARE SEPARATED. Ordering still needs two keys to mean
// anything; reclaiming an empty rectangle does not need any.

import { describe, it, expect, afterEach } from 'vitest'
import { createChart, LineSeries } from 'lightweight-charts'
import { prepareArrangement, settleArrangement, slotOfKey } from '../paneRealization'
import { PRICE_PANE, VOLUME_PANE } from '../paneOrder'

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

const paneOfFor = (h) => (key) => {
  const s = h.series.get(key)
  try { return s ? s.getPane() : null } catch { return null }
}

/** Build a chart holding `order`, the way StockChart does. */
const build = (h, order, extra) => {
  const opts = { order, paneCountRequired: order.length, pinned: 0, priceKey: PRICE_PANE, paneOf: paneOfFor(h), ...extra }
  prepareArrangement(h.chart, opts)
  for (const key of order) {
    if (key === PRICE_PANE || h.series.has(key)) continue
    const s = h.chart.addSeries(LineSeries, {}, slotOfKey(order, key, opts))
    s.setData(BARS)
    h.series.set(key, s)
  }
  settleArrangement(h.chart, opts)
  return opts
}

/** The member's delete: the series leaves the chart, the pane is left behind. */
const removeKey = (h, key) => {
  const s = h.series.get(key)
  if (s) { h.chart.removeSeries(s); h.series.delete(key) }
}

const paneCount = (h) => h.chart.panes().length
const occupied = (h) => h.chart.panes().filter((p) => (p.getSeries() || []).length > 0).length

// ─────────────────────────────────────────────────────────────────────────────
describe('⚰️⚰️ THE GHOST PANE — deleting the last resident', () => {
  it('⛔ Price + Volume → delete Volume → the Volume pane is GONE', () => {
    const h = coldChart()
    build(h, [PRICE_PANE, VOLUME_PANE], { volumeKey: VOLUME_PANE })
    expect(paneCount(h), 'the two-pane chart did not build').toBe(2)

    removeKey(h, VOLUME_PANE)
    // What StockChart re-runs on the next paint: volume is no longer a pane, so
    // it drops out of the order AND out of `volumeKey`.
    settleArrangement(h.chart, {
      order: [PRICE_PANE], paneCountRequired: 1, pinned: 0,
      priceKey: PRICE_PANE, volumeKey: null, paneOf: paneOfFor(h),
    })

    expect(paneCount(h), 'the emptied Volume pane survived — ghost strip + divider')
      .toBe(1)
    expect(occupied(h)).toBe(1)
  })

  it('⛔ and the candles stay put — reclaiming is not re-homing', () => {
    const h = coldChart()
    build(h, [PRICE_PANE, VOLUME_PANE], { volumeKey: VOLUME_PANE })
    removeKey(h, VOLUME_PANE)
    settleArrangement(h.chart, {
      order: [PRICE_PANE], paneCountRequired: 1, pinned: 0,
      priceKey: PRICE_PANE, volumeKey: null, paneOf: paneOfFor(h),
    })
    expect(h.candles.getPane().paneIndex()).toBe(0)
  })

  it('⭐ VOLUME ABOVE PRICE → delete Volume → Price is the only pane, at 0', () => {
    // ⛔ PRICE IS SEMANTIC, NOT PHYSICAL PANE 0. The reclaim must not assume the
    // emptied rectangle is the LAST one.
    const h = coldChart()
    build(h, [VOLUME_PANE, PRICE_PANE], { volumeKey: VOLUME_PANE })
    expect(paneCount(h)).toBe(2)
    expect(h.series.get(VOLUME_PANE).getPane().paneIndex()).toBe(0)

    removeKey(h, VOLUME_PANE)
    settleArrangement(h.chart, {
      order: [PRICE_PANE], paneCountRequired: 1, pinned: 0,
      priceKey: PRICE_PANE, volumeKey: null, paneOf: paneOfFor(h),
    })
    expect(paneCount(h), 'an empty pane survived ABOVE Price').toBe(1)
    expect(h.candles.getPane().paneIndex()).toBe(0)
  })

  it('⭐ Price + Volume + RSI → delete Volume → two panes, RSI survives', () => {
    // ⚠️ THIS ONE ALREADY PASSED before the fix, and that is the DISCRIMINATOR:
    // the surviving order is two keys long, so `settleArrangement` did not take
    // its early return and the sweep ran. Same defect, different arity.
    const h = coldChart()
    build(h, [PRICE_PANE, VOLUME_PANE, 'rsi'], { volumeKey: VOLUME_PANE })
    expect(paneCount(h)).toBe(3)

    removeKey(h, VOLUME_PANE)
    settleArrangement(h.chart, {
      order: [PRICE_PANE, 'rsi'], paneCountRequired: 2, pinned: 0,
      priceKey: PRICE_PANE, volumeKey: null, paneOf: paneOfFor(h),
    })
    expect(paneCount(h)).toBe(2)
    expect(h.series.get('rsi'), 'RSI went with the Volume pane').toBeTruthy()
    expect(h.series.get('rsi').getPane().paneIndex()).toBe(1)
  })

  it('⭐⭐ A GUEST KEEPS THE PANE — delete Volume bars, an MA still lives there', () => {
    // The locked rule: residency, not `volume.enabled`. An MA whose Display is
    // the Volume pane is a resident, so the rectangle stays.
    const h = coldChart()
    build(h, [PRICE_PANE, VOLUME_PANE], { volumeKey: VOLUME_PANE })
    // A guest drawn INTO the volume pane.
    const guest = h.chart.addSeries(LineSeries, {}, 1)
    guest.setData(BARS)
    h.series.set('ma-in-volume', guest)

    removeKey(h, VOLUME_PANE)
    settleArrangement(h.chart, {
      order: [PRICE_PANE, VOLUME_PANE], paneCountRequired: 2, pinned: 0,
      priceKey: PRICE_PANE, volumeKey: VOLUME_PANE, paneOf: paneOfFor(h),
    })
    expect(paneCount(h), 'the pane went while a guest was still drawing in it').toBe(2)
    expect(guest.getPane().paneIndex()).toBe(1)

    // …and when the guest goes too, the rectangle finally does.
    h.chart.removeSeries(guest); h.series.delete('ma-in-volume')
    settleArrangement(h.chart, {
      order: [PRICE_PANE], paneCountRequired: 1, pinned: 0,
      priceKey: PRICE_PANE, volumeKey: null, paneOf: paneOfFor(h),
    })
    expect(paneCount(h)).toBe(1)
  })

  it('⛔ a PINNED pane is never reclaimed, even when empty', () => {
    // `pinned` is the index-pane contract: the sweep walks DOWN to `pinned` and
    // stops, so a reserved pane below that index is off limits however empty it is.
    //
    // ⚠️ MEASURED, AND IT IS WHY THIS CASE IS SHAPED THIS WAY: lightweight-charts
    // COLLAPSES PANE 0 ITSELF when its last series is removed (panes 2 → 1, the
    // survivor inheriting index 0) but keeps every NON-ZERO pane it is handed.
    // So "empty pane 0 and check it survives" cannot be asserted by anyone — the
    // library has already acted. The contract that IS ours is the loop's floor,
    // so this pins an empty pane at index 1 under `pinned: 2`.
    const h = coldChart()
    build(h, [PRICE_PANE, VOLUME_PANE, 'rsi'], { volumeKey: VOLUME_PANE })
    expect(paneCount(h)).toBe(3)
    removeKey(h, VOLUME_PANE)          // empties index 1
    settleArrangement(h.chart, {
      order: [PRICE_PANE, 'rsi'], paneCountRequired: 2, pinned: 2,
      priceKey: PRICE_PANE, volumeKey: null, paneOf: paneOfFor(h),
    })
    expect(paneCount(h), 'the sweep reached below `pinned`').toBe(3)

    // …and with the floor back where it belongs, the same empty pane goes.
    settleArrangement(h.chart, {
      order: [PRICE_PANE, 'rsi'], paneCountRequired: 2, pinned: 0,
      priceKey: PRICE_PANE, volumeKey: null, paneOf: paneOfFor(h),
    })
    expect(paneCount(h)).toBe(2)
  })

  it('⭐ re-adding Volume realises exactly ONE pane again', () => {
    const h = coldChart()
    build(h, [PRICE_PANE, VOLUME_PANE], { volumeKey: VOLUME_PANE })
    removeKey(h, VOLUME_PANE)
    settleArrangement(h.chart, {
      order: [PRICE_PANE], paneCountRequired: 1, pinned: 0,
      priceKey: PRICE_PANE, volumeKey: null, paneOf: paneOfFor(h),
    })
    expect(paneCount(h)).toBe(1)

    build(h, [PRICE_PANE, VOLUME_PANE], { volumeKey: VOLUME_PANE })
    expect(paneCount(h), 'a duplicate pane came back with Volume').toBe(2)
    expect(occupied(h)).toBe(2)
  })

  it('⛔ an empty chart is left alone — no panes, no throw', () => {
    const h = coldChart()
    removeKey(h, PRICE_PANE)
    expect(() => settleArrangement(h.chart, {
      order: [], paneCountRequired: 0, pinned: 0, priceKey: null, volumeKey: null,
      paneOf: paneOfFor(h),
    })).not.toThrow()
  })
})
