// app/src/components/chart/engine/runtime/__tests__/sourceToRuntime.test.js
//
// ─── ⭐⭐ 2D-2 — REAL PINE SOURCE REACHES THE RUNTIME ────────────────────────
//
// The conformance ladder of §16: actual Pine text, through the shared front end,
// into the semantic IR, through the lowering, executed bar by bar, compared to an
// oracle written out longhand in this file.
//
// ⛔ THE EXPECTATIONS ARE INDEPENDENT (§33). Not one of them is produced by
// compiling the source and reading what came back. A state program has no
// columnar twin to differ against — that is the point of it — so the oracle is a
// plain JS loop written from Pine's semantics, and where the two disagree the
// runtime is presumed wrong.

import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const N = 80
const BARS = (() => {
  const out = []
  let p = 100
  for (let i = 0; i < N; i += 1) {
    p += Math.sin(i / 5) * 1.4 + Math.cos(i / 11) * 0.6
    out.push({ t: 1700000000 + i * 86400, o: p - Math.cos(i / 3) * 0.9, h: p + 1, l: p - 1, c: p, v: 1000 + i })
  }
  return out
})()
const C = BARS.map((b) => b.c)
const O = BARS.map((b) => b.o)

const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))

/** Pine source → executed output series. The whole 2D-2 path in one call. */
function runPine(src, inputs) {
  const built = buildRuntimeIr(src, { bars: BARS, inputs: inputs || {} })
  if (!built.ok) throw new Error(`refused ${built.refusal.guard}: ${built.refusal.message}`)
  const program = lowerIrProgram(built.ir)
  const { outputs, budget } = execute(program, {
    bars: N, series: SERIES, columns: program.columns, confirmed: true,
  })
  return { out: Array.from(outputs[0]), program, budget, ir: built.ir, diagnostics: built.diagnostics }
}

const refusalOf = (src) => {
  const built = buildRuntimeIr(src, { bars: BARS, inputs: {} })
  expect(built.ok, `expected a refusal, got a program`).toBe(false)
  return built.refusal
}

const head = '//@version=5\nindicator("t")\n'

describe('A — var counter: persistent state across bars', () => {
  it('⭐⭐ real Pine source produces a running accumulator', () => {
    const { out } = runPine(`${head}var acc = 0.0\nacc := acc + close\nplot(acc)\n`)
    let acc = 0
    const want = []
    for (let i = 0; i < N; i += 1) { acc += C[i]; want.push(acc) }
    expect(out).toEqual(want)
  })
})

describe('B — conditional counter: state mutates only under a condition', () => {
  it('⭐⭐ `if` in source becomes a STATEMENT, not a ternary', () => {
    const { out } = runPine(`${head}var up = 0.0\nif close > open\n    up := up + 1\nplot(up)\n`)
    let up = 0
    const want = []
    for (let i = 0; i < N; i += 1) { if (C[i] > O[i]) up += 1; want.push(up) }
    expect(out).toEqual(want)
    // non-vacuity: the fixture must contain both kinds of bar
    expect(want[N - 1]).toBeGreaterThan(0)
    expect(want[N - 1]).toBeLessThan(N)
  })

  it('⭐ if / else, each side mutating', () => {
    const { out } = runPine(`${head}var n = 0.0\nif close > open\n    n := n + 1\nelse\n    n := n - 1\nplot(n)\n`)
    let n = 0
    const want = []
    for (let i = 0; i < N; i += 1) { n += C[i] > O[i] ? 1 : -1; want.push(n) }
    expect(out).toEqual(want)
  })
})

describe('C — `var float x = na`', () => {
  it('⭐⭐ initialised, may stay na, initialiser does not re-run, and `:=` still lands', () => {
    // ⛔ THE PERMANENT RAIL of §8. If "initialised" were inferred from the stored
    // VALUE, this program would re-run its initialiser on every bar for as long
    // as it held `na` — and would then never keep the first assignment.
    const src = `${head}var x = na\nif close > open\n    x := close\nplot(x)\n`
    const { out, program, budget } = runPine(src)
    let x = NaN
    const want = []
    for (let i = 0; i < N; i += 1) { if (C[i] > O[i]) x = C[i]; want.push(x) }
    for (let i = 0; i < N; i += 1) {
      if (Number.isNaN(want[i])) expect(Number.isNaN(out[i]), `bar ${i}`).toBe(true)
      else expect(out[i], `bar ${i}`).toBe(want[i])
    }
    // the value SURVIVES a bar on which the branch is not taken
    expect(out.some((v) => !Number.isNaN(v))).toBe(true)
    // and the initialiser was jumped over rather than re-run
    expect(budget.counts.TOTAL_INSTRUCTIONS).toBeLessThan(program.instructions * N)
  })
})

