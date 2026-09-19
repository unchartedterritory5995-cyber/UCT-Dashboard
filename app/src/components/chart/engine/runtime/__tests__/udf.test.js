// app/src/components/chart/engine/runtime/__tests__/udf.test.js
//
// ─── ⭐⭐ 2E — PINE FUNCTIONS GET REAL EXECUTION SEMANTICS ───────────────────
//
// After 2D-2, `runtime:function` was the wall on 18 of the frozen 60 — by a
// factor of two and a half over the next family. This is the wave that removes
// it, and the one invariant it must not get wrong is §6:
//
//   ⛔⛔ A FUNCTION'S PERSISTENT LOCALS BELONG TO THE CALL SITE, NOT THE
//   FUNCTION. Two calls to one helper are two independent `var`s. Storing them
//   per definition would make a script that calls a helper twice silently share
//   one counter — a wrong number with nothing red anywhere, which is exactly the
//   defect class this whole programme exists to prevent.
//
// ⚠️ EXPECTATIONS ARE COMPUTED LONGHAND from the same bars. A stateful function
// has no columnar twin, so the oracle cannot be the runtime agreeing with itself.

import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'
import { RuntimeLimitError } from '../limits.js'

const N = 60
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

const head = '//@version=5\nindicator("t")\n'

function runPine(src, inputs, limits) {
  const built = buildRuntimeIr(src, { bars: BARS, inputs: inputs || {} })
  if (!built.ok) throw new Error(`refused ${built.refusal.guard}: ${built.refusal.message}`)
  const program = lowerIrProgram(built.ir)
  const r = execute(program, {
    bars: N, series: SERIES, columns: program.columns, confirmed: true,
  }, limits)
  return {
    outs: r.outputs.map((o) => Array.from(o)),
    out: Array.from(r.outputs[0]),
    program, budget: r.budget, ir: built.ir, diagnostics: built.diagnostics,
  }
}

const refusalOf = (src) => {
  const built = buildRuntimeIr(src, { bars: BARS, inputs: {} })
  expect(built.ok, 'expected a refusal, got a program').toBe(false)
  return built.refusal
}

describe('a function is a first-class entity, not a macro', () => {
  it('⭐⭐ a pure function executes and returns its value', () => {
    const { out, ir } = runPine(`${head}f(x) => x * 2\nplot(f(close))\n`)
    expect(out).toEqual(C.map((c) => c * 2))
    expect(ir.functions.length).toBe(1)
    expect(ir.functions[0].name).toBe('f')
    expect(ir.functions[0].params).toBe(1)
  })

  it('⭐ multiple parameters, and a body of several statements', () => {
    const src = `${head}f(a, b) =>\n    s = a + b\n    d = a - b\n    s * d\nplot(f(high, low))\n`
    const { out } = runPine(src)
    for (let i = 0; i < N; i += 1) {
      const a = BARS[i].h, b = BARS[i].l
      expect(out[i]).toBeCloseTo((a + b) * (a - b), 9)
    }
  })

  it('⭐ the same function called twice from ONE expression', () => {
    const { out, ir } = runPine(`${head}f(x) => x + 1\nplot(f(high) + f(low))\n`)
    expect(ir.callSites.length).toBe(2)
    for (let i = 0; i < N; i += 1) expect(out[i]).toBeCloseTo(BARS[i].h + 1 + BARS[i].l + 1, 9)
  })

  it('⭐ a pure function is CLASSIFIED pure, even though it still runs on the runtime', () => {
    // §26: the classification exists so the optimisation can be taken later; it
    // is deliberately not acted on yet, because routing a UDF to the graph lane
    // needs the differential rail to cover that seam first.
    const { ir } = runPine(`${head}f(x) => x * 2\nplot(f(close))\n`)
    expect(ir.functions[0].effects.pure).toBe(true)
  })
})

