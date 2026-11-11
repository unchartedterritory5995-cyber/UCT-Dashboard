// app/src/components/chart/engine/__tests__/paneMinPx.test.js
//
// ─── RS SPLIT U3 · A PANE MAY DECLARE HOW SHORT IS TOO SHORT ────────────────
//
// ⚰️⚰️ THE 25 px RS PANE, REPRODUCED. On the owner's saved layout the UCT
// Relative Strength pane rendered about 25 px tall — a flat line under its own
// legend — while the definition asks for 0.20 of the candle pane. The owner's
// blob cannot be read from here, so the mechanism is proved from a PLAUSIBLE
// stored `paneSizes` instead, two ways, and both land on the same sliver:
//
//   1. a stored RS share at the 4 % floor (`MIN_SHARE`, the smallest a drag can
//      store) — on a 625 px stack that is 25 px, where the default is ~96 px;
//   2. pinned Price and Volume shares that sum to just UNDER 0.96, so
//      `stalePartition` never fires and the unpinned RS pane gets `1 − Σpinned`.
//
// Neither is a code default. The member's drag won, as the sizing contract says
// it must, and nothing said what the pane needed to stay readable. Now the
// definition says it (`placement.pane.minPx: 64`), the stretch plan enforces it
// AFTER the member's sizes, and the pixels come from the tallest pane.
//
// ⛔ THE TOTALITY RAILS STAY GREEN. Every plan below sums to the same stack as
// the plan without mins, and no pane is ever taken below the 4 % floor or its
// own min — those are the same two invariants `paneSizes.test.js` pins for the
// drag itself.
import { describe, it, expect } from 'vitest'
import { computePaneLayout, paneStretchPlan, paneMinPxFor } from '../paneLayout'
import { applyPaneMins, MIN_SHARE } from '../paneSizes'
import { PRICE_PANE, VOLUME_PANE } from '../paneOrder'
import { getDefinition } from '../nativeRegistry'

const inst = (defId, id) => ({ defId, instanceId: id, inputs: {} })
const RS = 'inst:rsLine:1'
const RSI = 'inst:rsi:1'
const QQQ = 'inst:dataSeries:1'

/** The owner's chart shape: candles, a separate volume pane, UCT RS below. */
const ownerLayout = (extra) => computePaneLayout(
  [inst('rsLine', RS)],
  {
    chartHeight: 625, separatorPx: 1, hasVolumeBand: false,
    firstPaneIndex: 2, abovePct: [78, 22], mainPaneIndex: 0,
    order: [PRICE_PANE, VOLUME_PANE, RS],
    ...extra,
  },
)
const slotOf = (l, key) => [...l.keyByIndex].find(([, k]) => k === key)[0]
const sum = (plan) => plan.reduce((s, v) => s + v, 0)
const zeros = (l) => new Array(l.paneCountRequired).fill(0)
/** The plan as it was BEFORE U3: the member's sizes applied, no minimum. */
const planWithoutMins = (l) => paneStretchPlan({ ...l, minPxByIndex: null }, zeros(l))

describe('the definition declares it', () => {
  it('⭐ UCT RS Line asks for 64 px; a definition that says nothing has no floor', () => {
    expect(getDefinition('rsLine').placement.pane.minPx).toBe(64)
    expect(paneMinPxFor('rsLine')).toBe(64)
    expect(paneMinPxFor('rsi')).toBeNull()
    expect(paneMinPxFor('no-such-definition')).toBeNull()
  })

  it('the layout carries it by SLOT, so the plan needs no registry of its own', () => {
    const l = ownerLayout()
    expect(l.minPxByIndex.get(slotOf(l, RS))).toBe(64)
    expect(l.minPxByIndex.size).toBe(1)
  })
})

