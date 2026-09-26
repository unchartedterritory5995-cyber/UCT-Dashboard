// app/src/components/chart/engine/runtime/__tests__/callForEffect.test.js
//
// ─── ⭐⭐ `f(x)` ON A LINE OF ITS OWN — PINE'S CALL-FOR-EFFECT STATEMENT ──────
//
// Twelve of the 266 committed scripts die on `runtime:expression-statement`,
// and ten of them are this one shape: a helper called as a STATEMENT —
// `zigzag(Length, DeviationThreshold)`, `generate_strikes(nStrikes)`,
// `vline(bar_index)`, `FVGDetector(a, b, c, d)`. The helper opens the lines,
// pushes the labels and mutates the arrays it was handed; its RESULT (§16 — the
// value of its last statement) is thrown away.
//
// ⚰️ IT REFUSED `runtime:expression-statement` — *"an expression evaluated for
// effect — nothing in this runtime has an effect yet"* — a sentence that
// stopped being true the moment `array.push(a, x)` was admitted as a statement
// two branches above it. This lane has arrays, loops and imperative state; a
// call is how a script reaches them.
//
// ⛔⛔ THE EFFECT TRAVELS THROUGH A PARAMETER, NOT A GLOBAL, AND THAT IS THE
// SHAPE THESE FIXTURES HAVE TO USE. A function body reading a mutable global is
// a SEPARATE, live refusal (`runtime:function-global-state` — "a frame has no
// address for one yet"), so a fixture written the global way tests that guard
// and never reaches this one. Pine arrays are REFERENCE types, so a collection
// handed in as an argument is the same array the caller holds, and mutating it
// is an effect the caller can see. That is the only effect this lane can
// currently carry on its own, and it is a real one.
//
// ⛔⛔ THE WHOLE RISK IS THE STACK, WHICH IS WHY EVERY CASE HERE RUNS THE VM.
// A call pushes its result. A statement reads none of it. Lowering the call and
// forgetting the discard leaves one value per bar on a stack that is allocated
// ONCE for the entire run — not a leak that clears next bar, an accumulation
// that kills the run thousands of bars from the line that caused it. `vm.js`'s
// end-of-bar `sp !== 0` rail catches it on bar 0 instead, and these tests are
// what make that rail fire: an IR-shape assertion alone would pass against a
// lowering that never emitted the DROP at all.
//
// ⛔ AND THE TUPLE CASE IS NOT DECORATION. A helper whose last statement is
// `[a, b]` leaves TWO values. A `DROP 1` — the shape anyone writing this from
// the single-value case would reach for — passes every other case in this file
// and leaves exactly one value behind per bar.
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'
import { OP } from '../program.js'
import { makeIrProgram, exprStmt, emit, num, arrayCall, SLOT } from '../ir.js'

const N = 5
const BARS = Array.from({ length: N }, (_, i) => (
  { t: 1700000000 + i * 86400, o: 99 + i, h: 101 + i, l: 98 + i, c: 100 + i, v: 1000 + i }))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const head = '//@version=6\nindicator("t", overlay = true)\n'

function build(src) {
  const built = buildRuntimeIr(head + src, { bars: BARS, inputs: {} })
  if (!built.ok) throw new Error(`refused ${built.refusal.guard}: ${built.refusal.message}`)
  return built
}

function runPine(src) {
  const program = lowerIrProgram(build(src).ir)
  const { outputs } = execute(program, {
    bars: N, series: SERIES, columns: program.columns, confirmed: true,
  })
  return Array.from(outputs[0])
}

const refusalOf = (src) => {
  const built = buildRuntimeIr(head + src, { bars: BARS, inputs: {} })
  expect(built.ok, 'expected a refusal, got a program').toBe(false)
  return built.refusal
}

/** How many values each DROP in a lowered program discards. */
const drops = (program) => {
  const out = []
  for (let pc = 0; pc * 3 < program.code.length; pc += 1) {
    if (program.code[pc * 3] === OP.DROP) out.push(program.code[pc * 3 + 1])
  }
  return out
}

