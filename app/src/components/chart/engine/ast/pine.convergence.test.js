import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { translatePine, printFormula, SEED_RESIDUAL_TOLERANCE } from './pine.js'
import { translateThinkScript } from './thinkscript.js'
// ⭐ `MAX_SELF_LAG` COMES FROM THE INTERPRETER, not from a 4 typed here — the
// same reason `pine.js` imports it. A test that restated it would go green on the
// day the two drifted apart.
import { interpret, MAX_SELF_LAG } from './interpret.js'
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

/**
 * ⭐⭐ THE MULTI-LAG WIDENING — AND THE COUNTEREXAMPLE THAT BOUNDS IT.
 *
 * `interpret.js` has carried a lag history since `self[k]` landed; its own
 * comment calls the 2-pole filter "THE KEYSTONE" and sets `MAX_SELF_LAG` to 4.
 * The gate above could not reach any of it: `coefficient()` returns a SCALAR, and
 * a scalar cannot describe `a·self + b·self[1]`, so every published recursive
 * filter — Ehlers, SuperSmoother, Butterworth, every 2-pole design in circulation
 * — answered "unknown", and unknown answers NO.
 *
 * ⛔⛔ AND THE OBVIOUS GENERALISATION IS UNSOUND. Making `coefficient()` return a
 * vector and letting `ok()` recurse through `?:` arms independently is sound for
 * SCALARS — a product of numbers each below the threshold is below the threshold
 * — and FALSE for vectors: per-arm contraction does not imply a SWITCHED linear
 * system contracts. The tree below is the measured counterexample, and it is the
 * FIRST test here rather than the last because it is what the widening had to be
 * shaped around. The vector path is reachable only where nothing switches, and the
 * control beside it — both arms translating ON THEIR OWN — is what proves the
 * refusal comes from the switch rather than from arms that would be refused anyway.
 */