describe('⚰️⚰️ (a) the 25 px pane — red before, green after', () => {
  it('a stored share at the 4 % floor starves the RS pane to ~25 px; the min lifts it to 64', () => {
    const l = ownerLayout({ paneSizes: { [RS]: MIN_SHARE } })
    const rs = slotOf(l, RS)
    const before = planWithoutMins(l)
    const dflt = planWithoutMins(ownerLayout())
    // The CONTROL: what the chart drew before U3. The definition's 0.20 of the
    // candle pane is ~96 px here; the stored floor share cut it to a quarter.
    expect(dflt[rs]).toBeGreaterThan(90)
    expect(before[rs]).toBeGreaterThan(20)
    expect(before[rs]).toBeLessThan(30)
    // The FIX.
    const after = paneStretchPlan(l, zeros(l))
    expect(after[rs]).toBeGreaterThanOrEqual(64)
    expect(sum(after)).toBeCloseTo(sum(before), 6)
  })

  it('pinned Price + Volume just under the stale-partition trigger leave RS a sliver; the min lifts it', () => {
    // 0.71 + 0.245 = 0.955 < 0.96, so `applyPaneSizes` reserves only MIN_SHARE
    // for the one unpinned pane. Both entries are shapes `sizesFromStretch` stores.
    const l = ownerLayout({ paneSizes: { [PRICE_PANE]: 0.71, [VOLUME_PANE]: 0.245 } })
    const rs = slotOf(l, RS)
    const before = planWithoutMins(l)
    expect(before[rs] / sum(before)).toBeLessThan(0.05)
    expect(before[rs]).toBeLessThan(32)
    const after = paneStretchPlan(l, zeros(l))
    expect(after[rs]).toBeGreaterThanOrEqual(64)
    expect(sum(after)).toBeCloseTo(sum(before), 6)
  })

  it('⛔ a pane already above its min is untouched — the member’s drag still wins', () => {
    const l = ownerLayout({ paneSizes: { [RS]: 0.30 } })
    expect(paneStretchPlan(l, zeros(l))).toEqual(planWithoutMins(l))
  })

  it('⛔ a chart whose definitions declare no min is byte-for-byte the old plan', () => {
    const l = computePaneLayout([inst('rsi', RSI), inst('dataSeries', QQQ)], {
      chartHeight: 625, separatorPx: 1, hasVolumeBand: false,
      firstPaneIndex: 2, abovePct: [78, 22], mainPaneIndex: 0,
      order: [QQQ, PRICE_PANE, VOLUME_PANE, RSI], paneSizes: { [RSI]: MIN_SHARE },
    })
    expect(l.minPxByIndex.size).toBe(0)
    expect(paneStretchPlan(l, zeros(l))).toEqual(planWithoutMins(l))
  })
})

describe('⭐ (b) the pixels come from the TALLEST pane', () => {
  it('Price, the tallest, pays; Volume keeps its height exactly', () => {
    const l = ownerLayout({ paneSizes: { [RS]: MIN_SHARE } })
    const before = planWithoutMins(l)
    const after = paneStretchPlan(l, zeros(l))
    const p = slotOf(l, PRICE_PANE), v = slotOf(l, VOLUME_PANE), rs = slotOf(l, RS)
    expect(before[p]).toBeGreaterThan(before[v])
    expect(after[v]).toBeCloseTo(before[v], 9)
    expect(before[p] - after[p]).toBeCloseTo(after[rs] - before[rs], 9)
  })

  it('in isolation: tallest first, then the next tallest once the first hits its floor', () => {
    // total 1000 → floor 40. Slot 2 needs 300 more; slot 0 can give 360, so it pays alone.
    expect(applyPaneMins([400, 300, 100, 200], new Map([[2, 400]]))).toEqual([100, 300, 400, 200])
    // Slot 2 needs 500 more; slot 0 gives 360 (down to 40), then slot 1 gives 140.
    const out = applyPaneMins([400, 300, 100, 200], new Map([[2, 600]]))
    expect(out[2]).toBe(600)
    expect(out[0]).toBeCloseTo(40, 9)
    expect(out[1]).toBeCloseTo(160, 9)
    expect(out[3]).toBe(200)
    expect(sum(out)).toBeCloseTo(1000, 9)
  })

  it('⛔ a slot outside the donor set keeps what it has — a pane below the stack is not ours', () => {
    const out = applyPaneMins([400, 300, 100], new Map([[2, 150]]), [0, 2])
    expect(out).toEqual([350, 300, 150])
  })

  it('is the identity when nothing is declared or nothing is short', () => {
    const plan = [400, 300, 100]
    expect(applyPaneMins(plan, new Map(), null)).toEqual(plan)
    expect(applyPaneMins(plan, null)).toEqual(plan)
    expect(applyPaneMins(plan, new Map([[2, 50]]))).toEqual(plan)
    expect(applyPaneMins([], new Map([[0, 50]]))).toEqual([])
  })
})

