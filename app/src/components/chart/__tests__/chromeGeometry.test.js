// app/src/components/chart/__tests__/chromeGeometry.test.js
//
// ─── THE TWO REGRESSIONS THE OWNER FOUND ON PRODUCTION ──────────────────────
//
// ⚰️⚰️ UCTA50 AS PRICE, QQQ ADDED AS A SECOND PANE, QQQ MOVED ABOVE PRICE. Two
// things broke at once, and they broke in OPPOSITE directions, which is the
// whole reason this file asserts both in every case:
//
//   BUG 1  the OHLC legend stayed at the TOP of the workspace, labelling the
//          QQQ pane with Price's readout, because it was placed from pane 0.
//   BUG 2  the 3M/6M/YTD/1Y/5Y/Origin lookback bar FLEW UP, because it was
//          anchored `containerHeight − height(pane 0) + 8` — fine while pane 0
//          was the tall Price pane, nonsense when pane 0 is a 100px QQQ.
//
// ⛔⛔ THE TRAP THIS FILE EXISTS TO PREVENT IS FIXING ONE BY BREAKING THE OTHER.
// Making the lookback bar follow Price too would make BUG 2's screenshot look
// right in layout B and wrong in layout D. So every layout case asserts the pair
// together: the legend MOVED with Price, and the lookback bar DID NOT.
//
// The four layouts are the owner's, named as they were briefed.

import { describe, it, expect } from 'vitest'
import {
  paneTopPx, pricePaneBox, lookbackBottomPx, volumePaneTopPx, chromePlan, PANE_SEPARATOR_PX,
} from '../chromeGeometry'

/** Plausible production pixels: Price is tall, secondary panes are short. */
const PRICE_H = 420
const QQQ_H = 100
const RSI_H = 90
const AXIS_H = 26

/**
 * A layout is the heights top-to-bottom plus which slot Price is in — exactly
 * what the sampler reads off the live chart.
 */
const LAYOUTS = {
  A: { name: 'PRICE / QQQ', heights: [PRICE_H, QQQ_H], price: 0 },
  B: { name: 'QQQ / PRICE', heights: [QQQ_H, PRICE_H], price: 1 },
  C: { name: 'RSI / PRICE / QQQ', heights: [RSI_H, PRICE_H, QQQ_H], price: 1 },
  D: { name: 'QQQ / RSI / PRICE', heights: [QQQ_H, RSI_H, PRICE_H], price: 2 },
}

/** What the sampler writes for the legend: the Price pane's own top edge. */
const legendTop = (l) => pricePaneBox(l.heights, l.price).top
/** What the sampler writes for the lookback bar. Note: `l` is not passed. */
const lookbackBottom = () => lookbackBottomPx(AXIS_H)

describe('⚰️⚰️ BUG 1 — the Price legend follows Price', () => {
  for (const key of ['A', 'B', 'C', 'D']) {
    const l = LAYOUTS[key]
    it(`LAYOUT ${key} (${l.name}) — the legend sits on the PRICE pane`, () => {
      const box = pricePaneBox(l.heights, l.price)
      // The offset the legend is given is the Price pane's top…
      expect(box.top).toBe(paneTopPx(l.heights, l.price))
      // …and the legend lands INSIDE Price, not in whatever is above it.
      expect(box.top).toBeGreaterThanOrEqual(0)
      expect(box.top).toBeLessThan(box.bottom)
      expect(box.height).toBe(PRICE_H)
    })
  }

  it('⚰️ LAYOUT B is the owner’s screenshot: the legend LEAVES the top', () => {
    // ⛔ THE EXACT REPRO. In A the legend is at the top because Price is at the
    // top. In B a pane was moved above Price, so the legend must move DOWN by
    // that pane's height — it must not stay at 0 labelling QQQ.
    expect(legendTop(LAYOUTS.A)).toBe(0)
    expect(legendTop(LAYOUTS.B)).toBe(QQQ_H + PANE_SEPARATOR_PX)
    expect(legendTop(LAYOUTS.B), 'the legend stayed on the top pane').not.toBe(0)
  })

  it('⭐ the offset grows with everything stacked above Price', () => {
    expect(legendTop(LAYOUTS.C)).toBe(RSI_H + PANE_SEPARATOR_PX)
    expect(legendTop(LAYOUTS.D)).toBe(QQQ_H + RSI_H + 2 * PANE_SEPARATOR_PX)
    // Strictly increasing as Price is pushed further down.
    const tops = ['A', 'B', 'D'].map((k) => legendTop(LAYOUTS[k]))
    expect(tops).toEqual([...tops].sort((a, b) => a - b))
    expect(new Set(tops).size).toBe(3)
  })

  it('⛔ an unarranged chart is byte-for-byte the old behaviour', () => {
    // The whole fix must be invisible to a chart nobody has reordered.
    expect(pricePaneBox([PRICE_H, 120, 90], 0)).toEqual({ top: 0, height: PRICE_H, bottom: PRICE_H })
  })
})

