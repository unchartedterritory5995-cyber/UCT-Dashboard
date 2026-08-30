// app/src/components/chart/engine/ast/pine.boolcast.test.js
//
// ─── ⚰️⚰️ A REFUSAL THAT RESTED ON A CLAIM ABOUT A VENDOR ───────────────────
//
// `pine.js` carried this, in-file, beside the code it justified:
//
//   "⛔⛔ AND `bool(x)` WOULD NOT HAVE COME WITH THEM. TradingView documents the
//    cast for `na` and for bools; what `bool(<float>)` means for a `ta.pivothigh`
//    result is NOT published, and the plausible reading (`not na(x)`) would be
//    this translator INVENTING a meaning and drawing a column from it."
//
// ⛔ IT WAS WRONG ON BOTH HALVES, and the second half is the dangerous one.
//
//   1. IT IS PUBLISHED. TradingView's v6 migration guide states it verbatim:
//      "In Pine v5, values of "int" and "float" types can be implicitly cast to
//      "bool" … In such cases, `na`, `0`, or `0.0` are considered `false`, and
//      any other value is considered `true`." — and prescribes the fix, "Wrap the
//      numeric value with the bool() function to cast it explicitly."
//      https://www.tradingview.com/pine-script-docs/migration-guides/to-pine-version-6/
//
//   2. `not na(x)` IS BACKWARDS. TradingView says `0` casts to FALSE; `not na(0)`
//      is TRUE. The reading that paragraph declined to invent would have produced
//      a wrong column — so the caution was right and its stated reason was not,
//      which is the worst combination: a correct refusal nobody could re-derive.
//
// ⭐⭐ SO THE FOLD IS `x != 0` AND IT IS AN EXACT IDENTITY. `interpret.js`'s `cmp`
// pins "A COMPARISON AGAINST NaN IS 0, NOT NaN", so `x != 0` answers false for
// `na`, false for `0`, and true otherwise — TradingView's sentence, bar for bar.
//
// ⛔ THE ZERO CASE IS THE WHOLE RAIL. A test that only checked `na` would pass
// against `not na(x)` too, and would therefore be green with the engine computing
// the opposite answer on every flat bar (`lesson_a_fixture_that_cannot_
// distinguish_is_not_a_rail`).

import { describe, it, expect } from 'vitest'

import { translatePine } from './pine.js'
import { parseFormula, NODE_TYPES } from './parse.js'
import { interpret } from './interpret.js'

const SRC = (body) => `//@version=6\nindicator("t")\nplot(${body} ? 1 : 0)\n`
const formulaOf = (out) => (out.outputs.find((o) => o.formula) || {}).formula

/** Bars whose close walks through the three cases the cast distinguishes. */
const BARS = [
  { t: 20260101, o: 1, h: 1, l: 1, c: 5, v: 1 },
  { t: 20260102, o: 1, h: 1, l: 1, c: 0, v: 1 },     // ⭐ the zero bar
  { t: 20260103, o: 1, h: 1, l: 1, c: -3, v: 1 },
]

describe('bool(x) is x != 0, which is what TradingView publishes', () => {
  it('⭐⭐ it folds to a comparison against zero, in the declared vocabulary', () => {
    const f = formulaOf(translatePine(SRC('bool(close)')))
    expect(f).toBe('close != 0 ? 1 : 0')
    // ⛔⛔ NO NEW NODE TYPE, ASSERTED BY WALKING THE TREE rather than by eyeballing
    // the string. `astHash` is over the node vocabulary, so a grammar change here
    // would be permanent and unwithdrawable; this fold emits only `op` and `num`,
    // both of which `NODE_TYPES` already declares.
    const seen = new Set()
    const walk = (n) => {
      if (!n || typeof n !== 'object') return
      if (n.type) seen.add(n.type)
      for (const a of (n.args || [])) walk(a)
    }
    walk(parseFormula(f).ast)
    expect([...seen].every((t) => NODE_TYPES.includes(t)), [...seen].join(',')).toBe(true)
    expect(seen.has('op')).toBe(true)
    expect(seen.has('num')).toBe(true)
  })

  it('⛔⛔ ZERO IS FALSE — the case that tells this apart from `not na(x)`', () => {
    // ⚰️ THE DELETED RULING CALLED `not na(x)` the plausible reading. On the zero
    // bar the two disagree, and TradingView says which one is right.
    const asBool = interpret(parseFormula('close != 0').ast, BARS, {})
    const asNotNa = interpret(parseFormula('na(close) == 0').ast, BARS, {})
    expect(Array.from(asBool)).toEqual([1, 0, 1])
    expect(Array.from(asNotNa)).toEqual([1, 1, 1])
    // ⭐ THE ASSERTION THAT MAKES THIS A RAIL RATHER THAN A DEMONSTRATION: the two
    // readings are NOT interchangeable, so a fold that quietly became the other
    // one would be caught here rather than drawing a confident wrong column.
    expect(Array.from(asBool)).not.toEqual(Array.from(asNotNa))
  })

  it('⛔ na is false too — the half the old ruling did get right', () => {
    const withNa = [{ t: 20260101, o: 1, h: 1, l: 1, c: NaN, v: 1 }]
    expect(Array.from(interpret(parseFormula('close != 0').ast, withNa, {}))).toEqual([0])
  })

  it('⛔⛔ a member’s OWN one-argument `bool` wins over the carve-out', () => {
    // ⚰️⚰️ THIS TEST WAS VACUOUS ON ITS FIRST DRAFT AND THE MUTATION CAUGHT IT. It
    // used `bool(a, b) => a + b` called as `bool(close, 2)` — TWO arguments, which
    // the carve-out declines on ARITY alone, so deleting `shadowedByDefinition`
    // left it green. A shadowing rail must use a definition with the SAME SHAPE
    // the carve-out takes, or it proves nothing about shadowing —
    // `lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`, in a file whose own
    // header quotes that lesson.
    //
    // ⭐ `pine.bindingOrder.test.js` found this defect FIVE times before it was
    // derived rather than remembered: a member writing their own `bool` must get
    // their own function, never the engine's cast.
    const own = ['//@version=6', 'indicator("t")', 'bool(a) => a * 2',
      'plot(bool(close))', ''].join('\n')
    const f = formulaOf(translatePine(own))
    expect(f).toBe('close * 2')
    expect(String(f).includes('!= 0')).toBe(false)
  })

  it('⛔ …and a two-argument call is declined on arity, falling through to the door', () => {
    // The other half, kept as its own case so a failure names which rule broke.
    const two = ['//@version=6', 'indicator("t")', 'plot(bool(close, 2) ? 1 : 0)', ''].join('\n')
    const f = formulaOf(translatePine(two))
    expect(f == null || !String(f).includes('!= 0')).toBe(true)
  })

  it('⛔ a NAMED argument is not silently accepted', () => {
    const out = translatePine(SRC('bool(x = close)'))
    expect(formulaOf(out) === 'close != 0 ? 1 : 0').toBe(false)
  })

  it('⭐ the real corpus script it unblocks translates, saves and screens', () => {
    // ⚠️ THROUGH THE SHIPPED DOOR, not a re-description of it.
    const fs = require('node:fs')
    const path = require('node:path')
    const src = fs.readFileSync(path.resolve(process.cwd(),
      '../tests/fixtures/pine_community/27-support-resistance-channels.pine'), 'utf8')
    const out = translatePine(src)
    expect(out.ok).toBe(true)
    expect(out.outputs[out.selected].formula).toBe('pivothigh(high, 10, 10)[10] != 0 && 0')
  })
})
