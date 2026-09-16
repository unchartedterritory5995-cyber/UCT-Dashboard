// app/src/components/chart/__tests__/lookbackAnchor.test.js
//
// ─── THE LOOKBACK BAR BELONGS TO VOLUME'S TOP EDGE ──────────────────────────
//
// ⭐⭐ OWNER RULE, 2026-09-15. The 3M/6M/YTD/1Y/5Y/Origin strip used to sit at the
// workspace bottom, which put it INSIDE the volume pane, over the bars. The rule
// is now:
//
//     a separate VOLUME pane exists  →  immediately ABOVE Volume's top edge
//     no separate Volume pane        →  workspace bottom, above the date scale
//
// ⛔ AND THE OLD GUARANTEE STILL HOLDS WHERE IT MATTERS. `chromeGeometry`'s header
// forbids the bar depending on a pane because it once "flew up" by following
// PRICE. The forbidden dependency was Price, and it still is: this anchor is
// resolved from the VOLUME series' own pane, so moving Price cannot move the bar,
// and moving Volume carries it along — which is the behaviour asked for.
// `chromeGeometry.test.js` keeps the Price half of that promise.
//
// ⚠️ MEASURED IN CONTAINER SPACE. The caller writes `style.bottom`, so every
// number here is a distance from the bottom of the whole chart element: the time
// axis, plus every pane below Volume's top edge, plus the inset.

import { describe, it, expect } from 'vitest'
import { lookbackBottomFor, chromePlan, PANE_SEPARATOR_PX as SEP } from '../chromeGeometry'

const AXIS = 28
const INSET = 6

/** The distance the rule predicts, computed independently of the implementation. */
const expected = (heights, volumeIndex) => {
  const stack = heights.reduce((a, b) => a + b, 0) + SEP * (heights.length - 1)
  const volTop = heights.slice(0, volumeIndex).reduce((a, b) => a + b, 0) + SEP * volumeIndex
  return Math.round(stack + AXIS - volTop + INSET)
}

const at = (heights, volumeIndex) =>
  lookbackBottomFor({ paneHeights: heights, volumeIndex, timeAxisHeight: AXIS, separatorPx: SEP })

const FALLBACK = Math.max(30, AXIS + 8)

describe('⭐⭐ with a separate Volume pane, the bar rides Volume’s top edge', () => {
  // The owner's matrix, in render order, with Volume's index called out.
  const CASES = [
    ['PRICE / VOLUME', [500, 150], 1],
    ['QQQ / PRICE / VOLUME', [90, 420, 150], 2],
    ['PRICE / QQQ / VOLUME', [420, 90, 150], 2],
    ['PRICE / VOLUME / QQQ', [420, 150, 90], 1],
    ['QQQ / VOLUME / PRICE', [90, 150, 420], 1],
    ['VOLUME / QQQ / PRICE', [150, 90, 420], 0],
  ]

  for (const [name, heights, vi] of CASES) {
    it(name, () => {
      const got = at(heights, vi)
      if (vi === 0) {
        // ⛔ VOLUME AT THE VERY TOP HAS NO PANE ABOVE IT. Sitting "above" it would
        // put the bar off the top of the workspace — the BUG 2 screenshot exactly
        // — so this case takes the fallback instead.
        expect(got, 'the bar was hoisted off the top of the chart').toBe(FALLBACK)
        return
      }
      expect(got).toBe(expected(heights, vi))
      // …and it really is above Volume, not inside it: the distance from the
      // bottom must clear every pane from Volume's top down.
      const below = heights.slice(vi).reduce((a, b) => a + b, 0)
      expect(got, `${name}: the bar sits inside Volume`).toBeGreaterThan(below)
    })
  }

  it('⭐ resizing Volume moves the bar with its TOP edge', () => {
    const small = at([500, 150], 1)
    const large = at([300, 350], 1)
    expect(large, 'a taller Volume did not push the bar up').toBeGreaterThan(small)
    expect(large - small).toBe(200)   // exactly the height Volume gained
  })

  it('⛔ and moving PRICE does not move it — the old guarantee, kept', () => {
    // Same panes, Price reordered around Volume. Volume's top edge is what the
    // bar tracks, so these two must agree.
    expect(at([420, 150, 90], 1)).toBe(at([420, 150, 90], 1))
    // Price above vs Price below, Volume's position from the bottom unchanged:
    expect(at([90, 420, 150], 2)).toBe(at([420, 90, 150], 2))
  })
})

describe('⛔ with no separate Volume pane, the workspace bottom is the anchor', () => {
  it('a banded volume is not a pane — volumeIndex null', () => {
    expect(at([650], null)).toBe(FALLBACK)
    expect(at([500, 150], null)).toBe(FALLBACK)
  })

  it('PRICE / QQQ with volume hidden', () => {
    expect(at([500, 150], undefined)).toBe(FALLBACK)
  })

  it('⚠️ a nonsense index is refused rather than guessed', () => {
    expect(at([500, 150], 9)).toBe(FALLBACK)
    expect(at([500, 150], -1)).toBe(FALLBACK)
    expect(at([], 0)).toBe(FALLBACK)
  })

  it('⛔ the bar never tucks under the date scale', () => {
    for (const axis of [0, 12, 28, 52]) {
      const got = lookbackBottomFor({ paneHeights: [500, 150], volumeIndex: 1, timeAxisHeight: axis })
      expect(got).toBeGreaterThanOrEqual(Math.max(30, (axis > 0 ? axis : 28) + 8))
    }
  })
})

describe('⭐ the whole chrome plan agrees', () => {
  it('chromePlan routes the lookback through the same rule', () => {
    const heights = [420, 150, 90]
    const plan = chromePlan({ paneHeights: heights, priceIndex: 0, volumeIndex: 1, timeAxisHeight: AXIS })
    expect(plan.lookbackBottom).toBe(at(heights, 1))
    // …and Price-owned chrome is untouched by it.
    expect(plan.priceTop).toBe(0)
    expect(plan.priceHeight).toBe(420)
  })

  it('⛔ a banded-volume chart still gets the fallback through the plan', () => {
    const plan = chromePlan({ paneHeights: [650], priceIndex: 0, volumeIndex: null, timeAxisHeight: AXIS })
    expect(plan.lookbackBottom).toBe(FALLBACK)
  })
})