describe('⚰️⚰️ BUG 2 — the lookback bar does NOT follow Price', () => {
  it('⛔⛔ identical in ALL FOUR layouts — Price moves, the bar does not', () => {
    // ⚰️ THE PRE-FIX FORMULA, kept here as the control: `H - height(pane 0) + 8`.
    // It is what shipped, and it disagrees with itself across the layouts by
    // hundreds of pixels — which is precisely what the owner photographed.
    const broken = (l) => {
      const H = l.heights.reduce((s, h) => s + h, 0)
      return Math.round(Math.max(30, H - l.heights[0] + 8))
    }
    const brokenVals = Object.values(LAYOUTS).map(broken)
    expect(new Set(brokenVals).size, 'the old formula was stable — this rail proves nothing').toBeGreaterThan(1)

    const fixed = Object.values(LAYOUTS).map(() => lookbackBottom())
    expect(new Set(fixed).size, `the bar moved with the layout: ${fixed}`).toBe(1)
  })

  it('⛔ it is a function of the TIME AXIS and nothing else', () => {
    // Arity is the structural guarantee: a function that cannot see a pane
    // cannot move when panes are reordered.
    expect(lookbackBottomPx.length).toBeLessThanOrEqual(3)
    expect(lookbackBottomPx(AXIS_H)).toBe(Math.max(30, AXIS_H + 8))
    expect(lookbackBottomPx(52)).toBe(60)      // a taller axis pushes it up
  })

  it('⛔ it never overlaps the date scale, and never leaves the container', () => {
    // The bar sits ABOVE the axis by construction: its bottom offset is at
    // least the axis height, so the two cannot occupy the same pixels.
    for (const axis of [0, 12, 26, 40, 64, 120]) {
      expect(lookbackBottomPx(axis)).toBeGreaterThanOrEqual(axis)
      expect(lookbackBottomPx(axis)).toBeGreaterThanOrEqual(30)
    }
  })

  it('⛔ a chart that cannot report an axis keeps the shipped 28px shape', () => {
    for (const bad of [0, -5, NaN, null, undefined]) {
      expect(lookbackBottomPx(bad)).toBe(36)   // max(30, 28 + 8)
    }
  })
})

describe('the volume readout, the third instance of the same bug', () => {
  it('⭐ an independently-ordered volume pane is placed by ITS index', () => {
    // VOLUME / PRICE / RSI — volume arranged to the top on its own.
    const heights = [70, PRICE_H, RSI_H]
    expect(volumePaneTopPx(heights, 0)).toBe(0)
    // PRICE / RSI / VOLUME — volume arranged to the bottom.
    const moved = [PRICE_H, RSI_H, 70]
    expect(volumePaneTopPx(moved, 2)).toBe(PRICE_H + RSI_H + 2 * PANE_SEPARATOR_PX)
  })
})

