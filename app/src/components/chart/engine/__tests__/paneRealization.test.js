// app/src/components/chart/engine/__tests__/paneRealization.test.js
//
// ─── THE COLD-BUILD COLLISION, ON A REAL RENDERER ───────────────────────────
//
// ⚰️⚰️ THIS FILE EXISTS BECAUSE A CHART RECONSTRUCTED WITH A STORED ARRANGEMENT
// RENDERED THREE PANES WHERE FOUR WERE EXPECTED, and the same chart with no
// arrangement rebuilt all four. Every unit seam was green: the order resolved,
// the geometry moved slots and not heights, Chart Data listed four panes. The
// picture was still wrong, because a FINAL VISUAL SLOT was being used as a place
// to CREATE a series while the candles still occupied pane 0.
//
// ⛔ SO THESE RUN AGAINST `createChart`, NOT A FAKE. A fake would have to model
// "adding a series at the index another series already occupies merges their
// panes", which is precisely the behaviour nobody knew to model. The library is
// the only honest witness.
//
// ⚠️ `noCollisionControl` IS THE CASE THAT FAILS WITHOUT `prepareArrangement`.
// It places series at final slots on a cold chart exactly as the binder does,
// with Price arranged away from the top — the shape that produced the merge.

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

/** A chart in its COLD state: the candle series exists, at pane 0, alone. */
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

/** What the binder does: put a series at a key's FINAL slot. */
function placeAtSlot(h, key, order, opts) {
  const slot = slotOfKey(order, key, opts)
  const s = h.chart.addSeries(LineSeries, {}, slot)
  s.setData(BARS)
  h.series.set(key, s)
  return s
}

const paneOfFor = (h) => (key) => {
  const s = h.series.get(key)
  try { return s ? s.getPane() : null } catch { return null }
}

/** Every pane that actually holds something, with the keys it holds. */
function membership(h) {
  const panes = h.chart.panes()
  return panes.map((p, i) => {
    const set = new Set(p.getSeries())
    const keys = [...h.series.entries()].filter(([, s]) => set.has(s)).map(([k]) => k)
    return { index: i, keys: keys.sort() }
  }).filter((r) => r.keys.length > 0)
}

const build = (h, order, extra) => {
  const opts = { order, paneCountRequired: order.length, pinned: 0, priceKey: PRICE_PANE, paneOf: paneOfFor(h), ...extra }
  prepareArrangement(h.chart, opts)
  for (const key of order) if (key !== PRICE_PANE && !h.series.has(key)) placeAtSlot(h, key, order, opts)
  settleArrangement(h.chart, opts)
  return opts
}

describe('⚰️⚰️ the cold-build collision', () => {
  it('⚰️ FOUR semantic panes reconstruct as FOUR — none merged', () => {
    // ⛔ THE REGRESSION RAIL. On b66d8aef5 this produced three panes, with the
    // top-of-the-arrangement key sharing the candles' pane.
    const h = coldChart()
    const order = ['qqq', PRICE_PANE, 'rsi', 'macd']
    build(h, order)

    const m = membership(h)
    expect(m.length, `panes merged: ${JSON.stringify(m)}`).toBe(4)
    for (const row of m) {
      expect(row.keys.length, `pane ${row.index} holds two semantic panes: ${row.keys}`).toBe(1)
    }
    expect(m.map((r) => r.keys[0])).toEqual(order)
  })

  it('⚰️ …and WITHOUT prepare the merge really happens — the rail is not vacuous', () => {
    // The pre-fix sequence, reproduced deliberately: place at final slots on a
    // cold chart with no preparation. If the library ever stopped merging here,
    // the rail above would be proving nothing and this case says so.
    const h = coldChart()
    const order = ['qqq', PRICE_PANE, 'rsi', 'macd']
    const opts = { order, pinned: 0, paneOf: paneOfFor(h) }
    for (const key of order) if (key !== PRICE_PANE) placeAtSlot(h, key, order, opts)

    const m = membership(h)
    const merged = m.find((r) => r.keys.length > 1)
    expect(merged, 'no pane merged without prepare — the fix may no longer be needed').toBeTruthy()
    expect(merged.keys).toContain(PRICE_PANE)
    expect(m.length).toBeLessThan(4)
  })
})

describe('the arrangements reconstruct', () => {
  const cases = [
    ['Price first (the default shape)', [PRICE_PANE, 'rsi', 'macd']],
    ['one pane above Price', ['qqq', PRICE_PANE, 'rsi', 'macd']],
    ['two panes above Price', ['qqq', 'rsi', PRICE_PANE, 'macd']],
    ['Price at the bottom', ['qqq', 'rsi', 'macd', PRICE_PANE]],
    ['Price between panes', ['qqq', PRICE_PANE, 'macd']],
  ]
  for (const [name, order] of cases) {
    it(`⭐ ${name}`, () => {
      const h = coldChart()
      build(h, order)
      const m = membership(h)
      expect(m.length, `expected ${order.length} panes, got ${JSON.stringify(m)}`).toBe(order.length)
      expect(m.map((r) => r.keys[0])).toEqual(order)
      expect(h.candles.getPane().paneIndex()).toBe(order.indexOf(PRICE_PANE))
    })
  }
})

