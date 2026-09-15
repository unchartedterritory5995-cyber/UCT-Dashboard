// app/src/components/chart/engine/__tests__/paneSizes.test.js
//
// ─── A DRAGGED SEPARATOR STAYS WHERE THE MEMBER PUT IT ──────────────────────
//
// ⚰️⚰️ THE BUG, MEASURED. Drag QQQ's separator down; the pane grows while the
// mouse is held; release and it snaps back. `paneStretchPlan` seeded from the
// renderer's current weights and then overwrote every pane the layout covered:
//
//     current (post-drag):      [270, 330, 100]     ← member dragged QQQ to 270
//     plan (what gets applied): [ 81, 463, 154]     ← 270 → 81
//
// `binder.js` applies that on the next sync, so the drag survived only until the
// next repaint. Pane height had NO authority: the flow was one-way, and the
// gesture lived inside lightweight-charts until something recomputed over it.
//
// ⭐ SIZE IS NOT ORDER. `paneOrder` is a list of keys; `paneSizes` is a map from
// key to share. These rails pin that they stay independent — a resize may not
// reorder, and a reorder may not resize.

import { describe, it, expect } from 'vitest'
import { computePaneLayout, paneStretchPlan } from '../paneLayout'
import {
  applyPaneSizes, sizesFromStretch, storedPaneSizes, setPaneSize, setPaneSizes,
  clearPaneSize, prunePaneSizes, hasPaneSizes,
} from '../paneSizes'
import { PRICE_PANE, VOLUME_PANE } from '../paneOrder'

const inst = (defId, id) => ({ defId, instanceId: id, inputs: {} })
const QQQ = 'inst:dataSeries:1'
const RSI = 'inst:rsi:1'

/** The owner's chart: QQQ own pane above Price, separate volume below. */
const layoutFor = (extra) => computePaneLayout(
  [inst('dataSeries', QQQ), inst('rsi', RSI)],
  {
    chartHeight: 700, separatorPx: 1, hasVolumeBand: false,
    firstPaneIndex: 2, abovePct: [78, 22], mainPaneIndex: 0,
    order: [QQQ, PRICE_PANE, VOLUME_PANE, RSI],
    ...extra,
  },
)

const shares = (plan) => {
  const t = plan.reduce((s, v) => s + v, 0)
  return plan.map((v) => +(v / t).toFixed(4))
}

describe('⚰️⚰️ the snap-back', () => {
  it('⛔⛔ THE REGRESSION: with no stored size the plan discards the drag', () => {
    // The pre-fix behaviour, kept as the control so the fix below is not proving
    // something that was never broken.
    const l = layoutFor()
    const afterDrag = [270, 330, 100, 0]
    const plan = paneStretchPlan(l, afterDrag)
    const qqqSlot = l.keyByIndex ? [...l.keyByIndex].find(([, k]) => k === QQQ)?.[0] : 0
    expect(plan[qqqSlot], 'the default plan no longer overwrites — is the bug gone?')
      .not.toBe(270)
  })

  it('⭐⭐ THE FIX: a stored share survives the plan', () => {
    const l = layoutFor({ paneSizes: { [QQQ]: 0.35 } })
    const plan = paneStretchPlan(l, [270, 330, 100, 0])
    const qqqSlot = [...l.keyByIndex].find(([, k]) => k === QQQ)[0]
    expect(shares(plan)[qqqSlot]).toBeCloseTo(0.35, 3)
  })

  it('⛔ and the total is preserved — a plan that does not add up is a blank chart', () => {
    const l = layoutFor({ paneSizes: { [QQQ]: 0.35 } })
    const before = paneStretchPlan(layoutFor(), [0, 0, 0, 0])
    const after = paneStretchPlan(l, [0, 0, 0, 0])
    expect(after.reduce((s, v) => s + v, 0)).toBeCloseTo(before.reduce((s, v) => s + v, 0), 6)
    expect(after.some((v) => !(v > 0)), `a slot got no height: ${after}`).toBe(false)
  })
})

describe('⛔ a chart with no stored sizes is byte-for-byte the old layout', () => {
  it('the plan is identical', () => {
    const a = paneStretchPlan(layoutFor(), [0, 0, 0, 0])
    const b = paneStretchPlan(layoutFor({ paneSizes: {} }), [0, 0, 0, 0])
    expect(b).toEqual(a)
    expect(hasPaneSizes({})).toBe(false)
  })

  it('⛔ and an unknown key changes nothing', () => {
    const a = paneStretchPlan(layoutFor(), [0, 0, 0, 0])
    const b = paneStretchPlan(layoutFor({ paneSizes: { 'inst:gone:9': 0.4 } }), [0, 0, 0, 0])
    expect(b).toEqual(a)
  })
})

