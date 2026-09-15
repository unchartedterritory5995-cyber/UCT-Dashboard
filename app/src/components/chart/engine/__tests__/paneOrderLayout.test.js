// app/src/components/chart/engine/__tests__/paneOrderLayout.test.js
//
// ─── THE ARRANGEMENT REACHES THE GEOMETRY, AND THE GEOMETRY STAYS TOTAL ─────
//
// ⛔⛔ THE FIRST DESCRIBE IS THE BLANK-CHART RAIL. `paneLayout.js`'s own header
// records three frame-of-reference defects that over-allocated the budget and
// threw `paneHeightMismatch` into StockChart's ErrorBoundary — "a DETERMINISTIC
// BLANK CHART, on every one of the 46 parity cases". An arrangement must move
// panes WITHOUT changing a single height, so the identity that made the geometry
// total is asserted directly: same multiset of pixels, same sum, only the slots
// differ.

import { describe, it, expect } from 'vitest'
import { computePaneLayout, paneStretchPlan } from '../paneLayout'
import { PRICE_PANE, VOLUME_PANE } from '../paneOrder'

const inst = (defId, instanceId) => ({ defId, instanceId, inputs: {} })
const RSI = inst('rsi', 'inst:rsi:1')
const MACD = inst('macd', 'inst:macd:1')

/** The shipped call shape: candles at 0, a separate volume pane at 1. */
const opts = (extra) => ({
  chartHeight: 600,
  hasVolumeBand: false,
  separatorPx: 1,
  firstPaneIndex: 2,
  abovePct: [78, 22],
  mainPaneIndex: 0,
  ...extra,
})

const heightsOf = (l) => [
  ...[...(l.aboveByIndex || new Map())].map(([i, h]) => [i, h]),
  ...l.panes.map((p) => [p.index, p.heightPx]),
].sort((a, b) => a[0] - b[0])

describe('⛔⛔ an arrangement moves slots and NEVER a height', () => {
  const instances = [RSI, MACD]

  it('the same pixels, in a different order', () => {
    const plain = computePaneLayout(instances, opts())
    const moved = computePaneLayout(instances, opts({
      order: ['inst:rsi:1', PRICE_PANE, VOLUME_PANE, 'inst:macd:1'],
    }))

    const bag = (l) => heightsOf(l).map(([, h]) => h).sort((a, b) => a - b)
    expect(bag(moved), 'the arrangement changed the heights').toEqual(bag(plain))
    expect(bag(moved).reduce((s, h) => s + h, 0))
      .toBe(bag(plain).reduce((s, h) => s + h, 0))
  })

  it('⭐ every slot is used exactly once, with no gap', () => {
    const l = computePaneLayout(instances, opts({
      order: ['inst:rsi:1', PRICE_PANE, VOLUME_PANE, 'inst:macd:1'],
    }))
    const slots = heightsOf(l).map(([i]) => i)
    expect(slots).toEqual([0, 1, 2, 3])
  })

  it('⛔ the candle pane keeps its own height wherever it sits', () => {
    const plain = computePaneLayout(instances, opts())
    const moved = computePaneLayout(instances, opts({
      order: ['inst:rsi:1', 'inst:macd:1', VOLUME_PANE, PRICE_PANE],
    }))
    expect(moved.pane0.heightPx).toBe(plain.pane0.heightPx)
    expect(moved.pane0.mainMargins).toEqual(plain.pane0.mainMargins)
  })
})

describe('⛔⛔ no order means byte-for-byte the old layout', () => {
  it('an un-arranged chart is identical to one computed before arrangements existed', () => {
    const a = computePaneLayout([RSI, MACD], opts())
    const b = computePaneLayout([RSI, MACD], opts({ order: null }))
    expect(JSON.stringify(b.panes)).toBe(JSON.stringify(a.panes))
    expect(a.panes.map((p) => p.index)).toEqual([2, 3])   // firstPaneIndex + i
    expect(a.priceIndex).toBe(0)
  })

  it('⛔ an order that names nothing on the chart falls back, it does not empty it', () => {
    const l = computePaneLayout([RSI], opts({ order: ['nope', 'also-nope'] }))
    expect(l.panes.length).toBe(1)
    expect(Number.isInteger(l.panes[0].index)).toBe(true)
  })
})

