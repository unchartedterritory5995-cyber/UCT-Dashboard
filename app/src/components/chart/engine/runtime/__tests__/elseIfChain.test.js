// app/src/components/chart/engine/runtime/__tests__/elseIfChain.test.js
//
// ─── ⭐⭐ P7.4 — `if / else if / else` IN THE RUNTIME LANE ────────────────────
//
// ⚰️⚰️ THIS FAMILY WAS DOCUMENTED AS COMPLETE AND DID NOT WORK AT ALL.
//
// The completion matrix read `PARSE ✅ SEM ✅ IR ✅ RUN ✅` for `else if` chains.
// Measured: `if / else` ran, and `if / else if / else` — the two-arm chain every
// Pine author writes — refused `runtime:statement`, "`else` with no `if`".
//
// ⛔ THE ROOT CAUSE WAS A ONE-ELEMENT LIST. The `else if` arm was lowered by
// recursing with `lowerStmts([synthetic], scope)`, so the nested `if` looked for
// its own `else` at `list[i + 1]` of a list with ONE entry and found nothing.
// Every remaining arm was still in the OUTER list, where the loop then met an
// `else` with no `if` in front of it.
//
// ⛔⛔ AND THE REASON IT SURVIVED IS THE LESSON WORTH KEEPING: the SHIPPED
// COLUMNAR DOOR handles chains correctly, so any spot check there corroborated a
// claim about a front end that could not do it. A capability that exists in two
// execution lanes needs evidence naming WHICH LANE was tested — every assertion
// in this file runs the RUNTIME lane, end to end, from Pine source.

import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'
import { STMT } from '../ir.js'

const N = 24
// close runs 100..123, so a threshold picks a contiguous tail of bars.
const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1700000000 + i * 86400, o: 100 + i, h: 102 + i, l: 98 + i, c: 100 + i, v: 1000 + i,
}))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const head = '//@version=5\nindicator("t")\n'

function build(src) {
  const built = buildRuntimeIr(src, { bars: BARS, inputs: {} })
  if (!built.ok) throw new Error(`refused ${built.refusal.guard}: ${built.refusal.message}`)
  return built
}
function runPine(src) {
  const built = build(src)
  const program = lowerIrProgram(built.ir)
  const r = execute(program, { bars: N, series: SERIES, columns: program.columns, confirmed: true })
  return { out: Array.from(r.outputs[0]), outs: r.outputs.map((o) => Array.from(o)), ir: built.ir, budget: r.budget }
}
const refusalOf = (src) => {
  const b = buildRuntimeIr(src, { bars: BARS, inputs: {} })
  expect(b.ok, 'expected a refusal').toBe(false)
  return b.refusal
}

describe('⭐⭐ the chain runs, at every arm count', () => {
  it('two arms and a final else', () => {
    const { out } = runPine(`${head}var x = 0.0\nif close > 115\n    x := 1\nelse if close > 110\n    x := 2\nelse\n    x := 3\nplot(x)\n`)
    for (let i = 0; i < N; i += 1) {
      const c = BARS[i].c
      expect(out[i], `bar ${i} (close ${c})`).toBe(c > 115 ? 1 : c > 110 ? 2 : 3)
    }
    // the fixture must exercise all three arms, or this proves one branch
    expect(new Set(out).size).toBe(3)
  })

  it('⭐ three arms and a final else', () => {
    const { out } = runPine(`${head}var x = 0.0\nif close > 118\n    x := 1\nelse if close > 114\n    x := 2\nelse if close > 110\n    x := 3\nelse\n    x := 4\nplot(x)\n`)
    for (let i = 0; i < N; i += 1) {
      const c = BARS[i].c
      expect(out[i], `bar ${i}`).toBe(c > 118 ? 1 : c > 114 ? 2 : c > 110 ? 3 : 4)
    }
    expect(new Set(out).size).toBe(4)
  })

  it('⭐ NO final else — an unmatched bar changes nothing', () => {
    const { out } = runPine(`${head}var x = 0.0\nif close > 118\n    x := 1\nelse if close > 114\n    x := 2\nplot(x)\n`)
    for (let i = 0; i < N; i += 1) {
      const c = BARS[i].c
      // `var` keeps its value, so an unmatched bar reads the declaration's 0
      expect(out[i], `bar ${i}`).toBe(c > 118 ? 1 : c > 114 ? 2 : 0)
    }
    expect(out.includes(0)).toBe(true)
  })

  it('⛔ the statement AFTER the chain still runs — the outer loop resumed correctly', () => {
    // ⚰️ The bug consumed only ONE arm, so everything after the chain was
    // misread. This is the case that would have caught it soonest.
    const { out } = runPine(`${head}var x = 0.0\nif close > 115\n    x := 1\nelse if close > 110\n    x := 2\nelse\n    x := 3\ny = x * 10\nplot(y)\n`)
    for (let i = 0; i < N; i += 1) {
      const c = BARS[i].c
      expect(out[i], `bar ${i}`).toBe((c > 115 ? 1 : c > 110 ? 2 : 3) * 10)
    }
  })

  it('⭐ a NESTED chain inside an arm', () => {
    const src = `${head}var x = 0.0\nif close > 110\n    if close > 118\n        x := 1\n    else if close > 114\n        x := 2\n    else\n        x := 3\nelse\n    x := 9\nplot(x)\n`
    const { out } = runPine(src)
    for (let i = 0; i < N; i += 1) {
      const c = BARS[i].c
      expect(out[i], `bar ${i}`).toBe(c > 110 ? (c > 118 ? 1 : c > 114 ? 2 : 3) : 9)
    }
    expect(new Set(out).size).toBe(4)
  })
})

