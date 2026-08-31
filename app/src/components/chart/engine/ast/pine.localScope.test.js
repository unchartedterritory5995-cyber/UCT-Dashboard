// 🔴 ONE CONSTRUCT, TWO SPELLINGS, ONE ANSWER — the function-local `var` rail.
//
// ⛔⛔ THIS EXISTS BECAUSE THE SAME CODE ANSWERED DIFFERENTLY DEPENDING ON WHERE
// IT WAS WRITTEN. `Resolver.guardOffsetOfMutable` admits an `x[1]` read of a
// reassigned variable when that binding is the LAST WORD on the name — Pine's
// `x[1]` means the previous bar's FINAL value, so reading a binding that a later
// `:=` supersedes would be a different number. The check was
// `finalBindings.get(name) === bound`, and `finalBindings` is `new Map(env)` over
// the TOP-LEVEL env — so a `var` declared inside `f() =>` was never in it and
// every function-local latch refused, byte-identical source and all.
//
// ⭐ THE CORPUS FOUND IT AND CANNOT OWN IT. `02-ict-retracement` moved from
// refused to translating when this was fixed, which is a REGRESSION NET doing its
// job — but a snapshot can only say the script changed. It cannot say WHY the
// criterion is "last word in its own scope" rather than "any local", and the
// loosening is the failure that would look like progress: more scripts translate,
// each one quietly reading the wrong bar. Case B is the whole reason this file
// exists; A and C are what make B's refusal meaningful rather than blanket.
//
// ⚠️ AND THE REFUSAL THAT COVERED IT READ AS A PERMANENT RULING — `pine:state`
// says an unbounded accumulator "would end static decidability … so it is not a
// backlog item". True of the case it was written for, false of this one: the
// accumulator holds this latch exactly. That sentence is why the script was
// adjudicated blocked more than once (`lesson_an_over_refusal_is_invisible`).

import { describe, it, expect } from 'vitest'
import { translatePine } from './pine.js'

const run = (src) => translatePine(src)
const column = (out) => (out.selected >= 0 ? out.outputs[out.selected].formula : null)

// The latch, written four ways. A and C are THE SAME CONSTRUCT — the only
// difference is a function wrapper — and B and D are the same pair for the case
// where the binding read is NOT the last word.
const A_FN_LOCAL_FINAL = `//@version=5
indicator("A")
g(c1, c2) =>
    var s = 0
    s := c1 ? 1 : c2 ? -1 : s[1]
    s
plot(g(close > open, close < open))`

const B_FN_LOCAL_SUPERSEDED = `//@version=5
indicator("B")
g(c1) =>
    var s = 0.0
    s := c1 ? 1 : s[1]
    s := s + 1
    s
plot(g(close > open))`

const C_TOP_LEVEL_FINAL = `//@version=5
indicator("C")
var s = 0
s := close > open ? 1 : close < open ? -1 : s[1]
plot(s)`

// ⭐⭐ THE CASE THAT ACTUALLY MEASURES THE CRITERION. `g()` is defined BEFORE the
// top-level `t := close`, so the `t` its body closes over is the binding from
// BEFORE that assignment — not the last word on `t`. Reading `t[1]` there is
// reading the wrong bar, and it must refuse even though the read is syntactically
// inside a function body.
const E_FN_READS_A_STALE_GLOBAL = `//@version=5
indicator("E")
var t = 0.0
g() =>
    t[1]
t := close
plot(g())`

const D_TOP_LEVEL_SUPERSEDED = `//@version=5
indicator("D")
var s = 0.0
s := close > open ? 1 : s[1]
s := s + 1
plot(s)`