describe('⭐⭐ PERSISTENT FUNCTION-LOCAL STATE IS PER CALL SITE (§6)', () => {
  const SRC = `${head}f(x) =>\n    var c = 0.0\n    c := c + x\n    c\na = f(1)\nb = f(10)\nplot(a)\nplot(b)\n`

  it('⛔⛔ two call sites do NOT share one `var` — the single most important 2E rail', () => {
    const { outs, ir } = runPine(SRC)
    expect(ir.callSites.length).toBe(2)
    // Independent accumulators: +1 per bar and +10 per bar.
    const wantA = Array.from({ length: N }, (_, i) => i + 1)
    const wantB = Array.from({ length: N }, (_, i) => (i + 1) * 10)
    expect(outs[0]).toEqual(wantA)
    expect(outs[1]).toEqual(wantB)
    // ⛔ NON-VACUITY: a per-FUNCTION implementation would make both outputs the
    // same shared running total, so the two must not merely differ — they must
    // differ in the specific way independent state produces.
    expect(outs[0][N - 1]).not.toBe(outs[1][N - 1])
    expect(outs[1][N - 1]).toBe(outs[0][N - 1] * 10)
  })

  it('⛔ their persistent blocks are allocated at DIFFERENT bases', () => {
    // The structural half of the same claim: if the allocator ever handed two
    // sites one base, the behavioural test above would be the only thing between
    // us and a silently shared counter.
    const { ir } = runPine(SRC)
    const bases = ir.callSites.map((c) => c.persistBase)
    expect(new Set(bases).size).toBe(bases.length)
  })

  it('⭐ the SAME call site recovers its state across bars (§9)', () => {
    const { out } = runPine(`${head}f(x) =>\n    var c = 0.0\n    c := c + x\n    c\nplot(f(2))\n`)
    // Continuity: 2, 4, 6 … — not "2 on every bar", which is what fresh
    // per-bar allocation would produce.
    expect(out).toEqual(Array.from({ length: N }, (_, i) => (i + 1) * 2))
  })
})

describe('ordinary function locals are frame-local (§20)', () => {
  it('⛔⛔ a local does NOT persist across invocations', () => {
    // If the frame were not cleared per invocation, `t` would carry the previous
    // call's value and this would accumulate instead of returning x+1 each time.
    const src = `${head}f(x) =>\n    t = x + 1\n    t\nplot(f(close))\n`
    const { out } = runPine(src)
    expect(out).toEqual(C.map((c) => c + 1))
  })

  it('⛔ two call sites do not see each other\'s locals', () => {
    const src = `${head}f(x) =>\n    t = x * 3\n    t\nplot(f(high) - f(low))\n`
    const { out } = runPine(src)
    for (let i = 0; i < N; i += 1) expect(out[i]).toBeCloseTo(BARS[i].h * 3 - BARS[i].l * 3, 9)
  })
})

describe('`var` semantics inside a function', () => {
  it('⭐⭐ `var x = na` — initialised, may stay na, initialiser does not re-run', () => {
    const src = `${head}f(c) =>\n    var s = na\n    if c > 0\n        s := c\n    s\nplot(f(close - open))\n`
    const { out, program, budget } = runPine(src)
    let s = NaN
    const want = []
    for (let i = 0; i < N; i += 1) { if (C[i] - O[i] > 0) s = C[i] - O[i]; want.push(s) }
    for (let i = 0; i < N; i += 1) {
      if (Number.isNaN(want[i])) expect(Number.isNaN(out[i]), `bar ${i}`).toBe(true)
      else expect(out[i]).toBeCloseTo(want[i], 9)
    }
    expect(budget.counts.TOTAL_INSTRUCTIONS).toBeLessThan(program.instructions * N)
  })

  it('⭐ reassignment and statement ORDER inside a function body', () => {
    const a = runPine(`${head}f(x) =>\n    var v = 0.0\n    v := v + 1\n    v := v * 2\n    v\nplot(f(0))\n`).out
    const b = runPine(`${head}f(x) =>\n    var v = 0.0\n    v := v * 2\n    v := v + 1\n    v\nplot(f(0))\n`).out
    let va = 0, vb = 0
    const wa = [], wb = []
    for (let i = 0; i < N; i += 1) { va = (va + 1) * 2; wa.push(va) }
    for (let i = 0; i < N; i += 1) { vb = vb * 2 + 1; wb.push(vb) }
    expect(a).toEqual(wa)
    expect(b).toEqual(wb)
  })

  it('⭐ if / else that MUTATES inside a function', () => {
    const src = `${head}f(c) =>\n    var n = 0.0\n    if c > 0\n        n := n + 1\n    else\n        n := n - 1\n    n\nplot(f(close - open))\n`
    const { out } = runPine(src)
    let n = 0
    const want = []
    for (let i = 0; i < N; i += 1) { n += (C[i] - O[i]) > 0 ? 1 : -1; want.push(n) }
    expect(out).toEqual(want)
  })
})

