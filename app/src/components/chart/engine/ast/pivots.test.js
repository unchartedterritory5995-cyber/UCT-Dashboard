// ⭐⭐ PIVOTS ARE ALREADY EXPRESSIBLE. NO ENGINE PRIMITIVE WAS EVER NEEDED.
//
// ⚰️ I SPENT A DAY CALLING PIVOT DETECTION "THE MISSING PRIMITIVE" AND "THE BIGGEST
// BLOCKER" — in three research documents and four reports. It was wrong, and it was
// steering the whole next phase of work. A pivot high with L bars left and R bars
// right is:
//
//     high[R] == highest(high, L + R + 1)
//
// The bounded backward offset supplies the candidate, `highest` supplies the window,
// and `accum` — built the same morning for Pine's `var` — supplies the memory. Three
// features that landed for three unrelated reasons compose into the thing I kept
// filing as unbuilt.
//
// ⭐ AND THE R-BAR LAG IS THE WHOLE REASON IT WORKS HERE. A pivot cannot be known
// until R bars after it happens, and a COMPOSED formula has no way to say so: the
// `offset` node is backward-only, so confirming LATE is the only reading available
// to this construction — which is what makes THIS value non-repainting.
//
// ⚰️ THIS SAID A FORWARD REFERENCE IS ONE "which this table refuses BY
// CONSTRUCTION", AND THAT IS NO LONGER TRUE. W2a.6 declared `pivothigh`/`pivotlow`
// with `forward: "arg2"`: they emit ON the pivot bar, declare the forward reach in
// the manifest, and are badged `preview-repaints` for it. What the table still
// refuses is a forward reference a member can SPELL — `parse.js` takes no negative
// offset — so the manifest remains the single authority on forward reach. ⭐ THE
// TWO SPELLINGS COEXIST ON PURPOSE: this composed one to ACT on (it is final when
// it fires), the declared entry to DRAW where the pivot actually is.
// `tests/test_ast_pivots.py` measures the declared one and quotes line 54 below.

import { describe, it, expect } from 'vitest'
import { parseFormula } from './parse.js'
import { interpret } from './interpret.js'
import { astReach, modeFromReach, maxLookback } from './lint.js'

const L = 2
const R = 2
/** A pivot high, confirmed R bars late. */
const IS_PIVOT_HIGH = `high[${R}] == highest(high, ${L + R + 1})`
const IS_PIVOT_LOW = `low[${R}] == lowest(low, ${L + R + 1})`

/** ⭐ THE SEED IS `0 / 0`, WHICH IS THIS ENGINE'S "NOT COMPUTABLE". See the test
 *  below for what the obvious alternative does. */
const LAST_PIVOT_HIGH = `accum(0 / 0, (${IS_PIVOT_HIGH}) ? high[${R}] : self, 30)`
const BARS_SINCE_PIVOT_HIGH =
  `accum(-1, (${IS_PIVOT_HIGH}) ? 0 : (self < 0 ? -1 : self + 1), 30)`

const barsOf = (highs) => highs.map((h) => ({ o: h - 1, h, l: h - 2, c: h - 0.5, v: 1000 }))
const run = (src, bars) => {
  const r = parseFormula(src)
  expect(r.ok, `${src} → ${r.error}`).toBe(true)
  return [...interpret(r.ast, bars)]
}

//                 0  1  2  3   4  5  6  7  8  9  …then a second peak at 17
const HIGHS = [10, 11, 12, 20, 13, 12, 11, 14, 15, 13, 12, 11, 10, 11, 12, 13, 14, 25,
  16, 15, 14, 13, 12, 11, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25]
const RAMP = Array.from({ length: 40 }, (_, i) => 10 + i)   // strictly rising: no pivots