describe('⭐ several resized panes coexist', () => {
  it('pinning QQQ leaves RSI alone, and vice versa', () => {
    const l = layoutFor({ paneSizes: { [QQQ]: 0.30, [RSI]: 0.20 } })
    const plan = paneStretchPlan(l, [0, 0, 0, 0])
    const map = new Map([...l.keyByIndex].map(([i, k]) => [k, i]))
    const sh = shares(plan)
    expect(sh[map.get(QQQ)]).toBeCloseTo(0.30, 3)
    expect(sh[map.get(RSI)]).toBeCloseTo(0.20, 3)
  })

  it('⛔ changing one does NOT reset the other', () => {
    const map = (l) => new Map([...l.keyByIndex].map(([i, k]) => [k, i]))
    const first = layoutFor({ paneSizes: { [QQQ]: 0.30, [RSI]: 0.20 } })
    const second = layoutFor({ paneSizes: { [QQQ]: 0.45, [RSI]: 0.20 } })
    expect(shares(paneStretchPlan(second, [0, 0, 0, 0]))[map(second).get(RSI)])
      .toBeCloseTo(shares(paneStretchPlan(first, [0, 0, 0, 0]))[map(first).get(RSI)], 3)
  })

  it('⛔ the untouched panes absorb the remainder, in proportion', () => {
    // A separator drag is a statement about two panes, not the whole stack.
    const plain = paneStretchPlan(layoutFor(), [0, 0, 0, 0])
    const l = layoutFor({ paneSizes: { [QQQ]: 0.30 } })
    const plan = paneStretchPlan(l, [0, 0, 0, 0])
    const map = new Map([...l.keyByIndex].map(([i, k]) => [k, i]))
    const p = map.get(PRICE_PANE), v = map.get(VOLUME_PANE)
    expect(plan[p] / plan[v]).toBeCloseTo(plain[p] / plain[v], 3)
  })
})

describe('⭐⭐ the size follows the PANE, not the slot', () => {
  it('reordering carries a resized pane’s height with it', () => {
    // ⛔ THE TRACK A REQUIREMENT. A size attached to "whatever is at index 0"
    // would jump to another pane the moment the member rearranged.
    const above = layoutFor({ paneSizes: { [QQQ]: 0.30 } })
    const below = computePaneLayout(
      [inst('dataSeries', QQQ), inst('rsi', RSI)],
      {
        chartHeight: 700, separatorPx: 1, hasVolumeBand: false,
        firstPaneIndex: 2, abovePct: [78, 22], mainPaneIndex: 0,
        order: [PRICE_PANE, VOLUME_PANE, RSI, QQQ],   // QQQ moved to the bottom
        paneSizes: { [QQQ]: 0.30 },
      },
    )
    const shareOf = (l, key) => {
      const slot = [...l.keyByIndex].find(([, k]) => k === key)[0]
      return shares(paneStretchPlan(l, [0, 0, 0, 0]))[slot]
    }
    expect(shareOf(below, QQQ)).toBeCloseTo(shareOf(above, QQQ), 3)
    expect(shareOf(below, QQQ)).toBeCloseTo(0.30, 3)
  })
})

describe('⛔ widget resize keeps the member’s proportion', () => {
  it('a share is scale-free — 30% of a tall chart is 30% of a short one', () => {
    const tall = computePaneLayout([inst('dataSeries', QQQ)], {
      chartHeight: 900, separatorPx: 1, hasVolumeBand: false,
      firstPaneIndex: 2, abovePct: [78, 22], mainPaneIndex: 0,
      order: [QQQ, PRICE_PANE, VOLUME_PANE], paneSizes: { [QQQ]: 0.30 },
    })
    const short = computePaneLayout([inst('dataSeries', QQQ)], {
      chartHeight: 450, separatorPx: 1, hasVolumeBand: false,
      firstPaneIndex: 2, abovePct: [78, 22], mainPaneIndex: 0,
      order: [QQQ, PRICE_PANE, VOLUME_PANE], paneSizes: { [QQQ]: 0.30 },
    })
    const sh = (l) => shares(paneStretchPlan(l, [0, 0, 0]))[[...l.keyByIndex].find(([, k]) => k === QQQ)[0]]
    expect(sh(short)).toBeCloseTo(sh(tall), 3)
    // ⚰️ A STORED PIXEL COUNT WOULD NOT DO THIS: 273px is a third of one chart
    // and two-thirds of the other.
  })
})

