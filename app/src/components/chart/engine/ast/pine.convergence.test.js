import { describe, it, expect } from 'vitest'

import { translatePine, printFormula, SEED_RESIDUAL_TOLERANCE } from './pine.js'
import { translateThinkScript } from './thinkscript.js'
import { interpret } from './interpret.js'
import TABLE from './closedTable.json'

/**
 * ⭐⭐ THE CONVERGENCE GATE, WIDENED TO THE SHAPE EVERY SMOOTHER IS.
 *
 * `forgetsItsSeed` decides whether an update may be folded into `accum`, which
 * re-seeds a FIXED number of bars back. It recognised `min`/`max`/`nz`/ternary
 * pass-through and answered NO to everything else — including
 * `(self + close) / 2`, `(self * 13 + close) / 14` (Wilder) and `self * 0.9 +
 * close * 0.1` (an EMA by hand). Those are LINEAR CONTRACTIONS: the seed's weight
 * decays geometrically, so they are exactly the updates the accumulator is safe
 * for, and refusing them refused the commonest stateful shape in both languages.
 *
 * ⛔ `|a| < 1` IS NOT THE TEST. "Forgets eventually" is not the question the
 * accumulator asks; "forgets within `warmup` bars" is. At `a = 0.999` the seed
 * still carries 78% of its weight after 250 bars — a rolling window in a
 * smoother's clothes. So the test is the RESIDUAL: `|a| ** warmup` at or under
 * one part in a million. The pair of tests below sits either side of that
 * boundary, which is the only way to show the threshold is doing work rather
 * than sitting in the file looking principled.
 *
 * ⭐ ONE RULE, BOTH DOORS. `thinkscript.js` imports this function rather than
 * carrying its own copy, so the last case here checks the same widening arrives
 * at `CompoundValue` — the mirror, not just the lane.
 */