describe('⛔⛔ a switched multi-lag system is REFUSED, and its arms are not', () => {
  const spec = TABLE.functions.accum
  const script = (body) => `//@version=5
indicator("t")
var x = close
x := ${body}
plot(x)
`
  const ARM_A = '-1.7 * x - 0.8 * x[2] + close'
  const ARM_B = '0.2 * x - 0.8 * x[2] + close'
  // ⚠️ `x` INSIDE ITS OWN UPDATE IS `self` AND `x[2]` IS `self[1]` — Pine counts
  // from the previous bar and the accumulator counts from zero. Asserted rather
  // than assumed below, so a reader can see the tree these strings really build.
  const SWITCHED = `close > open ? ${ARM_A} : ${ARM_B}`

  it('⭐ the strings above really do build the counterexample tree', () => {
    const out = translatePine(script(ARM_A))
    expect(out.refusal, out.refusal && out.refusal.message).toBe(null)
    expect(printFormula(out.outputs[0].ast.args[spec.recurrence.body]))
      .toBe('-1.7 * self - 0.8 * self[1] + close')
  })

  it('⛔⛔ THE COUNTEREXAMPLE: both arms contract, the switch does not — REFUSED', () => {
    expect(translatePine(script(SWITCHED)).refusal.guard).toBe('pine:state')
  })

  it('⭐ THE CONTROL: each arm ALONE translates, so the switch is what refuses', () => {
    // ⛔ Without this the test above would pass just as happily if the widening
    // had never landed and every multi-lag form still refused.
    for (const arm of [ARM_A, ARM_B]) {
      const out = translatePine(script(arm))
      expect(out.refusal, arm).toBe(null)
      expect(out.outputs[0].ast.name, arm).toBe('accum')
    }
  })

  it('⛔ and it is not a theoretical worry — the switched system EXPLODES', () => {
    // The evidence the refusal exists for, computed here rather than recalled from
    // somebody else's run. The arms are stepped exactly as `interpret.js` would
    // step them, on a $100 stock, choosing per bar.
    // ⭐⭐ THE BARS ALTERNATE UP/DOWN, AND THAT IS THE WHOLE COUNTEREXAMPLE. Each
    // arm's companion matrix has both eigenvalues at |0.894| — deeply contracting —
    // but their PRODUCT has one at |1.52|, so a market that simply alternates green
    // and red bars drives the switched system away. No arm is at fault and no arm
    // can be blamed by looking at it alone: that is precisely why a per-arm test is
    // the wrong test. ⚠️ An arbitrary bar series will NOT show this — a smooth one
    // holds each arm for runs and looks perfectly stable.
    const N = 150
    const bars = Array.from({ length: N }, (_, i) => (
      i % 2 === 0 ? { o: 99, c: 101 } : { o: 101, c: 99 }))
    const runFrom = (seed) => {
      let h0 = seed
      let h1 = seed
      let worst = 0
      const trail = []
      for (let i = 0; i < N; i += 1) {
        const next = bars[i].c > bars[i].o
          ? -1.7 * h0 - 0.8 * h1 + bars[i].c
          : 0.2 * h0 - 0.8 * h1 + bars[i].c
        h1 = h0
        h0 = next
        trail.push(next)
        worst = Math.max(worst, Math.abs(next))
      }
      return { worst, trail }
    }
    const fromPrice = runFrom(100)
    const fromZero = runFrom(0)
    // It leaves the price scale by more than twelve orders of magnitude…
    expect(fromPrice.worst).toBeGreaterThan(1e12 * 100)
    // …and WHERE IT STARTED still decides the answer on every single bar, which is
    // the one property `accum`'s fixed re-seed cannot tolerate.
    expect(fromPrice.trail.filter((v, i) => v !== fromZero.trail[i]).length).toBe(N)
  })

  it('⛔ the switch stays shut under `min`/`max` and `nz` too, not only `?:`', () => {
    // Those are the other places `ok()` takes a branch. A multi-lag form under any
    // of them is the same switched system wearing another spelling.
    for (const body of [`max(${ARM_A}, close)`, `min(${ARM_A}, close)`, `nz(${ARM_A}, close)`]) {
      const r = translatePine(script(body)).refusal
      expect(r, body).toBeTruthy()
      expect(r.guard, body).toBe('pine:state')
    }
  })
})

/**
 * ⭐⭐ WHAT THE WIDENING ACTUALLY BUYS: ONE LINEAR FORM OVER SEVERAL LAGS.
 *
 * The residual is not reasoned about from a spectral radius — `ρ(A) < 1` is an
 * ASYMPTOTIC statement and `accum` re-seeds at a FIXED distance, and for a
 * repeated root (every critically-damped filter, Ehlers included) the `n·ρⁿ` term
 * makes the two answers differ by orders of magnitude. The gate walks the
 * interpreter's own shift register for exactly `warmup` steps instead.
 */