describe('where Price and Volume ended up', () => {
  it('⭐⭐ Price is NOT required to be slot 0', () => {
    const l = computePaneLayout([RSI], opts({
      firstPaneIndex: 1, abovePct: [100], mainPaneIndex: 0,
      order: ['inst:rsi:1', PRICE_PANE],
    }))
    expect(l.priceIndex).toBe(1)
    expect(l.panes[0].index).toBe(0)
  })

  it('⭐ Price at the very bottom', () => {
    const l = computePaneLayout([RSI, MACD], opts({
      firstPaneIndex: 1, abovePct: [100], mainPaneIndex: 0,
      order: ['inst:rsi:1', 'inst:macd:1', PRICE_PANE],
    }))
    expect(l.priceIndex).toBe(2)
    expect(l.panes.map((p) => [p.key, p.index]))
      .toEqual([['inst:rsi:1', 0], ['inst:macd:1', 1]])
  })

  it('⭐⭐ an independent Volume pane moves on its own — Price does not drag it', () => {
    const l = computePaneLayout([RSI], opts({
      order: [VOLUME_PANE, 'inst:rsi:1', PRICE_PANE],
    }))
    expect(l.volumeIndex).toBe(0)
    expect(l.priceIndex).toBe(2)
    expect(l.panes[0].index).toBe(1)
  })

  it('⛔ a BANDED volume has no pane slot at all', () => {
    const l = computePaneLayout([RSI], {
      ...opts(), hasVolumeBand: true, firstPaneIndex: 1, abovePct: [100], mainPaneIndex: 0,
      order: [PRICE_PANE, 'inst:rsi:1'],
    })
    expect(l.volumeIndex, 'a band was given a pane index').toBeNull()
    expect(l.pane0.volumeMargins, 'the band lost its margins').toBeTruthy()
  })

  it('⛔ the Model Book index pane keeps slot 0 and is not arrangeable', () => {
    // firstPaneIndex 3 = index pane, candles, volume pane; mainPaneIndex 1.
    const l = computePaneLayout([RSI], {
      ...opts(), firstPaneIndex: 3, abovePct: [18, 60, 22], mainPaneIndex: 1,
      order: ['inst:rsi:1', PRICE_PANE, VOLUME_PANE],
    })
    expect([...l.aboveByIndex.keys()], 'the index pane left slot 0').toContain(0)
    expect(l.priceIndex).toBe(2)          // 1 pinned pane + position 1 in the order
    expect(l.panes[0].index).toBe(1)
  })
})

describe('the stretch plan follows the arrangement', () => {
  it('⭐⭐ each pane is stretched at the slot it occupies', () => {
    const l = computePaneLayout([RSI, MACD], opts({
      order: ['inst:rsi:1', PRICE_PANE, VOLUME_PANE, 'inst:macd:1'],
    }))
    const plan = paneStretchPlan(l, [0, 0, 0, 0])
    const rsi = l.panes.find((p) => p.key === 'inst:rsi:1')
    const macd = l.panes.find((p) => p.key === 'inst:macd:1')
    expect(plan[rsi.index]).toBe(rsi.stretchFactor)
    expect(plan[macd.index]).toBe(macd.stretchFactor)
    expect(plan[l.priceIndex]).toBe(l.pane0.heightPx)
    // ⛔ AND NOTHING IS LEFT AT ZERO — a slot the plan forgot is a pane the
    // renderer collapses, which is the blank-chart shape in miniature.
    expect(plan.some((v) => !(v > 0)), `a slot got no height: ${plan}`).toBe(false)
  })

  it('⛔ the un-arranged plan is unchanged', () => {
    const l = computePaneLayout([RSI, MACD], opts())
    const plan = paneStretchPlan(l, [0, 0, 0, 0])
    expect(plan.some((v) => !(v > 0))).toBe(false)
    expect(plan[0]).toBe(l.pane0.heightPx)
  })
})