// ⛔ RULE 5 — A COMPUTED ARGUMENT THROUGHOUT. A literal argument folds to a
// constant before the call is even lowered, which leaves the argument-binding
// path — the half that can actually be wrong — completely unrailed. `close >
// open` holds on every bar of this fixture, so the helper receives `high`.
const ARG = 'close > open ? high : low'
const PUSH = 'bump(dst, x) =>\n    array.push(dst, x)\n    array.size(dst)\n'
const PAIR = 'pair(dst, x) =>\n    array.push(dst, x)\n    [array.size(dst), x * 2]\n'

describe('⭐⭐ a user function called as a statement, for its effect', () => {
  it('⛔ CONTROL — the SAME helper in VALUE position already worked', () => {
    // Without this, every pass below could read as "calls work now" rather than
    // "the STATEMENT form works now", and the capability under test would be
    // invisible.
    expect(runPine(
      `var a = array.new_float(0)\n${PUSH}n = bump(a, ${ARG})\nplot(n)\n`))
      .toEqual([1, 2, 3, 4, 5])
  })

  it('⭐⭐ the EFFECT HAPPENS — the array the helper pushes to grows every bar', () => {
    // ⛔ THE ASSERTION IS THE EFFECT, NOT `ok`. A "fix" that compiled the line
    // and SKIPPED it returns a program, passes any shape check, and leaves this
    // array empty on every bar — real numbers from a run that did not happen.
    expect(runPine(
      `var a = array.new_float(0)\n${PUSH}bump(a, ${ARG})\nplot(array.size(a))\n`))
      .toEqual([1, 2, 3, 4, 5])
  })

  it('⭐ and the VALUE pushed is the COMPUTED argument, not a folded constant', () => {
    expect(runPine(
      `var a = array.new_float(0)\n${PUSH}bump(a, ${ARG})\n`
      + 'plot(array.get(a, array.size(a) - 1))\n'))
      .toEqual([101, 102, 103, 104, 105])
  })

  it('⛔⛔ the stack balances — the VM\'s own end-of-bar invariant, twice per bar', () => {
    // `execute` throws "left N value(s) on the stack" if the discard is missing
    // or undercounts, so reaching an answer at all is half the proof and the
    // doubled call is the other half: a leak of one per bar compounds.
    expect(runPine(
      `var a = array.new_float(0)\n${PUSH}bump(a, ${ARG})\nbump(a, ${ARG})\n`
      + 'plot(array.size(a))\n'))
      .toEqual([2, 4, 6, 8, 10])
  })

  it('⛔⛔ A TUPLE-RETURNING HELPER DISCARDS BOTH VALUES, not the top one', () => {
    expect(runPine(
      `var a = array.new_float(0)\n${PAIR}pair(a, ${ARG})\nplot(array.size(a))\n`))
      .toEqual([1, 2, 3, 4, 5])
  })

  it('⛔ and the DROP carries the tuple\'s OWN width — 2, not 1', () => {
    const one = lowerIrProgram(build(
      `var a = array.new_float(0)\n${PUSH}bump(a, ${ARG})\nplot(array.size(a))\n`).ir)
    const two = lowerIrProgram(build(
      `var a = array.new_float(0)\n${PAIR}pair(a, ${ARG})\nplot(array.size(a))\n`).ir)
    expect(drops(one)).toEqual([1])
    expect(drops(two)).toEqual([2])
  })

  it('⭐ inside an `if`, which is where the corpus sites actually sit', () => {
    // `generate_strikes(nStrikes)` is written under `if should_update`. A
    // discard emitted only at top level would compile and then unbalance the
    // stack on exactly the bars the branch runs.
    expect(runPine(
      `var a = array.new_float(0)\n${PUSH}if close > 101\n    bump(a, ${ARG})\n`
      + 'plot(array.size(a))\n'))
      .toEqual([0, 0, 1, 2, 3])
  })

  it('⭐ and inside ANOTHER helper\'s body — one call-for-effect nested in a second', () => {
    expect(runPine(
      `var a = array.new_float(0)\n${PUSH}`
      + 'outer(dst, x) =>\n    bump(dst, x)\n    array.size(dst)\n'
      + `outer(a, ${ARG})\nplot(array.size(a))\n`))
      .toEqual([1, 2, 3, 4, 5])
  })

  it('⭐ inside a `for` body — the discard runs once per ITERATION', () => {
    expect(runPine(
      `var a = array.new_float(0)\n${PUSH}for i = 0 to 2\n    bump(a, ${ARG})\n`
      + 'plot(array.size(a))\n'))
      .toEqual([3, 6, 9, 12, 15])
  })

  it('⛔ a name that is NOT a user function still refuses, by its own name', () => {
    // The admission must not become a catch-all: `nope()` is undefined, and
    // "an expression evaluated for effect" is the honest thing to say about it.
    const r = refusalOf('nope(close)\nplot(close)\n')
    expect(r.guard).toBe('runtime:expression-statement')
    expect(r.message).toContain('nope()')
  })

  it('⛔ and an array method this runtime does not hold keeps ITS name', () => {
    // A placement rail: the user-function branch sits AFTER the method-form
    // block, so `a.reverse()` must still be answered by the collection roster
    // rather than swallowed here.
    const r = refusalOf('a = array.new_float(0)\na.reverse()\nplot(array.size(a))\n')
    expect(r.guard).toBe('runtime:array')
    expect(r.message).toContain('array.reverse')
  })

  it('⛔ a helper that reads a mutable GLOBAL still refuses that, by name', () => {
    // ⭐ THE SECOND WALL, PINNED. Admitting the statement form did not admit
    // global access, and the corpus scripts that write `generate_strikes()`
    // against a global `var strikes` now land HERE. Recording it means the
    // census row that replaced `expression-statement` is not a surprise.
    const r = refusalOf(
      'var a = array.new_float(0)\n'
      + 'bump(x) =>\n    array.push(a, x)\n    array.size(a)\n'
      + `bump(${ARG})\nplot(array.size(a))\n`)
    expect(r.guard).toBe('runtime:function-global-state')
  })
})