describe('⭐⭐ FIRST MATCH WINS, and later arms do not run', () => {
  it('⛔ two arms whose conditions are BOTH true — the first one is the answer', () => {
    // If the chain were flattened, or if a later arm ran anyway, this would be 2.
    const { out } = runPine(`${head}var x = 0.0\nif close > 0\n    x := 1\nelse if close > 0\n    x := 2\nelse\n    x := 3\nplot(x)\n`)
    expect(new Set(out)).toEqual(new Set([1]))
  })

  it('⛔⛔ a later arm\'s TEST is not even EVALUATED — measured, not assumed', () => {
    // ⭐ THE OBSERVABLE PROOF. A structural claim ("it is nested, so it must
    // skip") is not evidence. Instruction count is: when the FIRST arm matches,
    // the runtime must execute strictly fewer instructions than when the LAST
    // arm matches, because the later tests live inside the untaken `else`.
    const chain = (thresh) => `${head}var x = 0.0\nif close > ${thresh}\n    x := 1\nelse if close > ${thresh}\n    x := 2\nelse if close > ${thresh}\n    x := 3\nelse\n    x := 4\nplot(x)\n`
    // every bar matches arm 1
    const first = runPine(chain(0))
    // no bar matches any arm — all three tests evaluate, then the final else
    const last = runPine(chain(9999))
    expect(new Set(first.out)).toEqual(new Set([1]))
    expect(new Set(last.out)).toEqual(new Set([4]))
    expect(first.budget.counts.TOTAL_INSTRUCTIONS)
      .toBeLessThan(last.budget.counts.TOTAL_INSTRUCTIONS)
  })

  it('⭐ the IR is NESTED, not flattened — arm k+1 lives inside arm k\'s else', () => {
    // ⛔ `else if b` is NOT `if not a and b`. Flattening would evaluate every
    // test on every bar and would be wrong the moment a test has a cost or a
    // dependency on the arm above it.
    const { ir } = runPine(`${head}var x = 0.0\nif close > 118\n    x := 1\nelse if close > 114\n    x := 2\nelse if close > 110\n    x := 3\nelse\n    x := 4\nplot(x)\n`)
    let node = ir.statements.find((s) => s.kind === STMT.IF)
    let depth = 0
    while (node) {
      depth += 1
      const inner = (node.else || []).find((s) => s.kind === STMT.IF)
      if (!inner) break
      node = inner
    }
    expect(depth, 'three IF nodes, each inside the previous one\'s else').toBe(3)
  })
})

