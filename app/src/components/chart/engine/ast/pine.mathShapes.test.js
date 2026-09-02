// app/src/components/chart/engine/ast/pine.mathShapes.test.js
//
// ─── ⭐ TWO MATH SPELLINGS, AND WHY EACH ONE WAS MISSING ──────────────────────
//
//   `math.pow(base, exponent)` refused `pine:role-order`. Both of this table's
//   `pow` arguments are declared `series`, so it fell into the fail-closed arm —
//   "a function with two price arguments matched up by position could quietly
//   return somebody else's number" — with no measured order to save it. `max`
//   and `min` already had one; `pow` did not, and unlike those two its order is
//   NOT symmetric, so the entry is written down rather than assumed.
//
//   `math.log(x)` refused `pine:function`. It is the NATURAL log and this table
//   declares that under the name `ln` ("the natural log of {0}"), so nothing was
//   missing but the spelling.
//
// ⚰️ AND THE PLACE TO PUT A SPELLING WAS DOCUMENTED AS SOMEWHERE IT IS NOT. The
// file header credited renaming to a `PINE_NAME_ALIASES` map; no such map exists.
// A shape whose `table` differs from its key has always been the mechanism —
// `resolveTableCall` reads `shape ? shape.table : base` — so anyone looking for
// the map found nothing and could reasonably conclude there was no way to do it.

import { describe, it, expect } from 'vitest'

import { translatePine, PINE_CALL_SHAPES } from './pine.js'
import { TABLE } from './parse.js'

const screen = (body, version = 6) =>
  translatePine(`//@version=${version}\nindicator("s")\nplot(${body} ? 1 : 0)\n`)
const formulaOf = (out) => {
  expect(out.ok, out.ok ? '' : `${out.refusal.guard}: ${out.refusal.message}`).toBe(true)
  return out.outputs[out.selected].formula
}

describe('math.pow and math.log reach the table', () => {
  it('⭐ `math.pow` keeps base and exponent in that order', () => {
    expect(formulaOf(screen('math.pow(close, 2) > 100'))).toBe('pow(close, 2) > 100 ? 1 : 0')
  })

  it('⛔⛔ the order is asserted against the MANIFEST’s own sentence', () => {
    // ⚠️ `pow(2, close)` and `pow(close, 2)` are both well-formed and wildly
    // different, and nothing downstream would refuse the wrong one. The table
    // states which is which — "{0} raised to the power {1}" — so the shape is
    // checked against that rather than against my reading of Pine's docs.
    expect(TABLE.functions.pow.sentence).toBe('{0} raised to the power {1}')
    expect(PINE_CALL_SHAPES.pow.build).toEqual([{ pine: 0 }, { pine: 1 }])
    // …and the arguments really do land distinguishably, not symmetrically.
    expect(formulaOf(screen('math.pow(close, open) > 1')))
      .toBe('pow(close, open) > 1 ? 1 : 0')
    expect(formulaOf(screen('math.pow(open, close) > 1')))
      .toBe('pow(open, close) > 1 ? 1 : 0')
  })

  it('⭐ `math.log` is the natural log, which this table calls `ln`', () => {
    expect(TABLE.functions.ln.sentence).toBe('the natural log of {0}')
    expect(formulaOf(screen('math.log(close) > 1'))).toBe('ln(close) > 1 ? 1 : 0')
    expect(formulaOf(screen('math.log(close / close[20]) > 0.1')))
      .toBe('ln(close / close[20]) > 0.1 ? 1 : 0')
  })

  it('⛔ `math.log10` is NOT renamed — the table already holds that name', () => {
    // ⭐ A second entry for it would be a second statement of one fact, and the
    // first thing to drift. This asserts the absence on purpose.
    expect(PINE_CALL_SHAPES.log10).toBeUndefined()
    expect(formulaOf(screen('math.log10(close) > 1'))).toBe('log10(close) > 1 ? 1 : 0')
  })

  it('⭐ the v4 bare spellings reach the same place', () => {
    expect(formulaOf(screen('log(close) > 1', 4))).toBe('ln(close) > 1 ? 1 : 0')
    expect(formulaOf(screen('pow(close, 2) > 1', 4))).toBe('pow(close, 2) > 1 ? 1 : 0')
  })

  it('⛔ `math.max` and `math.min` are untouched by the new neighbour', () => {
    expect(formulaOf(screen('math.max(close, open) > 1'))).toBe('max(close, open) > 1 ? 1 : 0')
    expect(formulaOf(screen('math.min(close, open) > 1'))).toBe('min(close, open) > 1 ? 1 : 0')
  })
})