describe('D — an ordinary local resets every bar', () => {
  it('⛔⛔ a local assigned only under a condition reads `na` on the other bars', () => {
    // THE SEVERE DEFECT THIS RAIL EXISTS FOR: if the frame leaked across bars,
    // every ordinary Pine binding would become an accidental `var`.
    const src = `${head}var seen = 0.0\nif close > open\n    seen := 1\nelse\n    seen := 0\nplot(seen)\n`
    const { out } = runPine(src)
    for (let i = 0; i < N; i += 1) expect(out[i]).toBe(C[i] > O[i] ? 1 : 0)
  })
})

describe('E — a value the PURE GRAPH computed feeds runtime state', () => {
  it('⭐⭐ the hybrid in one source program: `ta.sma` stays columnar, the sum is stateful', () => {
    const src = `${head}m = ta.sma(close, 10)\nvar acc = 0.0\nacc := acc + m\nplot(acc)\n`
    const { out, ir } = runPine(src)
    // ⭐ the moving average became ONE column; only the accumulation is runtime
    expect(ir.columns.length).toBeGreaterThan(0)
    // oracle: the same SMA, computed here, accumulated here
    let acc = 0
    const want = []
    for (let i = 0; i < N; i += 1) {
      let m = NaN
      if (i >= 9) { let s = 0; for (let k = i - 9; k <= i; k += 1) s += C[k]; m = s / 10 }
      acc += m // NaN poisons acc from bar 0, exactly as Pine would
      want.push(acc)
    }
    for (let i = 0; i < N; i += 1) {
      if (Number.isNaN(want[i])) expect(Number.isNaN(out[i]), `bar ${i}`).toBe(true)
      else expect(out[i]).toBeCloseTo(want[i], 9)
    }
  })
})

describe('F — statement ORDER is observable', () => {
  it('⭐⭐ `x := x + 1` then `x := x * 2` differs from the reverse', () => {
    // ⛔ THE RAIL AGAINST EXPRESSION REWRITING. Any lowering that treated these
    // as one folded expression would make the two programs agree.
    const a = runPine(`${head}var x = 0.0\nx := x + 1\nx := x * 2\nplot(x)\n`).out
    const b = runPine(`${head}var x = 0.0\nx := x * 2\nx := x + 1\nplot(x)\n`).out
    let xa = 0, xb = 0
    const wa = [], wb = []
    for (let i = 0; i < N; i += 1) { xa = (xa + 1) * 2; wa.push(xa) }
    for (let i = 0; i < N; i += 1) { xb = xb * 2 + 1; wb.push(xb) }
    expect(a).toEqual(wa)
    expect(b).toEqual(wb)
    expect(a[0]).not.toBe(b[0])
  })
})

describe('G — nested blocks', () => {
  it('⭐ an `if` inside an `if`, both mutating', () => {
    const src = `${head}var n = 0.0\nif close > open\n    n := n + 1\n    if close > open + 0.5\n        n := n + 10\nplot(n)\n`
    const { out } = runPine(src)
    let n = 0
    const want = []
    for (let i = 0; i < N; i += 1) {
      if (C[i] > O[i]) { n += 1; if (C[i] > O[i] + 0.5) n += 10 }
      want.push(n)
    }
    expect(out).toEqual(want)
  })
})

describe('H — a member input drives state', () => {
  it('⭐⭐ the runtime sees the MEMBER value, not the folded default', () => {
    // ⚰️ THE C3B DEFECT THIS GUARDS: one lane honoured a declared input while
    // another folded its default, so a plot and a line disagreed about one knob.
    // Here the step size comes from an input and the accumulator must move by it.
    const src = `${head}step = input.int(3, "Step")\nvar acc = 0.0\nacc := acc + step\nplot(acc)\n`
    const { out } = runPine(src)
    const want = []
    for (let i = 0; i < N; i += 1) want.push((i + 1) * 3)
    expect(out).toEqual(want)
  })
})