describe('composition', () => {
  it('⭐ nested calls — a function calling another function', () => {
    const src = `${head}g(x) => x + 1\nf(x) => g(x) * 2\nplot(f(close))\n`
    const { out } = runPine(src)
    for (let i = 0; i < N; i += 1) expect(out[i]).toBeCloseTo((C[i] + 1) * 2, 9)
  })

  it('⭐⭐ a STATEFUL function called from inside another function', () => {
    const src = `${head}g(x) =>\n    var t = 0.0\n    t := t + x\n    t\nf(x) => g(x) * 2\nplot(f(1))\n`
    const { out, ir } = runPine(src)
    expect(out).toEqual(Array.from({ length: N }, (_, i) => (i + 1) * 2))
    // and the effect classification propagated: f is impure because g is
    expect(ir.functions.find((f) => f.name === 'g').effects.pure).toBe(false)
    expect(ir.functions.find((f) => f.name === 'f').effects.pure).toBe(false)
  })

  it('⭐⭐ a state-derived ARGUMENT — `f(acc)` where acc is runtime state (§30)', () => {
    const src = `${head}f(x) => x * 2\nvar acc = 0.0\nacc := acc + 1\nplot(f(acc))\n`
    const { out } = runPine(src)
    expect(out).toEqual(Array.from({ length: N }, (_, i) => (i + 1) * 2))
  })

  it('⭐⭐ a PURE GRAPH value feeds a function (§49)', () => {
    const src = `${head}f(x) => x * 2\nm = ta.sma(close, 10)\nplot(f(m))\n`
    const { out, ir } = runPine(src)
    expect(ir.columns.length).toBeGreaterThan(0)
    for (let i = 0; i < N; i += 1) {
      if (i < 9) { expect(Number.isNaN(out[i])).toBe(true); continue }
      let s = 0
      for (let k = i - 9; k <= i; k += 1) s += C[k]
      expect(out[i]).toBeCloseTo((s / 10) * 2, 9)
    }
  })

  it('⭐ a member input reaches a function (§48)', () => {
    const src = `${head}step = input.int(4, "Step")\nf(x) => x * step\nplot(f(2))\n`
    const { out } = runPine(src)
    expect(out).toEqual(new Array(N).fill(8))
  })

  it('⭐ a stateful call result assigned and re-used (§31)', () => {
    const src = `${head}f(x) =>\n    var t = 0.0\n    t := t + x\n    t\nvar y = 0.0\ny := f(1) * 10\nplot(y)\n`
    const { out } = runPine(src)
    expect(out).toEqual(Array.from({ length: N }, (_, i) => (i + 1) * 10))
  })
})