describe('⭐ the chain composes with the rest of the runtime', () => {
  it('⭐⭐ arms mutate STATE differently, and only the matching one mutates', () => {
    const src = `${head}var a = 0.0\nvar b = 0.0\nvar c = 0.0\nif close > 115\n    a := a + 1\nelse if close > 110\n    b := b + 1\nelse\n    c := c + 1\nplot(a)\nplot(b)\nplot(c)\n`
    const { outs } = runPine(src)
    let A = 0; let B = 0; let C = 0
    for (let i = 0; i < N; i += 1) {
      const cl = BARS[i].c
      if (cl > 115) A += 1; else if (cl > 110) B += 1; else C += 1
      expect(outs[0][i], `a bar ${i}`).toBe(A)
      expect(outs[1][i], `b bar ${i}`).toBe(B)
      expect(outs[2][i], `c bar ${i}`).toBe(C)
    }
    // ⛔ the counters must SUM to the bar count — if two arms ever ran on one
    // bar, this is the assertion that notices.
    expect(A + B + C).toBe(N)
  })

  it('⭐⭐ a chain over RUNTIME HISTORY — 2F-2A and P7.4 in one program', () => {
    const src = `${head}var s = 0.0\ns := close\nvar t = 0.0\nif s[1] > 115\n    t := 1\nelse if s[1] > 110\n    t := 2\nelse\n    t := 3\nplot(t)\n`
    const { out } = runPine(src)
    for (let i = 0; i < N; i += 1) {
      const prev = i === 0 ? NaN : BARS[i - 1].c
      // `na > 115` is false in this engine's `cmp`, so bar 0 takes the final else
      expect(out[i], `bar ${i}`).toBe(prev > 115 ? 1 : prev > 110 ? 2 : 3)
    }
  })

  it('⭐⭐ a STATEFUL UDF inside an arm keeps its per-call-site state', () => {
    const src = `${head}f(v) =>\n    var k = 0.0\n    k := k + v\n    k\nvar x = 0.0\nif close > 115\n    x := f(1)\nelse if close > 110\n    x := f(10)\nelse\n    x := 0\nplot(x)\n`
    const { out } = runPine(src)
    let s1 = 0; let s2 = 0
    for (let i = 0; i < N; i += 1) {
      const c = BARS[i].c
      // ⭐ two call sites, two independent counters — the 2E vendor-pinned rule —
      // and each only advances on the bars its own arm takes.
      if (c > 115) { s1 += 1; expect(out[i], `bar ${i}`).toBe(s1) }
      else if (c > 110) { s2 += 10; expect(out[i], `bar ${i}`).toBe(s2) }
      else expect(out[i], `bar ${i}`).toBe(0)
    }
    expect(s1).toBeGreaterThan(0)
    expect(s2).toBeGreaterThan(0)
  })

  it('⛔ an `na` condition takes NO arm — it is not truthy', () => {
    // `close > na` is `na`; JUMP_IF_FALSE treats `na` as false, so the chain
    // falls through to the next arm and finally to `else`.
    const src = `${head}var x = 0.0\nif close > na\n    x := 1\nelse if close > na\n    x := 2\nelse\n    x := 3\nplot(x)\n`
    expect(new Set(runPine(src).out)).toEqual(new Set([3]))
    // …and with no final else, nothing is assigned at all
    const src2 = `${head}var x = 7.0\nif close > na\n    x := 1\nelse if close > na\n    x := 2\nplot(x)\n`
    expect(new Set(runPine(src2).out)).toEqual(new Set([7]))
  })
})

describe('⛔ diagnostics survive the chain (§30)', () => {
  it('a refusal inside a later arm reports THAT arm\'s line', () => {
    //                     1              2            3          4        5             6           7
    // ⚰️ THE REFUSING CALL WAS `ta.sma(x, 5)` AND 2F-2B EXECUTES IT, so the arm
    // stopped refusing and this test went green-on-nothing. What it measures is
    // LINE ATTRIBUTION, not which builtin is blocked — so it takes the nearest
    // still-refused call at the same position rather than being deleted.
    // ⚰️ Re-pointed a SECOND time (sma → ema → hma) as each wave shipped the
    // previous one. What this measures is LINE ATTRIBUTION, not which builtin
    // is blocked, so it takes the nearest still-refused call at the same spot.
    const src = `${head}var x = 0.0\nif close > 118\n    x := 1\nelse if close > 114\n    x := ta.hma(x, 5)\nelse\n    x := 3\nplot(x)\n`
    const r = refusalOf(src)
    expect(r.guard).toBe('runtime:call-windowed-state')
    // line 7 of the whole source: 2 header lines + 5 body lines
    expect(r.line, 'the refusal points at the arm that contains it').toBe(7)
  })

  it('⛔ a REAL `else` with no `if` still refuses by name', () => {
    // The guard must stay reachable — the fix widened what an `if` consumes, it
    // did not delete the error for a genuinely orphaned `else`.
    const r = refusalOf(`${head}var x = 0.0\nelse\n    x := 1\nplot(x)\n`)
    expect(r.guard).toBe('runtime:statement')
    expect(r.message).toMatch(/`else` with no `if`/)
  })
})
