// app/src/components/chart/engine/runtime/__tests__/functionBodyBlockValue.test.js
//
// ─── ⭐⭐ A FUNCTION WHOSE BODY *IS* AN `if` — THE THIRD POSITION ────────────
//
// Pine's `if` is an EXPRESSION, and this engine already serves it in two of the
// three positions it can appear in:
//
//     x = if c            ✅ the block-valued BINDING (shipped)
//         1
//     else
//         2
//
//     if c                ✅ the statement form (shipped)
//         v := 1
//     else
//         v := 2
//
//     f(c) =>             ⛔ THE THIRD, and it refused `runtime:statement`
//         if c
//             1
//         else
//             2
//
// ⛔⛔ THE SPLIT IS WHAT BREAKS IT, AND IT IS NOT OBVIOUS. A function body is
// lowered as `lowerStmts(lines.slice(0, -1))` plus a RESULT taken from the last
// line — because Pine returns the value of the last statement (§16). But an
// `if`/`else` chain occupies SEVERAL entries of that list: the `if` is one, each
// `else if` is another, the `else` is another. So `slice(0, -1)` hands the `if`
// to the statement lowerer and leaves the bare `else` as "the result
// expression", which parses as nothing at all. The refusal named the statement
// shape; the cause was the split.
//
// ⭐⭐ SO THE FIX FINDS WHERE THE TRAILING CHAIN BEGINS, not just what the last
// line is — and it lowers that chain with THE SAME CODE the binding form uses.
//
// ⛔ ONE IMPLEMENTATION, NOT TWO. The binding form's chain logic was extracted
// to a shared helper rather than copied: two copies of "what does an unmatched
// arm yield" is exactly the second-authority defect this engine has paid for
// repeatedly, and RC-F is the standing example — a mutation SURVIVED there
// because the same rule had been written twice. The mutation proof for this
// change breaks the shared helper and watches BOTH sites go red.
//
// ⚠️ SIZED BEFORE IT WAS BUILT, and the number is not the exciting one: **57
// corpus scripts contain an if-bodied user function across 147 sites (21% of
// the corpus), but only 9 are blocked by it TODAY** — the other 48 stop at one
// of 24 other guards first. This ships because Pine has one `if` and this engine
// should too, not because it moves a build count.
import { describe, it, expect } from 'vitest'

import fs from 'node:fs'
import path from 'node:path'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const N = 6
const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1700000000 + i * 86400, o: 100, h: 102 + i, l: 98, c: 100 + i, v: 1000,
}))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const CORPUS = path.resolve(__dirname, '../../../../../../../corpus/committed')
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

// `close` is 100..105, so `close > 102` is false, false, false, true, true, true.
const TEST = 'close > 102'