describe('duplicates, guests and volume', () => {
  it('⭐⭐ two hosts of one definition stay DISTINCT panes', () => {
    const h = coldChart()
    const order = ['inst:dataSeries:1', PRICE_PANE, 'inst:dataSeries:2']
    build(h, order)
    const m = membership(h)
    expect(m.length).toBe(3)
    expect(m.map((r) => r.keys[0])).toEqual(order)
  })

  it('⭐⭐ a host and its guests are ONE pane, and travel together', () => {
    const h = coldChart()
    const order = ['qqq', PRICE_PANE, 'rsi']
    const opts = build(h, order)
    // SPY and MA(QQQ) are guests: they resolve to the HOST's slot, not their own.
    for (const guest of ['spy', 'ma']) {
      const s = h.chart.addSeries(LineSeries, {}, slotOfKey(order, 'qqq', opts))
      s.setData(BARS); h.series.set(guest, s)
    }
    settleArrangement(h.chart, opts)

    const m = membership(h)
    expect(m.length, 'a guest was given a pane of its own').toBe(3)
    expect(m[0].keys).toEqual(['ma', 'qqq', 'spy'])
    // …and moving the host carries them: put QQQ below Price.
    const moved = ['qqq', PRICE_PANE, 'rsi'].slice()
    moved.splice(0, 1); moved.splice(1, 0, 'qqq')      // price, qqq, rsi
    settleArrangement(h.chart, { ...opts, order: moved })
    const m2 = membership(h)
    expect(m2.map((r) => r.keys[0] === PRICE_PANE ? PRICE_PANE : r.keys.join('+')))
      .toEqual([PRICE_PANE, 'ma+qqq+spy', 'rsi'])
  })

  it('⛔ a BANDED volume is never realised as a pane', () => {
    const h = coldChart()
    // `volumeKey` omitted — the band lives inside the candles' pane.
    const order = [PRICE_PANE, 'rsi']
    build(h, order, { volumeKey: null })
    expect(h.chart.panes().length, 'a band was given a pane').toBe(2)
    expect(membership(h).some((r) => r.keys.includes(VOLUME_PANE))).toBe(false)
  })

  it('⭐ an INDEPENDENT volume pane is arranged like any other', () => {
    // ⚠️ CREATED AT ITS SLOT, WHICH IS WHAT `StockChart` DOES. A separate volume
    // series is added with a pane index (`VOL_PANE_INDEX`); it is never born in
    // the candles' pane and moved out.
    const h = coldChart()
    const order = [VOLUME_PANE, PRICE_PANE, 'rsi']
    const opts = { order, paneCountRequired: 3, pinned: 0, priceKey: PRICE_PANE, volumeKey: VOLUME_PANE, paneOf: paneOfFor(h) }
    prepareArrangement(h.chart, opts)
    placeAtSlot(h, VOLUME_PANE, order, opts)
    placeAtSlot(h, 'rsi', order, opts)
    settleArrangement(h.chart, opts)
    expect(membership(h).map((r) => r.keys[0])).toEqual(order)
    expect(h.candles.getPane().paneIndex()).toBe(1)
  })
})

describe('⛔ no placeholder is left behind', () => {
  it('the pane COUNT equals the number of semantic panes', () => {
    const h = coldChart()
    // Ask for room for five, then only ever fill three.
    const order = ['qqq', PRICE_PANE, 'rsi']
    const opts = { order, paneCountRequired: 5, pinned: 0, priceKey: PRICE_PANE, paneOf: paneOfFor(h) }
    prepareArrangement(h.chart, opts)
    expect(h.chart.panes().length, 'prepare did not reserve the room it was asked for').toBe(5)
    for (const key of order) if (key !== PRICE_PANE) placeAtSlot(h, key, order, opts)
    settleArrangement(h.chart, opts)
    expect(h.chart.panes().length, 'an empty placeholder survived settle').toBe(3)
    expect(membership(h).map((r) => r.keys[0])).toEqual(order)
  })
})

describe('idempotence', () => {
  it('⭐ settling an already-arranged chart changes nothing', () => {
    const h = coldChart()
    const order = ['qqq', PRICE_PANE, 'rsi']
    const opts = build(h, order)
    const before = JSON.stringify(membership(h))
    settleArrangement(h.chart, opts)
    settleArrangement(h.chart, opts)
    expect(JSON.stringify(membership(h))).toBe(before)
  })

  it('⛔ an absent or single-entry order does nothing at all', () => {
    const h = coldChart()
    const n = h.chart.panes().length
    prepareArrangement(h.chart, { order: [], paneOf: () => null })
    prepareArrangement(h.chart, { order: [PRICE_PANE], paneCountRequired: 9, paneOf: paneOfFor(h) })
    settleArrangement(h.chart, { order: [PRICE_PANE], paneOf: paneOfFor(h) })
    expect(h.chart.panes().length).toBe(n)
  })
})