// --------------------------------------------------------------------------- //
// ⛔ THE ARTIFACT BOUNDARY — `drop` IS CHECKED WHERE THE IR IS CHECKED
// --------------------------------------------------------------------------- //
//
// ⛔⛔ THESE ARE HERE BECAUSE THE VALIDATOR'S `drop` ARM IS UNREACHABLE FROM
// PINE. The front end is the only producer, and it can only ever pass
// `fn.returns`, which is a positive integer by construction — so a mutation
// that deletes the check survives every test above. The IR is a PUBLIC artifact
// (`makeIrProgram` is exported and `iterOutputs.test.js`, `state.test.js` and
// `drawingAsValue.test.js` all hand-build one), so the guard is reachable by the
// people it is written for, and it is proved from there rather than kept as
// protection nothing can fire (`lesson_a_guard_repeated_is_a_guard_unproved`).
describe('⛔ the IR refuses a `drop` the stack arithmetic cannot survive', () => {
  const withDrop = (drop) => makeIrProgram({
    statements: [
      { ...exprStmt(arrayCall('array.push', [num(0), num(1)]), 0), drop },
      emit(0, num(1)),
    ],
    slots: [{ name: 'a', kind: SLOT.LOCAL }],
    columns: [],
    outputs: [{ name: 'p', kind: 'plot' }],
  })

  it('⛔ CONTROL — a valid drop builds, so the refusals below are not vacuous', () => {
    expect(() => withDrop(0)).not.toThrow()
    expect(() => withDrop(2)).not.toThrow()
  })

  it('⛔ a NEGATIVE drop is named — below zero it hands back another frame\'s values', () => {
    expect(() => withDrop(-1)).toThrow(/drop must be a non-negative integer/)
  })

  it('⛔ and a FRACTIONAL one, which would leave `sp` off the integer grid', () => {
    expect(() => withDrop(1.5)).toThrow(/drop must be a non-negative integer/)
  })
})