describe('a pivot high, assembled from the offset and a window', () => {
  it('fires exactly once, R bars AFTER the pivot bar', () => {
    const out = run(IS_PIVOT_HIGH, barsOf(HIGHS))
    // bar 3 is the peak (20, higher than 2 either side) → confirmed at bar 5.
    expect(out[5]).toBe(1)
    expect(out[3], 'it must NOT fire on the pivot bar itself — that would be a forward read').toBe(0)
    expect(out[4]).toBe(0)
    expect(out[6]).toBe(0)
  })

  it('a strictly rising series has NO pivot highs', () => {
    // ⛔ THE CONTROL. Without it, a formula that fired constantly would satisfy the
    // case above at bar 5 and look correct.
    const out = run(IS_PIVOT_HIGH, barsOf(RAMP))
    expect(out.slice(L + R).every((v) => v === 0), 'a monotonic ramp reported a pivot').toBe(true)
  })

  it('the mirrored form finds pivot LOWS', () => {
    const inverted = HIGHS.map((h) => -h + 40)
    const out = run(IS_PIVOT_LOW, barsOf(inverted))
    expect(out[5]).toBe(1)
  })

  it('⭐ and it is NON-REPAINTING, which is the whole point of the R-bar lag', () => {
    const reach = astReach(parseFormula(IS_PIVOT_HIGH).ast)
    expect(reach.forward, 'a pivot that read forward would repaint').toBe(0)
    expect(modeFromReach(reach.forward)).toBe('non-repainting')
    // …and it reaches back exactly the confirmation window.
    expect(reach.back).toBe(L + R + 1)
  })
})

describe('the LAST pivot high, and the seed that decides what "none yet" means', () => {
  it('carries the pivot value forward once one exists', () => {
    const out = run(LAST_PIVOT_HIGH, barsOf(HIGHS))
    // the 25 peak at bar 17 confirms at 19 and is still the answer much later
    expect(out[34]).toBe(25)
    expect(out[39]).toBe(25)
  })

  it('🔴 reports NOT COMPUTABLE when no pivot has happened — the seed is `0 / 0`', () => {
    const out = run(LAST_PIVOT_HIGH, barsOf(RAMP))
    expect(out[35]).toBeNaN()
    expect(out[39]).toBeNaN()
  })

  it('🔴 THE CONTROL, and it is the reason for that seed', () => {
    // ⛔ Seeding with `high[R]` — the obvious choice — reports a pivot high that DOES
    // NOT EXIST, and it is simply the high two bars ago. `close > lastPivotHigh` would
    // then compare against a fabricated level on every symbol that has never pivoted
    // in the window, silently, in the direction that ADMITS it to the scan. Same
    // failure family as TC2000 `SinceTrue`'s -1.
    const naive = `accum(high[${R}], (${IS_PIVOT_HIGH}) ? high[${R}] : self, 30)`
    const out = run(naive, barsOf(RAMP))
    expect(Number.isNaN(out[35])).toBe(false)
    // ⚠️ AND THE INVENTED VALUE IS THE HIGH AT THE RE-SEED BAR, not at the bar being
    // read — the accumulator re-seeds 30 bars back, so bar 35's fabricated "pivot"
    // is `high[R]` as of bar 5. That is worth pinning precisely: the number is not
    // merely wrong, it is UNRELATED to anything near the bar it is reported on.
    expect(out[35], 'the naive seed invents a pivot level').toBe(RAMP[35 - 30 - R])
  })
})

describe('bars since the last pivot high', () => {
  it('counts from the CONFIRMATION bar, not the pivot bar', () => {
    const out = run(BARS_SINCE_PIVOT_HIGH, barsOf(HIGHS))
    // peak at 17 → confirmed at 19 → at bar 34 that is 15 bars ago.
    expect(out[34]).toBe(15)
    expect(out[39]).toBe(20)
  })

  it('answers -1 when there has been no pivot at all', () => {
    const out = run(BARS_SINCE_PIVOT_HIGH, barsOf(RAMP))
    expect(out[39]).toBe(-1)
  })

  it('the warm-up prefix is not computable, never a partial count', () => {
    const out = run(BARS_SINCE_PIVOT_HIGH, barsOf(HIGHS))
    for (let i = 0; i < 30; i += 1) expect(out[i], `bar ${i}`).toBeNaN()
  })
})

describe('what this unlocks, said as a member would say it', () => {
  it('"price above the last swing high" is one expression', () => {
    const src = `close > ${LAST_PIVOT_HIGH}`
    const out = run(src, barsOf(HIGHS))
    // ⛔ NOT ASSERTING A HAND-COUNTED BAR HERE. The claim is that it COMPOSES and
    // stays decidable; the numbers are pinned by the cases above.
    expect(out.length).toBe(HIGHS.length)
    const reach = astReach(parseFormula(src).ast)
    expect(modeFromReach(reach.forward)).toBe('non-repainting')
  })

  it('⛔ and the whole composition still fits the budget', () => {
    // The reason this matters: a composition that translates and is then refused at
    // the save door is worse than one that refuses early. Proven through the real
    // measurement, not by inspection.
    expect(maxLookback(parseFormula(LAST_PIVOT_HIGH).ast)).toBeLessThanOrEqual(500)
  })
})
