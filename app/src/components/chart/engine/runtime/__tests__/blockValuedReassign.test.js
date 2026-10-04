// app/src/components/chart/engine/runtime/__tests__/blockValuedReassign.test.js
//
// ─── ⭐⭐ `x := if …` AND `x := switch …` — THE FOURTH POSITION ─────────────
//
// Pine's `if` and `switch` are EXPRESSIONS. This lane serves them in a plain
// binding and in a function body; it did not serve them in a REASSIGNMENT:
//
//     x = if c …           ✅   x = switch s …           ✅
//     f() => if c …        ✅   (function body)
//     x := if c …          ⛔   x := switch s …          ⛔   pine:block
//
// ⛔ AND THE REASON IS A TOKEN, NOT A DECISION. The binding path finds its RHS
// with `findTop(toks, isPunct('='))` — but `:=` LEXES AS ONE TOKEN, so that
// search returns −1 for a reassignment and the block-valued branch was never
// reached. The walrus branch then called `parseWholeExpression` on `switch s`,
// which is where the refusal came from. The sentence a member read,
// *"a Pine block spans several statements and this engine stores a single
// expression"*, is a true statement about the COLUMNAR value model said about a
// lane that has statements, slots and `ifStmt`.
//
// ⭐ MEASURED on the committed corpus before building:
//
//     x := if       14 sites across  3 scripts
//     x := switch    9 sites across  6 scripts
//     var x = …      6 sites across  4 scripts   ← NOT served, see below
//
// ⛔ THE SWITCH LOWERING IS EXTRACTED, NOT COPIED. It now lives beside the
// if-chain helper and the arm rule, so a binding and a reassignment cannot drift
// about what an arm yields, what an armless `switch` refuses, or whether a later
// case runs once an earlier one matched. That is the same extraction the
// function-body form forced, for the same reason.
//
// ⚠️ `var x = if|switch` WAS REFUSED HERE until a once-only guard existed: `var`
// initialises ONCE — the value is computed on the first bar and kept — and
// lowering it like a plain binding would re-evaluate the block every bar and
// silently make `var` mean nothing. RT14 built the guard (a persistent flag
// declared once around the chain); the two controls below now pin the ONCE.
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const N = 6
const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1700000000 + i * 86400, o: 100, h: 102 + i, l: 98, c: 100 + i, v: 1000,
}))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const head = '//@version=5\nindicator("t")\n'

function run(src) {
  const built = buildRuntimeIr(src, { bars: BARS, inputs: {} })
  expect(built.ok, built.ok ? '' : `${built.refusal.guard}: ${built.refusal.message}`).toBe(true)
  const program = lowerIrProgram(built.ir)
  const r = execute(program, {
    bars: N, series: SERIES, columns: program.columns, confirmed: true,
    barTimes: BARS.map((b) => b.t),
  })
  return Array.from(r.outputs[0])
}
const refusalOf = (src) => {
  const b = buildRuntimeIr(src, { bars: BARS, inputs: {} })
  expect(b.ok, 'expected a refusal').toBe(false)
  return b.refusal
}