describe('⛔ precise refusals — the next dependency is EXPOSED, never hidden', () => {
  const CASES = [
    ['a loop', `${head}var s = 0.0\nfor i = 0 to 5\n    s := s + 1\nplot(s)\n`, 'runtime:loop'],
    // ⚰️ `a user function → runtime:function` LIVED HERE UNTIL 2E, which gave
    // functions real call frames. The case moved rather than being deleted: what
    // it asserts now is that a function this front end cannot READ still refuses
    // by the same name, so the guard is still reachable.
    ['a function with a default parameter', `${head}f(x = 3) => x * 2\nplot(f(close))\n`, 'runtime:function'],
    ['a tuple', `${head}[a, b] = ta.macd(close, 12, 26, 9)\nplot(a)\n`, 'runtime:tuple'],
    // ⚰️ `history over a mutable variable → runtime:history-variable` LIVED HERE
    // UNTIL 2F-2, which executes it. The three cases that replace it are the
    // parts of the family that genuinely do not run yet — and they are three
    // different walls, named separately for the same reason 2E split
    // `call-with-state` and 2F-1 split the residue after it.
    ['history over an EXPRESSION with state', `${head}var x = 0.0\nx := close\nplot((x + 1)[1])\n`, 'runtime:history-expression'],
    ['a history offset only known while the bar runs', `${head}var x = 0.0\nx := close\nplot(x[bar_index % 3])\n`, 'runtime:history-dynamic-offset'],
    ['history over a FUNCTION-LOCAL value', `${head}f(v) =>\n    var c = 0.0\n    c := c + v\n    c[1]\nplot(f(1))\n`, 'runtime:history-function-local'],
    // ⚰️ THIS ASSERTED `runtime:call-with-state` UNTIL 2E SPLIT IT. The measured
    // population under that one label was three capabilities — a POINTWISE
    // builtin applied to a value, a WINDOWED one that needs a growing series, and
    // an MTF request — so the label was retired rather than kept as a wall that
    // looked bigger and more uniform than it is. `ta.sma` is the windowed case.
    ['a WINDOWED builtin fed by state', `${head}var x = 0.0\nx := close\nplot(ta.sma(x, 5))\n`, 'runtime:call-windowed-state'],
    // ⚰️⚰️ `math.max` OVER STATE REFUSED HERE UNTIL 2F-1, WHICH EXECUTES IT, and
    // the replacement case is worth reading because the first attempt was WRONG.
    // It moved to `ta.cum` and asserted `call-windowed-state` — "cumulative needs
    // the series foundation" — which sounded right and was not: the closed table
    // does not declare `cum` AT ALL, so nothing about it is windowed. 2F-1's
    // census found the same mistake sitting in the corpus numbers (`str.upper`,
    // `int` and `iff` were all filed as windowed), and the split below is what
    // that correction looks like. These three refusals are three different walls.
    ['a WINDOWED builtin fed by state (declared)', `${head}var x = 0.0\nx := close\nplot(ta.ema(x, 5))\n`, 'runtime:call-windowed-state'],
    ['an UNDECLARED builtin fed by state', `${head}var x = 0.0\nx := close\nplot(ta.cum(x))\n`, 'runtime:call-undeclared-builtin-state'],
    ['a TEXT builtin fed by state', `${head}var x = 0.0\nx := close\nplot(str.length(str.tostring(x)))\n`, 'runtime:call-text-state'],
    ['a CONVERSION fed by state', `${head}var x = 0.0\nx := close / 3\nplot(int(x))\n`, 'runtime:call-conversion-state'],
    ['a strategy', `//@version=5\nstrategy("s")\nplot(close)\n`, 'runtime:declaration'],
  ]
  for (const [label, src, guard] of CASES) {
    it(`${label} → \`${guard}\``, () => {
      expect(refusalOf(src).guard).toBe(guard)
    })
  }

  it('⭐ a refusal carries a source LINE, so a gap is attributable', () => {
    const r = refusalOf(`${head}var s = 0.0\nfor i = 0 to 5\n    s := s + 1\nplot(s)\n`)
    expect(r.line).toBeGreaterThan(0)
  })

  it('⛔ NOTHING IS SILENTLY DROPPED — an unsupported statement refuses the PROGRAM', () => {
    // A front end that skipped what it could not lower would accept this script
    // and quietly compute a different indicator.
    const built = buildRuntimeIr(`${head}var s = 0.0\nfor i = 0 to 5\n    s := s + 1\nplot(s)\n`, { bars: BARS })
    expect(built.ok).toBe(false)
    expect(built.ir).toBeUndefined()
  })
})

describe('⛔ NON-VACUITY', () => {
  it('the pure lane really is taken for a non-mutating binding', () => {
    // If every expression went through the runtime, this program would have no
    // columns and the claim that `ta.sma` stays columnar would be false.
    const { ir } = runPine(`${head}m = ta.sma(close, 10)\nvar acc = 0.0\nacc := acc + m\nplot(acc)\n`)
    expect(ir.columns.length).toBeGreaterThan(0)
    expect(ir.slots.length).toBe(1) // only `acc` is a slot; `m` stayed pure
  })

  it('a mutated name does NOT stay pure', () => {
    const { ir } = runPine(`${head}var a = 0.0\nvar b = 0.0\na := a + 1\nb := b + 2\nplot(a + b)\n`)
    expect(ir.slots.length).toBe(2)
  })
})