describe('⭐ a single linear form over several lags folds, and the NUMBER is right', () => {
  const spec = TABLE.functions.accum
  const BODY = '0.6 * x - 0.08 * x[2] + 0.48 * close'
  const built = translatePine(`//@version=5
indicator("t")
var x = close
x := ${BODY}
plot(x)
`)

  const bars = (n) => Array.from({ length: n }, (_, i) => {
    const c = 100 + (i % 11) - 5 + Math.sin(i / 5)
    return { t: 20260101 + i, o: c, h: c + 1, l: c - 1, c, v: 100 }
  })

  it('it translates, and to a body carrying BOTH lags', () => {
    expect(built.refusal, built.refusal && built.refusal.message).toBe(null)
    expect(built.outputs[0].ast.name).toBe('accum')
    expect(printFormula(built.outputs[0].ast.args[spec.recurrence.body]))
      .toBe('0.6 * self - 0.08 * self[1] + 0.48 * close')
  })

  it('⭐⭐ the column matches the accumulator`s own window, simulated independently', () => {
    const ast = built.outputs[0].ast
    const warmup = ast.args[spec.recurrence.warmup].value
    const rows = bars(warmup + 40)
    const col = interpret(ast, rows)
    const t = rows.length - 1
    // `var x = close` — the seed is the close on the bar the window opens at, and
    // it fills EVERY lag, which is the initial condition `interpret.js` states.
    let h0 = rows[t - warmup].c
    let h1 = h0
    for (let j = t - warmup + 1; j <= t; j += 1) {
      const next = 0.6 * h0 - 0.08 * h1 + 0.48 * rows[j].c
      h1 = h0
      h0 = next
    }
    expect(col[t]).toBeCloseTo(h0, 9)
  })

  it('⭐⭐ …AND the unbounded recurrence Pine actually runs — the gate`s own claim', () => {
    // ⛔ THE TEST ABOVE ONLY CHECKS THE TREE. This one checks the RULE: the gate
    // admitted this body because the seed is forgotten inside the warm-up, so a run
    // from the very first bar — which is what Pine does — has to land on the same
    // number. If the threshold were decoration these two would disagree.
    const ast = built.outputs[0].ast
    const rows = bars(ast.args[spec.recurrence.warmup].value + 40)
    const col = interpret(ast, rows)
    let h0 = rows[0].c
    let h1 = h0
    for (let j = 1; j < rows.length; j += 1) {
      const next = 0.6 * h0 - 0.08 * h1 + 0.48 * rows[j].c
      h1 = h0
      h0 = next
    }
    expect(col[rows.length - 1]).toBeCloseTo(h0, 9)
  })

  it('⭐⭐ THE BOUNDARY, from both sides — and it is NOT the spectral radius', () => {
    // A critically-damped 2-pole filter `x := 2p·x - p²·x[1] + …` has BOTH roots at
    // `p`, so `ρ**250` UNDER-STATES the surviving seed by a factor of n. Derived
    // here rather than retyped, and the pair either side of the tolerance is what
    // shows the threshold does work.
    const residual = (p) => {
      let h0 = 1
      let h1 = 1
      for (let i = 0; i < 250; i += 1) {
        const next = 2 * p * h0 - p * p * h1
        h1 = h0
        h0 = next
      }
      return Math.abs(h0)
    }
    const fold = (p) => translatePine(`//@version=5
indicator("t")
var x = close
x := ${2 * p} * x - ${p * p} * x[2] + ${(1 - p) ** 2} * close
plot(x)
`)
    // ⛔ THE POINT OF THIS PAIR: at BOTH of these the root alone survives less than
    // the tolerance, so a gate reading `ρ**250` would admit both — and the filter
    // at 0.945 in fact carries far more of its seed than the tolerance allows.
    expect(0.93 ** 250).toBeLessThan(SEED_RESIDUAL_TOLERANCE)
    expect(0.945 ** 250).toBeLessThan(SEED_RESIDUAL_TOLERANCE)
    expect(residual(0.93)).toBeLessThanOrEqual(SEED_RESIDUAL_TOLERANCE)
    expect(residual(0.945)).toBeGreaterThan(SEED_RESIDUAL_TOLERANCE)
    expect(fold(0.93).refusal).toBe(null)
    expect(fold(0.945).refusal.guard).toBe('pine:state')
  })

  it('🏁 THE ENGINE`S OWN KEYSTONE FIXTURE, REACHED FROM PINE FOR THE FIRST TIME', () => {
    // ⭐⭐ `tests/fixtures/ast/self_lag_parity.json` is a 2-pole Butterworth
    // SuperSmoother — `accum(close, c1·(close + close[1])/2 + c2·self + c3·self[1],
    // …)` — and its own header calls itself "authored entirely in the formula box".
    // ⛔ THAT WORD WAS THE WHOLE GAP: both lanes have agreed on this column to
    // 1e-9 since `self[k]` landed, and no member could ever get one, because the
    // only door onto it was the formula box. Pine is where these are PUBLISHED.
    // The coefficients are read off that fixture's own `_why` line.
    const out = translatePine(`//@version=4
study("t")
c2 = 1.36612
c3 = -0.64125
c1 = 1 - c2 - c3
ss = c1 * (close + close[1]) / 2 + c2 * nz(ss[1], close) + c3 * nz(ss[2], close)
plot(ss)
`)
    expect(out.refusal, out.refusal && out.refusal.message).toBe(null)
    const ast = out.outputs[0].ast
    expect(ast.name).toBe('accum')
    expect(printFormula(ast.args[spec.recurrence.seed])).toBe('close')
    // Both lags present, the `nz` wrappers gone, and the sign of `c3` preserved.
    const body = printFormula(ast.args[spec.recurrence.body])
    expect(body).toContain(`${spec.recurrence.binds}[1]`)
    expect(body).toContain('1.36612')
    expect(body).toContain('0.64125')
    expect(body).not.toContain('nz(')
  })

  it('⛔ an averaging pair never forgets — `(x + x[2]) / 2` still refuses', () => {
    // It is multi-lag AND unswitched, so the widening reaches it and the ARITHMETIC
    // turns it away: the coefficients sum to one, the sensitivity sits at exactly 1
    // forever, and the seed is fully present after any warm-up. ⚠️ The same shape is
    // pinned above for the reason it refused BEFORE ("unknown"); this asserts it
    // still refuses now that the answer is known.
    expect(translatePine(`//@version=5
indicator("t")
var x = close
x := (x + x[2]) / 2
plot(x)
`).refusal.guard).toBe('pine:state')
  })

  it('⛔ a lag deeper than the interpreter holds refuses AT THE PINE DOOR', () => {
    // `MAX_SELF_LAG` is imported from `interpret.js`, so a body reaching further
    // back would translate here and then refuse at evaluation — a refusal at a door
    // the member never typed at. ⚠️ Pine counts from the previous bar, so `x[k]` is
    // `self[k - 1]` and the deepest legal spelling is `x[MAX_SELF_LAG + 1]`.
    const at = (k) => translatePine(`//@version=5
indicator("t")
var x = close
x := 0.5 * x - 0.01 * x[${k}] + close
plot(x)
`)
    expect(at(MAX_SELF_LAG + 1).refusal, `x[${MAX_SELF_LAG + 1}]`).toBe(null)
    expect(at(MAX_SELF_LAG + 2).refusal.guard, `x[${MAX_SELF_LAG + 2}]`).toBe('pine:state')
  })
})