describe('⛔ (c) two mins that cannot both fit — the stack still sums, nothing goes under the floor', () => {
  it('each grows as far as the stack allows; no donor is taken below 4 % or its own min', () => {
    // total 200 → floor 8. Two panes want 150 each: impossible. The only donor
    // is slot 0, which can give 160 − 8 = 152 in all.
    const out = applyPaneMins([160, 20, 20], new Map([[1, 150], [2, 150]]))
    expect(sum(out)).toBeCloseTo(200, 9)
    expect(out[0]).toBeCloseTo(8, 9)                       // the floor, exactly, never under
    expect(out[1]).toBe(150)                               // the first short pane (lowest slot) was filled
    expect(out[2]).toBeCloseTo(42, 9)                      // the second got what was left
    for (const v of out) expect(v).toBeGreaterThanOrEqual(8 - 1e-9)
  })

  it('⛔ a short pane is never a donor to another short pane', () => {
    // Slot 1 is under its min (needs 100, has 60); slot 2 needs 100 too. Slot 1
    // must not be drained to fill slot 2 — it is below its own bound.
    const out = applyPaneMins([100, 60, 40], new Map([[1, 100], [2, 100]]))
    expect(out[1]).toBeGreaterThanOrEqual(60)
    expect(out[2]).toBeGreaterThanOrEqual(40)
    expect(sum(out)).toBeCloseTo(200, 9)
    expect(out[0]).toBeGreaterThanOrEqual(MIN_SHARE * 200 - 1e-9)
  })

  it('on a real layout: two RS panes on a short cell, both pinned at the floor', () => {
    const RS2 = 'inst:rsLine:2'
    const l = computePaneLayout([inst('rsLine', RS), inst('rsLine', RS2)], {
      chartHeight: 180, separatorPx: 1, hasVolumeBand: false,
      firstPaneIndex: 2, abovePct: [78, 22], mainPaneIndex: 0,
      order: [PRICE_PANE, VOLUME_PANE, RS, RS2],
      paneSizes: { [RS]: MIN_SHARE, [RS2]: MIN_SHARE },
    })
    const before = planWithoutMins(l)
    const after = paneStretchPlan(l, zeros(l))
    const total = sum(before)
    expect(sum(after)).toBeCloseTo(total, 6)
    for (const v of after) expect(v).toBeGreaterThanOrEqual(MIN_SHARE * total - 1e-9)
    // 64 + 64 + two floors > 180: they cannot both fit, and neither is starved
    // further than it was.
    expect(after[slotOf(l, RS)]).toBeGreaterThanOrEqual(before[slotOf(l, RS)])
    expect(after[slotOf(l, RS2)]).toBeGreaterThanOrEqual(before[slotOf(l, RS2)])
  })
})

describe('⛔ the totality rail, extended: every stack height, with and without stored sizes', () => {
  it('the plan sums to the stack and no pane is under the floor, for every height in the declared range', () => {
    const cases = [
      undefined,
      { [RS]: MIN_SHARE },
      { [PRICE_PANE]: 0.71, [VOLUME_PANE]: 0.245 },
      { [PRICE_PANE]: 0.60, [RS]: 0.30 },
    ]
    for (let h = 120; h <= 1600; h += 7) {
      for (const paneSizes of cases) {
        const l = ownerLayout({ chartHeight: h, paneSizes })
        const before = planWithoutMins(l)
        const after = paneStretchPlan(l, zeros(l))
        const total = sum(before)
        expect(sum(after), `h=${h} sizes=${JSON.stringify(paneSizes)}`).toBeCloseTo(total, 6)
        for (const v of after) {
          expect(v, `h=${h} sizes=${JSON.stringify(paneSizes)} plan=${after}`)
            .toBeGreaterThanOrEqual(Math.min(MIN_SHARE * total, Math.min(...before)) - 1e-9)
        }
        // and the min holds wherever the stack can afford it
        const rs = slotOf(l, RS)
        if (total - 2 * MIN_SHARE * total >= 64) expect(after[rs]).toBeGreaterThanOrEqual(64 - 1e-9)
      }
    }
  })
})
