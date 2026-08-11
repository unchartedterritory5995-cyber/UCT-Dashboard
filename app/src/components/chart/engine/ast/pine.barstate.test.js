// ⭐⭐ THE EVALUATION MODEL, AND THE LOOK-ALIKES IT MUST NOT SWALLOW.
//
// `barstate.isconfirmed` was the single most frequent refusal across the 21 real
// published scripts — 15 columns and one whole script — and it is not a missing
// name. It is a QUESTION this engine already knows the answer to: every bar it
// evaluates is closed, historical, and evaluated once. So the four constants here
// are exact, not near-enough.
//
// ⛔ AND THE POINT OF THIS FILE IS THE OTHER THREE. `barstate.islast` sits in the
// same namespace, has the same shape and the same one-word answer, and is WRONG
// to resolve: it is decided by how many bars were requested, so the same scan on
// the same stock disagrees with itself at two window sizes. That is
// `lesson_a_derived_value_must_not_depend_on_the_request`. A test that only
// checked the four that work would pass just as happily on a build that resolved
// all seven, which is the build that quietly returns a different answer per
// request — so both directions are asserted, and the split is asserted to be
// disjoint and exhaustive so a future edit cannot move a name across it silently.

import { describe, it, expect } from 'vitest'
import {
  translatePine, BUILTIN_CONSTANT_TREE, BUILTIN_REQUEST_DEPENDENT,
} from './pine.js'
import { interpret } from './interpret.js'

const script = (expr) => `//@version=5
indicator("t")
plot(${expr})
`

const outOf = (expr) => {
  const r = translatePine(script(expr))
  const found = (r.outputs || []).find((o) => o.ast || o.refusal)
  return {
    ast: found && found.ast ? found.ast : null,
    refusal: (found && found.refusal) || r.refusal || null,
  }
}

const BARS = Array.from({ length: 30 }, (_, i) => {
  const c = 100 + i
  return { o: c - 50, h: c + 1, l: c - 2, c, v: 1000 + i }
})
const col = (tree) => [...interpret(tree, BARS, {})]

/** ⛔⛔ THE TWO LISTS ARE READ OFF THE SOURCE, NEVER RETYPED HERE.
 *
 *  ⚰️ They WERE retyped, and a mutation run caught it: moving `barstate.islast`
 *  into the constant map left this file GREEN, because the disjointness check was
 *  comparing two arrays this file owned against each other rather than against the
 *  maps that decide anything. That is `A SECOND AUTHORITY OVER ONE VALUE` — the
 *  defect this repo repeats most — committed inside the test whose own header
 *  warned about it. Derived, a name added tomorrow is covered the day it lands. */
const RESOLVES = Object.keys(BUILTIN_CONSTANT_TREE)
const REFUSES = Object.keys(BUILTIN_REQUEST_DEPENDENT)

describe('the four the evaluation model answers', () => {
  it('⛔ NON-VACUITY FIRST, and the split is pinned in BOTH directions', () => {
    // Everything below is `0/0` on an empty map. The counts are pinned so the
    // split cannot GROW by accident either — adding a name to either map is a
    // deliberate edit here, which is the point: each one is a judgement about
    // what this engine's evaluation model does and does not decide.
    expect(RESOLVES.length,
      `the constant map moved — now [${RESOLVES.join(' | ')}]`).toBe(4)
    expect(REFUSES.length,
      `the request-dependent map moved — now [${REFUSES.join(' | ')}]`).toBe(3)
    // ⛔ AND NO NAME IS IN BOTH. This is the assertion that catches a name being
    // promoted out of "the request decides this" into "the engine decides this".
    const both = RESOLVES.filter((n) => REFUSES.includes(n))
    expect(both, `claimed by BOTH maps: [${both.join(' | ')}]`).toEqual([])
  })

  for (const name of RESOLVES) {
    it(`${name} resolves to a constant, not a refusal`, () => {
      const { ast, refusal } = outOf(name)
      expect(refusal, `${name} refused: ${refusal && refusal.message}`).toBeNull()
      expect(ast).toBeTruthy()
      // A constant is the same on every bar — that IS the claim being made.
      const out = col(ast)
      expect(new Set(out).size, `${name} is not constant across bars`).toBe(1)
    })
  }

  it('the TRUE ones are true and the FALSE one is false — checked by BEHAVIOUR', () => {
    // ⭐ Not by reading the literal back. A script branches on these, so the thing
    // that matters is which branch a member's script takes. `open` and `close` are
    // 50 apart on every fixture bar, so a swapped branch is unmissable.
    expect(col(outOf('barstate.isconfirmed ? close : open').ast)[10]).toBe(BARS[10].c)
    expect(col(outOf('barstate.ishistory ? close : open').ast)[10]).toBe(BARS[10].c)
    expect(col(outOf('barstate.isnew ? close : open').ast)[10]).toBe(BARS[10].c)
    // ⛔ THE ONE THAT INVERTS. Without this, a map that returned 1 for everything
    // would pass every assertion above.
    expect(col(outOf('barstate.isrealtime ? close : open').ast)[10]).toBe(BARS[10].o)
  })

  it('a confirmed-bar guard becomes the guarded expression itself', () => {
    // The shape that actually appears in the corpus: `signal and barstate.isconfirmed`.
    const guarded = col(outOf('close > open and barstate.isconfirmed').ast)
    const bare = col(outOf('close > open').ast)
    expect(guarded).toEqual(bare)
  })
})

describe('🔴 the three the REQUEST decides — refused, and refused with the reason', () => {
  for (const name of REFUSES) {
    it(`${name} refuses and names the request as the reason`, () => {
      const { ast, refusal } = outOf(name)
      expect(ast, `${name} RESOLVED — it must not`).toBeNull()
      expect(refusal).toBeTruthy()
      expect(refusal.message,
        `${name} refused without saying the answer would depend on the request`)
        .toMatch(/depends on how (many|far)|relative to the end of the request/)
    })
  }

  it('⛔ THE CONTROL — an ordinary unknown builtin does NOT get that sentence', () => {
    // Without this, every assertion above would pass for a reader that appended
    // the same explanation to every refusal it ever made.
    const { refusal } = outOf('barstate.isnonsense')
    expect(refusal).toBeTruthy()
    expect(refusal.message).not.toMatch(/depends on how (many|far)/)
  })

  it('⛔ AND THE SIBLINGS STILL RESOLVE — proving the guard is not a whole-namespace ban', () => {
    // A refusal that had simply re-banned `barstate.*` would satisfy the loop
    // above. This is what tells the two apart.
    expect(outOf('barstate.isconfirmed').ast).toBeTruthy()
  })
})