/**
 * ⭐⭐ THE SECOND SPELLING OF A FIRST-BAR VALUE: `nz(self…, SEED)`.
 *
 * `na(x[1]) ? SEED : UPDATE` is one way a script states where its recurrence
 * starts. `nz(x[1], SEED)` is the other, and it is the one the DSP family uses,
 * because a ternary cannot supply an initial value for TWO lags at once. Both are
 * answered by `seedAndUpdateOf`, which `thinkscript.js` imports — one rule, both
 * doors, never a second copy.
 */
describe('⭐ `nz(x[1], seed)` states a first-bar value and the accumulator takes it', () => {
  const spec = TABLE.functions.accum
  const pine = (body) => translatePine(`//@version=4
study("t")
${body}
plot(x)
`)

  it('⭐ the seed is what the SCRIPT said, and the wrapper is gone from the body', () => {
    const out = pine('x = 0.5 * nz(x[1], close) + 0.5 * open')
    expect(out.refusal, out.refusal && out.refusal.message).toBe(null)
    const ast = out.outputs[0].ast
    expect(ast.name).toBe('accum')
    expect(printFormula(ast.args[spec.recurrence.seed])).toBe('close')
    expect(printFormula(ast.args[spec.recurrence.body])).toBe('0.5 * self + 0.5 * open')
  })

  it('⭐ the one-argument `nz(x[1])` seeds at the zero Pine itself uses', () => {
    const ast = pine('x = 0.5 * nz(x[1]) + 0.5 * open').outputs[0].ast
    expect(printFormula(ast.args[spec.recurrence.seed])).toBe('0')
  })

  it('⛔ TWO DIFFERENT SEEDS have nowhere to go — `accum` has one seed slot', () => {
    expect(pine('x = 0.5 * nz(x[1], close) + 0.2 * nz(x[2], open) + 0.3 * hl2')
      .refusal.guard).toBe('pine:state')
  })

  it('⛔ an UNWRAPPED lag beside a wrapped one refuses — Pine draws `na` there', () => {
    // `nz(x[1], s) + x[2]` is unknown on the first bar in Pine itself and NaN
    // propagates forever, so translating it as if the seed covered both lags would
    // draw a line the script never draws.
    expect(pine('x = 0.5 * nz(x[1], close) + 0.2 * x[2] + 0.3 * hl2')
      .refusal.guard).toBe('pine:state')
  })

  it('⛔ `nz(<expression>, s)` is a NaN guard, not an initial condition', () => {
    expect(pine('x = 0.5 * nz(x[1] + open, close) + 0.5 * open')
      .refusal.guard).toBe('pine:state')
  })

  it('⛔⛔ and the convergence gate still runs afterwards — a total is still refused', () => {
    // THE CONTROL THAT MATTERS MOST: reading a new seed spelling must not become a
    // way around the gate. `nz(x[1], 0) + close` is OBV by hand.
    expect(pine('x = nz(x[1], 0) + close').refusal.guard).toBe('pine:state')
  })
})