describe('⭐⭐ a user function whose body is an `if`', () => {
  it('⛔ CONTROL — the fixture can DISTINGUISH the two arms', () => {
    // ⭐⭐ NON-VACUITY, first. Every case below reads a per-bar value; if the
    // test were constant, or the arms returned the same number, a lowering that
    // always took one branch would pass every assertion here.
    const flags = BARS.map((b) => (b.c > 102 ? 1 : 0))
    expect(new Set(flags).size).toBe(2)
  })

  it('⭐⭐ `if` / `else` as the whole body', () => {
    const out = run(`${head}f(c) =>\n    if c\n        1\n    else\n        2\nplot(f(${TEST}))\n`)
    expect(out).toEqual(BARS.map((b) => (b.c > 102 ? 1 : 2)))
  })

  it('⭐⭐ `if` with NO else yields `na` on an unmatched bar', () => {
    // ⛔ PINE'S SEMANTICS, AND THE REASON THE SLOT IS SEEDED `na`. An `if` with
    // no else that does not match has no value — seeding with 0, or with the
    // matched arm's value, hands a member a confident number for a branch their
    // script never took. The binding form's own comment says exactly this.
    const out = run(`${head}f(c) =>\n    if c\n        1\nplot(f(${TEST}))\n`)
    for (let b = 0; b < N; b += 1) {
      if (BARS[b].c > 102) expect(out[b], `bar ${b}`).toBe(1)
      else expect(Number.isNaN(out[b]), `bar ${b} should be na`).toBe(true)
    }
  })

  it('⭐ an `else if` chain, and a later arm must not run once one matched', () => {
    const out = run(`${head}f(x) =>\n    if x > 104\n        3\n    else if x > 102\n`
      + '        2\n    else\n        1\nplot(f(close))\n')
    expect(out).toEqual(BARS.map((b) => (b.c > 104 ? 3 : (b.c > 102 ? 2 : 1))))
  })

  it('⭐ statements BEFORE the chain still lower, and the chain is still the result', () => {
    // ⛔ THE SPLIT IS THE WHOLE DEFECT, so a body with real statements in front
    // of the chain is the case that proves the chain's START was found rather
    // than the last line merely special-cased.
    const out = run(`${head}f(x) =>\n    lim = 102\n    bump = 10\n`
      + '    if x > lim\n        bump\n    else\n        0\nplot(f(close))\n')
    expect(out).toEqual(BARS.map((b) => (b.c > 102 ? 10 : 0)))
  })

  it('⛔ CONTROL — the BINDING form is unchanged (it is the shared machinery)', () => {
    // ⚰️ THE NON-REGRESSION THAT MATTERS. The chain lowering was EXTRACTED from
    // this form, not copied for the new one. If the extraction changed what a
    // binding means, this is what says so.
    const out = run(`${head}x = if ${TEST}\n    1\nelse\n    2\nplot(x)\n`)
    expect(out).toEqual(BARS.map((b) => (b.c > 102 ? 1 : 2)))
  })

  it('⛔ CONTROL — a MULTI-STATEMENT arm still refuses BY NAME', () => {
    // ⚠️ THE STATED LIMIT, KEPT. Serving a multi-statement arm means deciding
    // what a mid-arm assignment does to an OUTER name, which wants its own
    // measurement. The binding form refuses it by name today and the function
    // body must refuse it the same way — a silently different answer between
    // the two positions is the drift this extraction exists to prevent.
    const r = refusalOf(`${head}f(c) =>\n    if c\n        a = 1\n        a + 1\n`
      + '    else\n        2\nplot(f(close > 0))\n')
    expect(r.guard).toBe('runtime:block-value')
  })

  it('⛔⛔ SOURCE ORDER — THE TEST IS LOWERED BEFORE ITS BODY', () => {
    // ⚰️ THE PROPERTY A STATEMENT-COUNT LEDGER IS A PROXY FOR, railed directly.
    // `pineRuntimeTextLane.test.js` records the incident: on 2026-09-20 that
    // ledger was "updated" from 77 to 88 to match a build in which an `if`'s
    // BODY was lowered before its TEST. That inverted source order and let a
    // refusal inside the body PREEMPT the one on the test, so the lane appeared
    // to walk further when it had actually stopped CHECKING. *"The number was
    // right and the code was wrong."*
    //
    // ⛔ A COUNT CANNOT SAY WHICH WAY ROUND THEY RAN. This can: both halves are
    // unsupported, so whichever is lowered FIRST owns the refusal. If the body
    // ever preempts the test again, this fails by name instead of a number
    // drifting somewhere nobody connects to the cause.
    // ⭐ A TUPLE LITERAL IS UNSUPPORTED IN BOTH POSITIONS, so whichever is
    // lowered FIRST owns the refusal. Line 4 is the `if`; line 5 is its body.
    const mk = (test, arm) => `${head}f() =>`
      + '\n    if ' + test
      + '\n        ' + arm
      + '\n    else\n        0\nplot(f())\n'
    const TUP = "['a', 1]"
    // ⛔ THE DISCRIMINATOR: with BOTH unsupported, the TEST's line must win.
    expect(refusalOf(mk(TUP, TUP)).line,
      'the BODY preempted the TEST — source order inverted').toBe(4)
    // ⭐ NON-VACUITY, both ways: each position really can own the refusal, so
    // a 4 above is a CHOICE the lowerer made and not the only answer available.
    expect(refusalOf(mk(TUP, '7')).line).toBe(4)
    expect(refusalOf(mk('close > 0', TUP)).line).toBe(5)
  })

  it('⭐⭐ THE PRODUCT CLAIM — the real corpus script, on disk', () => {
    // ⚰️ THE FIRST VERSION OF THIS CASE PASSED BEFORE THE FIX. It built a
    // paraphrase of the script and asserted the refusal did not contain
    // "never given a value" — which was already true, because the paraphrase
    // refused `runtime:statement` instead. A case that is green either way
    // proves nothing (`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`).
    //
    // ⭐ SO IT READS THE FILE. `rsi-swing-indicator` was the ONE corpus script
    // whose first wall was `pine:undefined` naming `else` — the parser reading
    // a block keyword as a name. Measured after the fix it is
    // `runtime:object-op`, its real next wall.
    const file = path.join(CORPUS, 'rsi-swing-indicator__CVZdVmg7ib.pine')
    expect(fs.existsSync(file), 'the committed corpus script is missing').toBe(true)
    const b = buildRuntimeIr(fs.readFileSync(file, 'utf8'), { bars: BARS, inputs: {} })
    // ⛔ IT NEED NOT BUILD, and claiming otherwise would be the build-count
    // overreach this programme keeps correcting. What must be true is that
    // `else` is no longer read as an undefined NAME.
    if (!b.ok) {
      expect(b.refusal.guard, `still: ${b.refusal.message}`).not.toBe('pine:undefined')
      expect(b.refusal.message).not.toContain('`else`')
    }
  })
})