describe('⛔ nothing may starve', () => {
  it('shares that would eat the stack are scaled together, keeping their ratio', () => {
    const l = layoutFor({ paneSizes: { [QQQ]: 0.60, [RSI]: 0.50 } })
    const plan = paneStretchPlan(l, [0, 0, 0, 0])
    expect(plan.some((v) => !(v > 0))).toBe(false)
    const map = new Map([...l.keyByIndex].map(([i, k]) => [k, i]))
    const sh = shares(plan)
    // relative intent preserved (0.60 : 0.50)
    expect(sh[map.get(QQQ)] / sh[map.get(RSI)]).toBeCloseTo(0.60 / 0.50, 2)
    expect(sh[map.get(QQQ)] + sh[map.get(RSI)]).toBeLessThan(1)
  })

  it('⛔ an unreadable share is REFUSED, not clamped and stored', () => {
    expect(storedPaneSizes(setPaneSize({}, QQQ, 0.98))).toEqual({})
    expect(storedPaneSizes(setPaneSize({}, QQQ, 0.001))).toEqual({})
    expect(storedPaneSizes(setPaneSize({}, QQQ, 0.35))).toEqual({ [QQQ]: 0.35 })
  })
})

describe('the writers', () => {
  it('⭐ set, clear one, clear all', () => {
    let cs = setPaneSizes({}, { [QQQ]: 0.3, [RSI]: 0.2 })
    expect(storedPaneSizes(cs)).toEqual({ [QQQ]: 0.3, [RSI]: 0.2 })
    cs = clearPaneSize(cs, QQQ)
    expect(storedPaneSizes(cs)).toEqual({ [RSI]: 0.2 })
    cs = clearPaneSize(cs, null)
    expect(storedPaneSizes(cs)).toEqual({})
  })

  it('⛔ a no-op write returns the SAME object — it must not churn settings', () => {
    const cs = setPaneSizes({}, { [QQQ]: 0.3 })
    expect(setPaneSizes(cs, { [QQQ]: 0.3 })).toBe(cs)
    expect(clearPaneSize(cs, 'inst:nope:1')).toBe(cs)
  })

  it('⭐ removing a pane prunes its size; HIDING one does not', () => {
    const cs = setPaneSizes({}, { [QQQ]: 0.3, [RSI]: 0.2 })
    const pruned = prunePaneSizes(cs, new Set([QQQ]))
    expect(storedPaneSizes(pruned)).toEqual({ [QQQ]: 0.3 })
    // …and pruning against the full set is a no-op, so a hidden pane survives
    expect(prunePaneSizes(cs, new Set([QQQ, RSI]))).toBe(cs)
  })
})

describe('⭐ the capture side records INTENT, not rounding', () => {
  const keyByIndex = new Map([[0, QQQ], [1, PRICE_PANE], [2, VOLUME_PANE]])

  it('a dragged pane is recorded; the untouched ones are not', () => {
    const computed = [100, 500, 100]
    const observed = [270, 330, 100]      // the member dragged QQQ taller
    const out = sizesFromStretch(observed, computed, keyByIndex)
    expect(Object.keys(out).sort()).toEqual([PRICE_PANE, QQQ].sort())
    expect(out[QQQ]).toBeCloseTo(270 / 700, 3)
  })

  it('⛔ a repaint that only rounds records NOTHING', () => {
    // Without this every frame would write a preference.
    const computed = [100, 500, 100]
    const observed = [100.4, 499.6, 100]
    expect(sizesFromStretch(observed, computed, keyByIndex)).toEqual({})
  })

  it('⛔ a degenerate read records nothing rather than something wrong', () => {
    expect(sizesFromStretch([], [100, 500, 100], keyByIndex)).toEqual({})
    expect(sizesFromStretch([0, 0, 0], [100, 500, 100], keyByIndex)).toEqual({})
    expect(sizesFromStretch([270, 330, 100], [], keyByIndex)).toEqual({})
  })
})

describe('⛔ applyPaneSizes in isolation', () => {
  it('is the identity when nothing is stored', () => {
    const plan = [100, 500, 100]
    expect(applyPaneSizes(plan, new Map([[0, QQQ]]), {})).toEqual(plan)
    expect(applyPaneSizes(plan, new Map([[0, QQQ]]), null)).toEqual(plan)
  })
})