/**
 * 🏁 THE PUBLISHED SCRIPT THE WHOLE WIDENING IS FOR.
 * `pine_community/10-ehlers-instantaneous-trend-lazybear.pine`, byte for byte as
 * LazyBear published it. A shape gate is not the claim — the ARITHMETIC is.
 */
describe('🏁 Ehlers` Instantaneous Trendline translates AND computes', () => {
  const spec = TABLE.functions.accum
  const SRC = fs.readFileSync(path.resolve(process.cwd(),
    '../tests/fixtures/pine_community/10-ehlers-instantaneous-trend-lazybear.pine'), 'utf8')

  it('⭐ it translates to a 2-pole accumulator whose number matches the formula', () => {
    const out = translatePine(SRC)
    expect(out.refusal, out.refusal && out.refusal.message).toBe(null)
    const row = out.outputs.find((o) => o.ast && o.ast.name === 'accum')
    expect(row, 'no accumulator among the outputs').toBeTruthy()
    const ast = row.ast
    const warmup = ast.args[spec.recurrence.warmup].value

    // `src` is `hl2`, so `h = c + 1, l = c - 1` makes it exactly `c`.
    const rows = Array.from({ length: warmup + 60 }, (_, i) => {
      const c = 100 + (i % 13) - 6 + Math.sin(i / 4) * 1.5
      return { t: 20260101 + i, o: c, h: c + 1, l: c - 1, c, v: 100 }
    })
    const col = interpret(ast, rows)

    // The published line, transcribed from the fixture and simulated over the
    // accumulator's own window. `a` is the script's own `input(0.07)` default.
    const a = 0.07
    const src = rows.map((r) => (r.h + r.l) / 2)
    const t = rows.length - 1
    const start = t - warmup
    const seed = (src[start] + 2 * src[start - 1] + src[start - 2]) / 4.0
    let h0 = seed
    let h1 = seed
    for (let j = start + 1; j <= t; j += 1) {
      const next = (a - ((a * a) / 4.0)) * src[j]
        + 0.5 * a * a * src[j - 1]
        - (a - 0.75 * a * a) * src[j - 2]
        + 2 * (1 - a) * h0
        - (1 - a) * (1 - a) * h1
      h1 = h0
      h0 = next
    }
    expect(col[t]).toBeCloseTo(h0, 9)

    // ⭐ AND THE CONTROL THAT MAKES THE NUMBER MEAN SOMETHING: an instantaneous
    // TRENDLINE tracks price, so the column must sit near it rather than at the
    // seed or at zero. A body folded to the wrong tree passes a shape assertion.
    expect(Math.abs(col[t] - src[t])).toBeLessThan(10)
    expect(col[t]).not.toBe(seed)
  })
})
