// app/src/components/chart/engine/runtime/__tests__/compoundAssign.test.js
//
// ─── ⭐ `x += e` IS `x := x + e`, AND THE PARENTHESES ARE THE WHOLE JOB ─────
//
// Pine's compound assignments (`+=`, `-=`, `*=`, `/=`, `%=`) are ordinary
// reassignment with the operator folded in. The lexer has produced them as
// single tokens since `MUTATORS` was written; this lane simply had no arm for
// them, so `_bars += 1` and `sens /= 100` refused as "a statement shape this
// front end does not recognise".
//
// ⛔⛔ THE DESUGAR IS TOKEN-LEVEL AND THE RIGHT-HAND SIDE IS BRACKETED.
// `x -= a - b` is `x := x - (a - b)`, NOT `x := x - a - b`. Splicing the
// operator in without parentheses re-associates the expression and produces a
// number that is wrong in a way no type check can see — which is why the cases
// below use operators where the two readings DIFFER, rather than `+` where they
// happen to agree.
//
// ⭐ IT REWRITES TOKENS RATHER THAN BUILDING A NODE, deliberately: the `:=` arm
// already handles slot writes, UDT field writes (`ob.top += 1`), handles and
// persistence. Desugaring into that arm inherits all of it; a second assignment
// path would be a second authority over what a write means.
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const N = 8
const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1700000000 + i * 86400, o: 100 + i, h: 102 + i, l: 98 + i, c: 100 + i, v: 1000 + i,
}))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const head = '//@version=5\nindicator("t")\n'

function runPine(src) {
  const built = buildRuntimeIr(src, { bars: BARS, inputs: {} })
  if (!built.ok) throw new Error(`refused ${built.refusal.guard}: ${built.refusal.message}`)
  const program = lowerIrProgram(built.ir)
  const r = execute(program, { bars: N, series: SERIES, columns: program.columns, confirmed: true })
  return Array.from(r.outputs[0])
}

describe('⭐ compound assignment lowers as reassignment with the operator folded in', () => {
  it('⭐⭐ `+=` accumulates across bars — the `session-hilo` shape', () => {
    // `_bars += 1`, which is how a script counts bars in a session.
    const out = runPine(`${head}var n = 0.0\nn += 1\nplot(n)\n`)
    for (let i = 0; i < N; i += 1) expect(out[i], `bar ${i}`).toBe(i + 1)
  })

  it('⛔⛔ THE RHS IS BRACKETED — `/=` with a compound right side', () => {
    // ⚰️ THE CASE THAT SEPARATES A CORRECT DESUGAR FROM A PLAUSIBLE ONE.
    //   correct : x := x / (2 * 2)   → 8/4 = 2 on the first bar
    //   spliced : x := x / 2 * 2     → 8   on every bar, unchanged
    // Both are valid Pine and only one is this statement's meaning.
    const out = runPine(`${head}var x = 8.0\nx /= 2 * 2\nplot(x)\n`)
    expect(out[0], 'the right-hand side was not bracketed').toBe(2)
    expect(out[1]).toBe(0.5)
  })

  it('⛔ `-=` with a compound right side, where association also changes the answer', () => {
    //   correct : x := x - (close - 100)
    //   spliced : x := x - close - 100
    const out = runPine(`${head}var x = 0.0\nx -= close - 100\nplot(x)\n`)
    // close runs 100..107, so the subtrahend is 0,1,2,… and x accumulates -Σi
    let want = 0
    for (let i = 0; i < N; i += 1) {
      want -= (BARS[i].c - 100)
      expect(out[i], `bar ${i}`).toBe(want)
    }
    // ⛔ CONTROL — the spliced reading would have gone sharply negative at once
    expect(out[0]).toBe(0)
  })

  it('⭐ `*=` and `%=` are served too, not just the two the corpus needed', () => {
    const mul = runPine(`${head}var x = 1.0\nx *= 3\nplot(x)\n`)
    for (let i = 0; i < N; i += 1) expect(mul[i], `bar ${i}`).toBe(3 ** (i + 1))
    const mod = runPine(`${head}var x = 0.0\nx += 1\nx %= 3\nplot(x)\n`)
    for (let i = 0; i < N; i += 1) expect(mod[i], `bar ${i}`).toBe((i + 1) % 3 === 0 ? 0 : (i + 1) % 3)
  })

  it('⛔ CONTROL — a plain `:=` is untouched', () => {
    // ⭐ NON-REGRESSION. The desugar must key off the compound tokens alone; a
    // rewrite that also fired on `:=` would double the right-hand side.
    const out = runPine(`${head}var x = 0.0\nx := close - 100\nplot(x)\n`)
    for (let i = 0; i < N; i += 1) expect(out[i]).toBe(BARS[i].c - 100)
  })

  it('⛔ CONTROL — an ordinary `=` binding is untouched', () => {
    const out = runPine(`${head}y = close - 100\nplot(y)\n`)
    for (let i = 0; i < N; i += 1) expect(out[i]).toBe(BARS[i].c - 100)
  })

  it('⛔ a compound with nothing on the right refuses by name', () => {
    const b = buildRuntimeIr(`${head}var x = 0.0\nx +=\nplot(x)\n`, { bars: BARS, inputs: {} })
    expect(b.ok).toBe(false)
    expect(b.refusal.guard).toBe('runtime:statement')
  })
})
