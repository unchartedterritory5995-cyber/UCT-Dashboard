// app/src/components/chart/engine/ast/pine.udfBinding.test.js
//
// ─── ⭐⭐ C0R §5/§6: A UDF FORMAL IS BOUND AT ITS CALL SITE, CAPTURE-SAFE ─────
//
// The second class behind C0's eight SAVE_BLOCKED scripts: a numeric input
// threaded through a user-defined function, where the function's FORMAL survived
// into the expression instead of the caller's argument —
// `high_engagement__02-waddah-attar-explosion-lazybear`'s `mult`:
//
//     mult = input(2.0, "BB Stdev Multiplier")
//     calc_BBUpper(source, length, mult) => … mult * stdev(source, length)
//     e1 = calc_BBUpper(close, channelLength, mult) - calc_BBLower(…)
//
// ⛔ THE RISK IS NOT "DOES IT WORK ONCE" — IT IS CAPTURE. A door that resolved
// formals by NAME would pass the single-call case and then quietly corrupt every
// script that calls one function twice with different arguments, or names a
// formal after an outer variable. Those two are the tests that matter here, and
// each one asserts the two call sites DIFFER — a name-based substitution makes
// them equal, which is precisely the silent-wrong-number failure.
//
// ⛔ EVERY CASE IS EVALUATED, NOT JUST TRANSLATED. Reading the printed formula
// proves what the translator said; interpreting it over bars proves what the
// member gets. `lesson_an_identity_join_is_not_a_correctness_check`.
import { describe, it, expect } from 'vitest'
import { translatePine } from './pine'
import { interpret } from './interpret'

const BARS = Array.from({ length: 120 }, (_, i) => ({
  t: 1700000000 + i * 86400,
  o: 100 + i * 0.5, h: 102 + i * 0.5, l: 98 + i * 0.5, c: 100 + i * 0.5, v: 1000 + i,
}))

const src = (body) => `//@version=5\nindicator("t", overlay = false)\n${body}\n`

/** The first usable output's formula and its evaluated column. */
function one(body, inputs = {}) {
  const t = translatePine(src(body))
  const out = (t.outputs || []).find((o) => o && o.ast && o.formula)
  expect(out, `no usable output for:\n${body}\n${t.refusal && t.refusal.message}`).toBeTruthy()
  return { formula: out.formula, col: interpret(out.ast, BARS, inputs), ast: out.ast }
}

/** Every `series` name the tree reads — the free-identifier audit, inline. */
function names(node, out = new Set()) {
  if (!node || typeof node !== 'object') return out
  if (node.type === 'series' && typeof node.name === 'string') out.add(node.name)
  if (Array.isArray(node.args)) for (const a of node.args) names(a, out)
  return out
}

const last = (col) => col[col.length - 1]

describe('a UDF formal never survives as a free identifier', () => {
  it('⭐ one numeric formal, literal argument', () => {
    const r = one(`f(x) => x * 2\nplot(f(close))`)
    expect(names(r.ast).has('x')).toBe(false)
    expect(last(r.col)).toBeCloseTo(last(BARS.map((b) => b.c)) * 2, 6)
  })

  it('⭐ multiple formals, and ORDER is respected', () => {
    // If the binder paired formals to arguments by name or by sorted order
    // rather than positionally, `sub(high, low)` would answer 0 or negative.
    const r = one(`sub(a, b) => a - b\nplot(sub(high, low))`)
    expect(names(r.ast).has('a')).toBe(false)
    expect(names(r.ast).has('b')).toBe(false)
    expect(last(r.col)).toBeCloseTo(102 + 119 * 0.5 - (98 + 119 * 0.5), 6)
  })

  it('⭐ the formal SHADOWS an outer variable of the same name', () => {
    // `mult` exists outside AND is the formal. The call passes 3, so the answer
    // must be close*3 — not close*10, which is what leaking the outer binding
    // (or substituting by name) produces.
    const r = one(`mult = 10\nf(mult) => close * mult\nplot(f(3))`)
    expect(names(r.ast).has('mult')).toBe(false)
    expect(last(r.col)).toBeCloseTo((100 + 119 * 0.5) * 3, 6)
  })

  it('⛔⛔ the SAME function called TWICE with different arguments stays different', () => {
    // ⭐ THE CAPTURE TEST. A name-based substitution collapses both calls onto
    // whichever argument it saw last, and the two halves become equal — so the
    // assertion is that they are NOT.
    const r = one(`f(k) => close * k\nplot(f(2) - f(3))`)
    expect(names(r.ast).has('k')).toBe(false)
    const c = 100 + 119 * 0.5
    expect(last(r.col)).toBeCloseTo(c * 2 - c * 3, 6)
    expect(last(r.col)).not.toBeCloseTo(0, 6)
  })

  it('⛔ two DIFFERENT functions using the same formal name do not cross', () => {
    const r = one(`f(v) => close * v\ng(v) => high * v\nplot(f(2) + g(5))`)
    expect(names(r.ast).has('v')).toBe(false)
    const c = 100 + 119 * 0.5
    const h = 102 + 119 * 0.5
    expect(last(r.col)).toBeCloseTo(c * 2 + h * 5, 6)
  })

  it('⭐ a nested call — a UDF argument that is itself a UDF call', () => {
    const r = one(`f(x) => x * 2\ng(y) => y + 1\nplot(g(f(close)))`)
    expect(names(r.ast).has('x')).toBe(false)
    expect(names(r.ast).has('y')).toBe(false)
    expect(last(r.col)).toBeCloseTo((100 + 119 * 0.5) * 2 + 1, 6)
  })

  it('⭐ a DERIVED expression as the argument', () => {
    const r = one(`f(x) => x * 2\na = close + high\nplot(f(a))`)
    expect(names(r.ast).has('x')).toBe(false)
    expect(last(r.col)).toBeCloseTo(((100 + 119 * 0.5) + (102 + 119 * 0.5)) * 2, 6)
  })

  it('⭐ an input threaded through a UDF — the waddah-attar shape, reduced', () => {
    const t = translatePine(src(
      `mult = input.float(2.0, "Mult")\nf(src, k) => k * src\nplot(f(close, mult))`,
    ), { declareInputs: ['mult'] })
    const out = (t.outputs || []).find((o) => o && o.ast)
    // The FORMAL is gone; the INPUT survives as a knob.
    expect(names(out.ast).has('k')).toBe(false)
    expect(names(out.ast).has('mult')).toBe(true)
    // And turning the knob moves the column.
    const at2 = interpret(out.ast, BARS, { mult: 2 })
    const at5 = interpret(out.ast, BARS, { mult: 5 })
    expect(last(at2)).toBeCloseTo((100 + 119 * 0.5) * 2, 6)
    expect(last(at5)).toBeCloseTo((100 + 119 * 0.5) * 5, 6)
    expect(last(at2)).not.toBeCloseTo(last(at5), 6)
  })

  it('⛔ NON-VACUITY: these columns are not all trivially equal', () => {
    // Every case above asserts a specific number; this asserts the harness can
    // tell two shapes apart at all, so a broken `one()` cannot make them pass.
    const a = one(`f(x) => x * 2\nplot(f(close))`)
    const b = one(`f(x) => x * 3\nplot(f(close))`)
    expect(last(a.col)).not.toBeCloseTo(last(b.col), 6)
  })
})