describe('the convergence gate recognises a linear contraction', () => {
  const spec = TABLE.functions.accum
  const pine = (body) => translatePine(`//@version=4\nstudy("t")\nvar s = 0.0\n${body}\nplot(s)\n`)
  const okPine = (body) => {
    const out = pine(body)
    expect(out.refusal, out.refusal && out.refusal.message).toBe(null)
    const row = out.outputs.find((o) => o.refusal === null)
    expect(row, 'no output translated').toBeTruthy()
    return row
  }
  const refusalOf = (body) => {
    const out = pine(body)
    const r = out.refusal || (out.outputs.find((o) => o.refusal) || {}).refusal
    expect(r, 'expected a refusal').toBeTruthy()
    return r
  }

  it('⭐⭐ a halving average folds — and it did not before', () => {
    const row = okPine('s := (s + close) / 2')
    expect(row.ast.name).toBe('accum')
    expect(printFormula(row.ast.args[spec.recurrence.body]))
      .toBe(`(${spec.recurrence.binds} + close) / 2`)
  })

  it('⭐⭐ Wilder`s smoother folds, and the NUMBER matches an independent run', () => {
    // ⛔ THE ARITHMETIC, NOT THE SHAPE — a wrong body still draws a line. The
    // recurrence is simulated here in plain JS over the accumulator's own window,
    // so the check cannot pass by agreeing with itself.
    const row = okPine('s := (s * 13 + close) / 14')
    expect(row.ast.name).toBe('accum')
    const warmup = row.ast.args[spec.recurrence.warmup].value
    const closes = Array.from({ length: warmup + 5 }, (_, i) => 100 + (i % 7))
    const col = interpret(row.ast, closes.map((c, i) => (
      { t: 20260101 + i, o: c, h: c, l: c, c, v: 100 })))
    const t = closes.length - 1
    let x = 0                             // `var s = 0.0` — the accumulator's own seed
    for (let i = t - warmup + 1; i <= t; i += 1) x = (x * 13 + closes[i]) / 14
    expect(col[t]).toBeCloseTo(x, 9)
  })

  it('⭐ a NEGATIVE coefficient converges too — oscillating is not diverging', () => {
    expect(okPine('s := close - s * 0.5').ast.name).toBe('accum')
  })

  // ─── the boundary, from both sides ────────────────────────────────────────

  it('⭐⭐ 0.94 folds and 0.95 REFUSES — the threshold is the residual, not `< 1`', () => {
    // 0.94 ** 250 ≈ 1.9e-7 (under the tolerance) · 0.95 ** 250 ≈ 2.7e-6 (over it).
    // ⛔ These two lines differ by one hundredth and must land on opposite sides,
    // or the tolerance is decoration. Derived here rather than retyped:
    expect(0.94 ** 250).toBeLessThanOrEqual(SEED_RESIDUAL_TOLERANCE)
    expect(0.95 ** 250).toBeGreaterThan(SEED_RESIDUAL_TOLERANCE)
    expect(okPine('s := s * 0.94 + close * 0.06').ast.name).toBe('accum')
    expect(refusalOf('s := s * 0.95 + close * 0.05').guard).toBe('pine:state')
  })

  it('⛔ 0.999 still refuses — it forgets eventually, not within the warm-up', () => {
    expect(refusalOf('s := s * 0.999 + close * 0.001').guard).toBe('pine:state')
  })

  // ─── what must still refuse, unchanged ────────────────────────────────────

  it('⛔ a running total never forgets', () => {
    expect(refusalOf('s := s + close').guard).toBe('pine:state')
  })

  it('⛔ `self * self` is not linear in `self`', () => {
    expect(refusalOf('s := s * s').guard).toBe('pine:state')
  })

  it('⛔ a divisor that is not a constant is unknown, and unknown answers NO', () => {
    // The coefficient of `self` in `s / close` is not a number this engine can
    // know at translate time. Conservative by construction.
    expect(refusalOf('s := s / close').guard).toBe('pine:state')
  })

  it('⛔ `self` under an offset is a SECOND state variable, not a multiple', () => {
    expect(refusalOf('s := (s + s[1]) / 2').guard).toBe('pine:state')
  })

  // ─── the sibling door ─────────────────────────────────────────────────────

  it('⛔⛔ `var x` and plain `x` reach the SAME verdict — the gate was on one door only', () => {
    // 🪦 FOUND BY A TEST WRITTEN FOR SOMETHING ELSE. `x = 0.0` + `x := x + volume`
    // has refused since the convergence gate landed. `var x = 0.0` + the SAME
    // reassignment took a different arm of `resolveBinding` — the `state` one — which
    // built the accumulator with NO gate at all, so OBV by hand folded to a 250-bar
    // ROLLING SUM and drew a plausible line on every bar.
    // ⛔ Two spellings of one construct must agree, and asserting they AGREE is
    // what makes this a rail rather than a second copy of the same check.
    // ⚠️ THE TWO SPELLINGS ARE NOT THE SAME TEXT. A `var` persists across bars,
    // so its bare `x` IS last bar's value; a plain name's bare `x` is the binding
    // above it, and the bar read has to be written `x[1]`. Same indicator, two
    // grammars — which is exactly why one of them went unrailed.
    const PAIRS = [
      ['x := x + volume', 'x := x[1] + volume'],
      ['x := x * 1.01', 'x := x[1] * 1.01'],
    ]
    for (const [varForm, plainForm] of PAIRS) {
      const withVar = translatePine(
        `//@version=5
indicator("t")
var x = 0.0
${varForm}
plot(x)
`)
      const plain = translatePine(
        `//@version=5
indicator("t")
x = 0.0
${plainForm}
plot(x)
`)
      expect(plain.ok, `plain ${plainForm}`).toBe(false)
      expect(withVar.ok, `var ${varForm}`).toBe(plain.ok)
      expect(withVar.refusal.guard, `var ${varForm}`).toBe(plain.refusal.guard)
    }
    // ⭐ THE CONTROL: a contraction still folds through BOTH doors, so this is
    // agreement rather than a gate that refuses everything it is asked.
    for (const [head, body] of [['var x = 0.0', 'x := (x + close) / 2'],
      ['x = 0.0', 'x := (x[1] + close) / 2']]) {
      const out = translatePine(
        `//@version=5
indicator("t")
${head}
${body}
plot(x)
`)
      expect(out.refusal, head).toBe(null)
      expect(out.outputs[0].ast.name, head).toBe('accum')
    }
  })

  // ─── the mirror ───────────────────────────────────────────────────────────

  it('⭐⭐ and thinkScript`s CompoundValue gets it too — one rule, both doors', () => {
    // `forgetsItsSeed` is IMPORTED by `thinkscript.js`, so this widening had to
    // arrive in both lanes or in neither. A second copy of a convergence rule is
    // how two translators come to disagree about one engine function.
    const out = translateThinkScript(
      'def s = CompoundValue(1, (s[1] + close) / 2, close);\nplot p = s;\n')
    expect(out.refusal, out.refusal && out.refusal.message).toBe(null)
    expect(out.outputs[0].ast.name).toBe('accum')
    // ⭐ AND THE CONTROL: the running total it has always refused still refuses,
    // so this did not simply open the gate.
    expect(translateThinkScript(
      'def v = CompoundValue(1, v[1] + volume, 0);\nplot p = v;\n')
      .outputs[0].refusal.guard).toBe('thinkscript:state')
  })
})