describe('⛔ boundaries stated rather than approximated', () => {
  it('recursion refuses BY NAME, not by exhausting a depth limit', () => {
    expect(refusalOf(`${head}f(x) => f(x) + 1\nplot(f(close))\n`).guard).toBe('runtime:recursion')
  })

  it('a function reading a mutable GLOBAL refuses by name', () => {
    // A frame has no address for a caller's slot yet, and the plausible
    // shortcut — read it as if it were frame-local — would read a DIFFERENT
    // variable entirely.
    const src = `${head}var g = 0.0\ng := g + 1\nf(x) => x + g\nplot(f(1))\n`
    expect(refusalOf(src).guard).toBe('runtime:function-global-state')
  })

  it('a wrong argument count refuses with both numbers', () => {
    const r = refusalOf(`${head}f(a, b) => a + b\nplot(f(close))\n`)
    expect(r.message).toMatch(/takes 2 arguments, given 1/)
  })

  it('an unsupported construct in a function BODY refuses the whole program (§44)', () => {
    // ⛔ NO PARTIAL BODY EXECUTION. Compiling the statements it understands and
    // skipping the loop would produce a program that runs and computes something
    // other than what the member wrote.
    const src = `${head}f(x) =>\n    var s = 0.0\n    for i = 0 to 3\n        s := s + i\n    s\nplot(f(1))\n`
    const built = buildRuntimeIr(src, { bars: BARS })
    expect(built.ok).toBe(false)
    expect(built.refusal.guard).toBe('runtime:loop')
    expect(built.ir).toBeUndefined()
  })

  it('⭐⭐ history over a function-local variable EXECUTES, per call site (P7.2)', () => {
    // ⚰️ This asserted `runtime:history-variable` before 2F-2A, then
    // `runtime:history-function-local` after it. P7.2 built the capability, so
    // what the case proves now is the thing the refusals were protecting: the
    // ring belongs to the CALL SITE, not to the function.
    const one = `${head}f(x) =>
    var t = 0.0
    t := t + x
    t[1]
plot(f(1))
`
    const built = buildRuntimeIr(one, { bars: BARS })
    expect(built.ok, built.ok ? '' : built.refusal.message).toBe(true)
    expect(built.ir.history).toHaveLength(1)
    expect(built.ir.history[0].site).toBe(0)

    // ⛔ TWO SITES, TWO RINGS — and the counters they carry are independent,
    // which is 2E's vendor-pinned rule extended from live state to history.
    const two = `${head}f(x) =>
    var t = 0.0
    t := t + x
    t[1]
plot(f(1))
plot(f(10))
`
    const b2 = buildRuntimeIr(two, { bars: BARS })
    expect(b2.ok).toBe(true)
    expect(b2.ir.history.map((h) => h.site)).toEqual([0, 1])
    expect(new Set(b2.ir.callSites.map((c) => c.historyBase)).size).toBe(2)
  })
})

describe('⛔ resource accounting covers work inside calls (§56/§57)', () => {
  it('call depth is counted and stops by name', () => {
    const src = `${head}g(x) => x + 1\nf(x) => g(x) * 2\nplot(f(close))\n`
    let err = null
    try { runPine(src, {}, { CALL_DEPTH: 1 }) } catch (e) { err = e }
    expect(err).toBeInstanceOf(RuntimeLimitError)
    expect(err.limit).toBe('CALL_DEPTH')
  })

  it('instructions executed INSIDE a call are charged to the same budget', () => {
    // A function must not get a fresh unlimited budget — that would let any
    // program escape the ceiling by wrapping itself in a helper.
    const src = `${head}f(x) => x * 2\nplot(f(close))\n`
    const { budget, program } = runPine(src)
    expect(budget.counts.TOTAL_INSTRUCTIONS).toBeGreaterThan(program.instructions)
    expect(budget.counts.CALL_COUNT).toBe(N)
  })

  it('a call-count ceiling stops by name', () => {
    let err = null
    try { runPine(`${head}f(x) => x\nplot(f(close))\n`, {}, { CALL_COUNT: 5 }) } catch (e) { err = e }
    expect(err).toBeInstanceOf(RuntimeLimitError)
    expect(err.limit).toBe('CALL_COUNT')
  })
})