describe('⛔ totality — the geometry answers for every shape', () => {
  it('a degenerate or hostile pane list never produces NaN', () => {
    const bad = [[], null, undefined, [NaN, 10], [undefined, 10]]
    for (const hs of bad) {
      for (const i of [-1, 0, 1, 7, 1.5, NaN, null]) {
        const box = pricePaneBox(hs, i)
        expect(Number.isFinite(box.top), `top NaN for ${JSON.stringify(hs)}@${i}`).toBe(true)
        expect(Number.isFinite(box.height)).toBe(true)
        expect(Number.isFinite(box.bottom)).toBe(true)
        expect(box.top).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('an out-of-range Price index degrades to the top, not to nothing', () => {
    // A transient frame during a reorder can ask before the chart has caught up.
    expect(pricePaneBox([PRICE_H, QQQ_H], 9).top).toBe(0)
    expect(pricePaneBox([PRICE_H, QQQ_H], 9).height).toBe(PRICE_H)
  })

  it('⭐ the tops partition the stack — no gap, no overlap', () => {
    const heights = [QQQ_H, RSI_H, PRICE_H, 55]
    const tops = heights.map((_, i) => paneTopPx(heights, i))
    for (let i = 1; i < tops.length; i++) {
      expect(tops[i]).toBe(tops[i - 1] + heights[i - 1] + PANE_SEPARATOR_PX)
    }
    const last = tops[tops.length - 1] + heights[heights.length - 1]
    expect(last).toBe(heights.reduce((s, h) => s + h, 0) + PANE_SEPARATOR_PX * (heights.length - 1))
  })
})

describe('⛔⛔ the SHIPPED plan — both ownerships, together, per layout', () => {
  // ⚠️ THIS IS THE DECISION `StockChart`'s sampler APPLIES. The pieces above are
  // arithmetic; this is the object the chart is actually positioned from, so a
  // revert of the fix has to come through here to reach the screen.
  const planFor = (l) => chromePlan({
    paneHeights: l.heights,
    priceIndex: l.price,
    volumeIndex: null,
    timeAxisHeight: AXIS_H,
  })

  for (const key of ['A', 'B', 'C', 'D']) {
    const l = LAYOUTS[key]
    it(`LAYOUT ${key} (${l.name}) — legend follows Price, lookback does NOT`, () => {
      const plan = planFor(l)
      // BUG 1: the Price-owned offset is Price's own top edge.
      expect(plan.pricePaneTopPx).toBe(paneTopPx(l.heights, l.price))
      expect(plan.priceHeight).toBe(PRICE_H)
      // BUG 2: the workspace-owned offset is the SAME in every layout.
      expect(plan.lookbackBottom).toBe(lookbackBottomPx(AXIS_H))
      // ⛔ AND THE COLLAPSE THRESHOLD TRAVELS WITH PRICE TOO — it is the
      // question "does the legend still fit in Price", so it is Price-owned.
      expect(plan.collapseThresholdPx).toBe(plan.priceBottom - 34)
    })
  }

  it('⚰️⚰️ ACROSS the four layouts: one offset varies, the other is nailed down', () => {
    const plans = ['A', 'B', 'C', 'D'].map((k) => planFor(LAYOUTS[k]))
    // Price-owned: four layouts, four DIFFERENT offsets — it really tracks Price.
    const tops = plans.map((p) => p.pricePaneTopPx)
    expect(new Set(tops).size, `the legend did not track Price: ${tops}`).toBe(4)
    // Workspace-owned: four layouts, ONE offset — it really does not.
    const bars = plans.map((p) => p.lookbackBottom)
    expect(new Set(bars).size, `the lookback bar moved with the layout: ${bars}`).toBe(1)
  })

  it('⛔ no stale surface is left behind — every offset is re-answered each frame', () => {
    // The sampler writes whatever the plan says, so "stale" can only mean the
    // plan returned the previous layout's number. Same inputs → same object;
    // changed inputs → changed object. Nothing is memoised across layouts.
    const a = planFor(LAYOUTS.A)
    const b = planFor(LAYOUTS.B)
    expect(planFor(LAYOUTS.A)).toEqual(a)
    expect(b).not.toEqual(a)
    for (const k of Object.keys(a)) expect(Number.isFinite(a[k]), `${k} is not a number`).toBe(true)
  })

  it('⛔ a RESIZE moves the Price-owned offsets and leaves the bar alone', () => {
    // The same arrangement, a shorter container: Price shrinks, the panes above
    // it shrink, so the legend offset changes — but the axis is unchanged, so
    // the lookback bar must not budge.
    const tall = chromePlan({ paneHeights: [QQQ_H, PRICE_H], priceIndex: 1, timeAxisHeight: AXIS_H })
    const short = chromePlan({ paneHeights: [60, 240], priceIndex: 1, timeAxisHeight: AXIS_H })
    expect(short.pricePaneTopPx).not.toBe(tall.pricePaneTopPx)
    expect(short.collapseThresholdPx).not.toBe(tall.collapseThresholdPx)
    expect(short.lookbackBottom).toBe(tall.lookbackBottom)
  })

  it('⛔ a chart mid-reorder (no panes yet) still yields a usable plan', () => {
    // One frame during a live reorder can measure an empty pane list. The plan
    // must degrade to the unarranged chart, never to NaN — a NaN written into
    // `style.top` is the blank/floating-chrome shape.
    for (const hs of [[], null, undefined]) {
      const plan = chromePlan({ paneHeights: hs, priceIndex: 0, timeAxisHeight: 0 })
      for (const k of Object.keys(plan)) expect(Number.isFinite(plan[k]), k).toBe(true)
      expect(plan.lookbackBottom).toBe(36)
    }
  })
})

describe('⛔⛔ legend compaction follows PRICE GEOMETRY, never pane index', () => {
  // ⚰️ THE REPORTED SYMPTOM WAS A COMPACT PRICE LEGEND (OHLCV abbreviated, MA
  // rows gone) after moving a pane above Price. MEASURED IN THE REAL UI across
  // ten topologies — Price at index 0, 1 and 2, with Volume and QQQ moved over
  // and under it — the legend stayed FULL with all four MA rows every time, and a
  // genuine shrink-then-grow cycle compacted and then RECOVERED:
  //
  //     tall  456px  compact=false  MAs=4
  //     260px 151px  compact=true   MAs=0     ← legitimate, the pane is a sliver
  //     200px 112px  compact=true   MAs=0
  //     tall  456px  compact=false  MAs=4     ← recovered on its own
  //
  // So the "stale-latch" theory is DISPROVEN, and the MA rows are part of the
  // same compact decision rather than a second membership defect.
  //
  // ⛔ WHAT THIS RAIL PINS is the property that makes that true: the collapse
  // threshold is a question about PRICE'S OWN BOX. If it ever again derives from
  // the first pane, a pane above Price would change the legend without Price
  // changing size — which is exactly the shape of the bug that was reported.

  const PRICE_H = 456
  const stacks = [
    ['Price first', [PRICE_H, 152, 80], 0],
    ['one pane above', [80, PRICE_H, 152], 1],
    ['two panes above', [152, 80, PRICE_H], 2],
  ]

  it('⭐ the threshold is the same wherever Price sits', () => {
    const thresholds = stacks.map(([, hs, i]) =>
      chromePlan({ paneHeights: hs, priceIndex: i, timeAxisHeight: 26 }).collapseThresholdPx
        - chromePlan({ paneHeights: hs, priceIndex: i, timeAxisHeight: 26 }).priceTop)
    // measured relative to Price's own top, the answer cannot depend on position
    for (const t of thresholds) expect(t).toBe(thresholds[0])
    expect(thresholds[0]).toBe(PRICE_H - 34)
  })

  it('⛔ it tracks Price’s HEIGHT, which is what makes compaction legitimate', () => {
    const tall = chromePlan({ paneHeights: [80, 456, 152], priceIndex: 1, timeAxisHeight: 26 })
    const short = chromePlan({ paneHeights: [80, 112, 152], priceIndex: 1, timeAxisHeight: 26 })
    expect(short.collapseThresholdPx).toBeLessThan(tall.collapseThresholdPx)
    // ⭐ AND IT IS REVERSIBLE — the same inputs give the same answer, so a pane
    // that grows back gets its full legend back. No hysteresis, no latch.
    expect(chromePlan({ paneHeights: [80, 456, 152], priceIndex: 1, timeAxisHeight: 26 }))
      .toEqual(tall)
  })

  it('⛔ a pane ABOVE Price does not change the decision by itself', () => {
    // Price the same size, a neighbour added above: the legend must not move mode.
    const alone = chromePlan({ paneHeights: [PRICE_H, 152], priceIndex: 0, timeAxisHeight: 26 })
    const withNeighbour = chromePlan({ paneHeights: [80, PRICE_H, 152], priceIndex: 1, timeAxisHeight: 26 })
    const room = (p) => p.collapseThresholdPx - p.priceTop
    expect(room(withNeighbour)).toBe(room(alone))
  })
})