describe('a `var` latch answers the same inside a function as it does outside', () => {
  it('⭐⭐ the function-local latch and the top-level latch fold to the SAME formula', () => {
    const inFn = run(A_FN_LOCAL_FINAL)
    const atTop = run(C_TOP_LEVEL_FINAL)

    expect(inFn.ok, 'the function-local spelling translates').toBe(true)
    expect(atTop.ok, 'the top-level spelling translates').toBe(true)

    // ⛔ BOTH-TRANSLATE IS THE WEAK HALF OF THIS CLAIM. Two doors can both open
    // onto different rooms. The point is that the WRAPPER IS NOT SEMANTIC: the
    // accumulator, its seed, its recurrence and its window are identical, so
    // asserting the formulas are equal is what makes this a parity test rather
    // than two independent smoke tests that happen to sit in one case.
    expect(column(inFn)).toBe(column(atTop))
    expect(column(atTop)).toBe('accum(0, close > open ? 1 : close < open ? -1 : self, 250)')
  })

  it('⭐⭐ and a local whose read is SUPERSEDED by a later `:=` is still refused', () => {
    // ⛔ THE CRITERION IS THE TOP LEVEL'S, NOT A LOOSER ONE. This is the case the
    // fix could have swallowed: admitting every function-local binding would make
    // this translate, and it would compute the WRONG NUMBER — `s[1]` is the
    // previous bar's value of `s` AFTER `s := s + 1` ran, not before it.
    // Widening `finalLocals` to all locals turns this case green, which is the
    // only reason it can be trusted to be measuring the criterion.
    const out = run(B_FN_LOCAL_SUPERSEDED)
    expect(out.ok).toBe(false)
    expect(out.refusal.guard).toBe('pine:state')
    expect(out.refusal.token).toBe('s')
  })

  it('⭐⭐ a function reading a global that a LATER top-level `:=` supersedes still refuses — BY NAME', () => {
    // ⛔⛔ THIS IS THE CASE THAT PROVES THE FILTER, and cases A-D do not.
    // `finalLocals` is fed from the bindings a body CHANGED
    // (`beforeFn.get(name) !== bound`). The obvious "simplification" — add every
    // binding in the function's env — looks equivalent, because a name-keyed Map
    // only ever holds one binding per name, so A-D behave IDENTICALLY under it.
    // MEASURED, deleting that filter turns this case from
    //     pine:state at line 5, column 6      (names the read, names the fix)
    // into
    //     pine:roundtrip with a null line and a null column
    // — the read slips past the state guard, builds an accumulator over a binding
    // that is not the last word, and dies downstream as a mystery. So the filter
    // is not decoration: without it a member gets a WORSE refusal for a script
    // that was always going to be refused (`lesson_rail_the_sentence_not_just_the_guard`).
    // ⚠️ THE LOCATION IS PART OF THE ASSERTION. Checking only `guard` leaves this
    // green under the mutation for the wrong reason once the roundtrip guard is
    // ever renamed.
    const out = run(E_FN_READS_A_STALE_GLOBAL)
    expect(out.ok).toBe(false)
    expect(out.refusal.guard).toBe('pine:state')
    expect(out.refusal.line).toBe(5)
    expect(out.refusal.column).toBe(6)
  })

  it('⛔ the CONTROL — the same supersession at top level was always refused', () => {
    // If this ever goes green the fix leaked out of function scope entirely, and
    // case B above would be measuring a different mechanism than it claims to.
    const out = run(D_TOP_LEVEL_SUPERSEDED)
    expect(out.ok).toBe(false)
    expect(out.refusal.guard).toBe('pine:state')
  })

  it('⭐ the five cases are genuinely FIVE — no two sources are the same text', () => {
    // ⛔ A parity rail whose two halves are the same string proves nothing
    // (`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`). A and C differ
    // ONLY by the function wrapper, and that is the claim — so the distinctness
    // has to be asserted rather than eyeballed.
    const all = [A_FN_LOCAL_FINAL, B_FN_LOCAL_SUPERSEDED, C_TOP_LEVEL_FINAL,
      D_TOP_LEVEL_SUPERSEDED, E_FN_READS_A_STALE_GLOBAL]
    expect(new Set(all).size).toBe(5)
    expect(A_FN_LOCAL_FINAL).toMatch(/g\(c1, c2\) =>/)
    expect(C_TOP_LEVEL_FINAL).not.toMatch(/=>/)
  })
})