describe('⭐⭐ a block in value position on the right of `:=`', () => {
  it('⛔ CONTROL — the fixture can DISTINGUISH the arms', () => {
    // ⭐ NON-VACUITY first: `close` is 100..105, so `close > 102` is false on
    // three bars and true on three. A lowering that always took one arm would
    // otherwise satisfy every numeric assertion below.
    expect(new Set(BARS.map((b) => b.c > 102)).size).toBe(2)
  })

  it('⭐⭐ `x := if … else …`', () => {
    const out = run(`${head}x = 0.0\nx := if close > 102\n    1\nelse\n    2\nplot(x)\n`)
    expect(out).toEqual(BARS.map((b) => (b.c > 102 ? 1 : 2)))
  })

  it('⭐⭐ `x := if` with NO else yields `na` on an unmatched bar', () => {
    // ⛔ PINE'S SEMANTICS. An `if` that does not match has no value, so the
    // reassignment writes `na` — it does NOT leave the previous value in place.
    // Seeding anything else would hand a member a confident number for a branch
    // their script never took.
    const out = run(`${head}x = 0.0\nx := if close > 102\n    1\nplot(x)\n`)
    for (let b = 0; b < N; b += 1) {
      if (BARS[b].c > 102) expect(out[b], `bar ${b}`).toBe(1)
      else expect(Number.isNaN(out[b]), `bar ${b} should be na`).toBe(true)
    }
  })

  it('⭐⭐ `x := switch <subject>`', () => {
    const out = run(`${head}s = 1\nx = 0.0\nx := switch s\n    1 => 10\n    2 => 20\n    => 30\nplot(x)\n`)
    expect(out).toEqual(BARS.map(() => 10))
  })

  it('⭐ `x := switch` with NO subject is a condition ladder', () => {
    // ⛔ THE CASE THAT SEPARATES A REAL LOWERING FROM A CONSTANT FOLD: a
    // subject-less switch takes boolean arms, and an arm that moves bar to bar
    // cannot be folded at all.
    const out = run(`${head}x = 0.0\nx := switch\n    close > 102 => 1\n    => 2\nplot(x)\n`)
    expect(out).toEqual(BARS.map((b) => (b.c > 102 ? 1 : 2)))
  })

  it('⛔ CONTROL — the plain BINDING form is unchanged (shared machinery)', () => {
    // ⚰️ The switch lowering was EXTRACTED for this change, not copied. If the
    // extraction altered what a binding means, this is what says so.
    expect(run(`${head}s = 1\nx = switch s\n    1 => 10\n    => 20\nplot(x)\n`))
      .toEqual(BARS.map(() => 10))
    expect(run(`${head}x = if close > 102\n    1\nelse\n    2\nplot(x)\n`))
      .toEqual(BARS.map((b) => (b.c > 102 ? 1 : 2)))
  })

  // ⚰️ RE-PINNED BY RT14 (2026-10-04), with the measured reason: these two
  // CONTROLS pinned the refusal *"`var x = if|switch …` initialises ONCE, and this
  // lane has no once-only guard around a block yet"*. RT14 built that guard (a
  // second persistent slot, declared `0` once, around the chain), so the controls
  // now pin what the refusal protected: the block is evaluated on the FIRST bar
  // only and its value kept — never re-evaluated every bar.
  it('⛔⛔ `var x = switch` initialises ONCE (RT14 — it refused until the guard existed)', () => {
    // `s` moves bar to bar, so a re-evaluated switch would change with it.
    const out = run(`${head}s = close > 102 ? 1 : 2
var x = switch s
    1 => 10
    => 20
plot(x)
`)
    expect(out).toEqual(BARS.map(() => 20))
  })

  it('⛔ `var x = if` initialises ONCE too, by the same branch', () => {
    // ⛔ THE SECOND HALF OF ONE PREDICATE (`varBlk.value === 'if' || … 'switch'`).
    const out = run(`${head}var x = if close > 102
    1
else
    2
plot(x)
`)
    expect(out).toEqual(BARS.map(() => 2))
  })

  it('⛔ CONTROL — `varip x = if` still refuses BY NAME (intrabar persistence)', () => {
    const r = refusalOf(`${head}varip x = if close > 102
    1
else
    2
plot(x)
`)
    expect(['runtime:varip', 'runtime:block-value']).toContain(r.guard)
  })

  it('⛔ CONTROL — an armless `switch` still refuses BY NAME', () => {
    const r = refusalOf(`${head}x = 0.0\nx := switch close\nplot(x)\n`)
    expect(r.guard).toBe('runtime:block-value')
  })

  it('⛔ CONTROL — reassigning a name that was never bound still says so', () => {
    const r = refusalOf(`${head}zzNope := if close > 102\n    1\nelse\n    2\nplot(close)\n`)
    expect(r.ok).toBeUndefined()
    expect(r.guard).not.toBe('runtime:block-value')
    // ⭐ ONE SENTENCE FOR ONE CONDITION. The plain `:=` path already refused an
    // unbound reassignment by this name; the block-valued path asks the SAME
    // helper rather than inventing a second wording.
    expect(r.guard).toBe('runtime:unbound')
    expect(r.message).toMatch(/before it is declared/)
  })

  it('⛔⛔ A COMMA LINE IS NAMED AS A COMMA LINE, never as an undefined name', () => {
    // ⚰️ THE FIRST DRAFT OF THIS BRANCH SHIPPED A FALSE SENTENCE, and the corpus
    // caught it. `3-level-zigzag-semafor:18` reads
    //
    //     int _direction = na , _direction := switch
    //
    // which binds `_direction` ON THAT LINE. Saying nothing in the script binds
    // it is RC-G's defect — telling a member their script never defined a name
    // it plainly defines. The cause is Pine's COMMA STATEMENT SEPARATOR, which
    // `pine.js::blockStatements` splits only for a line with NO block beneath it.
    //
    // ⭐⭐ H2 (step 69): `blockStatements` NOW SPLITS THAT LINE — every segment a
    // binding or a bare-name `:=`, the block opened by the LAST one — so the
    // binding reaches this scope and the switch lowers (below). The comma
    // sentence is still owed to a comma line the reader does NOT split: here the
    // opener sits in the FIRST segment, so the arms have no honest owner.
    const r = refusalOf(`${head}d := switch , e = 1\n    close > 102 => 1\n    => 2\nplot(close)\n`)
    expect(r.guard).toBe('runtime:statement')
    expect(r.message).toMatch(/,/)
    expect(r.message).not.toMatch(/nothing in this script binds/)
  })

  it('⭐⭐ H2 — the split comma line lowers as the two statements Pine runs', () => {
    // the same values as writing `int d = na` and `d := switch …` on two lines
    const out = run(`${head}int d = na , d := switch\n    close > 102 => 1\n    => 2\nplot(d)\n`)
    expect(out).toEqual(run(`${head}int d = na\nd := switch\n    close > 102 => 1\n    => 2\nplot(d)\n`))
    expect(out).toEqual(BARS.map((b) => (b.c > 102 ? 1 : 2)))
  })

  it('⛔ CONTROL — a comma INSIDE a call is not a statement separator', () => {
    // ⛔ THE DISCRIMINATOR. Without it the comma branch could fire on every
    // reassignment whose right-hand side takes two arguments, and the check
    // would be reporting its own shape rather than the script's
    // (`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`).
    const r = refusalOf(`${head}zzNope := nz(close, 0)\nplot(close)\n`)
    expect(r.guard).toBe('runtime:unbound')
    expect(r.message).toMatch(/before it is declared/)
  })
})
