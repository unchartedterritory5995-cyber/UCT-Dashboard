// app/src/components/chart/engine/runtime/__tests__/pointwise.test.js
//
// ─── ⭐⭐ 2F-1 — POINTWISE CALLS OVER RUNTIME STATE ─────────────────────────
//
// After 2E split it, `runtime:call-pointwise-state` was the cheapest real
// capability left in the census: 8 scripts whose only remaining wall was a
// builtin that depends on nothing but its current-bar inputs, applied to a value
// the runtime had mutated.
//
// ⛔⛔ THE CLASSIFICATION IS AUTHORITATIVE, NOT A NAME HEURISTIC (§14). A
// function executes here only if `VALUE_NAMESPACES`, `PINE_CALL_SHAPES`,
// `TABLE.functions`, `isPointwise` and `POINTWISE_FOR_PARITY` ALL agree. The
// namespace-stripping heuristic that labels refusals for the census is a
// REPORTING device and can never reach execution.
//
// ⛔ AND NO SYNTHETIC HISTORY. A pointwise function needs only this bar's values,
// so nothing here materialises a fake column to reuse a columnar implementation.
// `sma`/`ema`/`cum` over runtime state stay refused — they need real
// runtime-series semantics, and approximating them would compute a different
// Pine program.

import { describe, it, expect } from 'vitest'

import { buildRuntimeIr, pointwiseTarget } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'
import { PINE_CALL_SHAPES, VALUE_NAMESPACES } from '../../ast/pine.js'
import { TABLE, isPointwise } from '../../ast/parse.js'
import { POINTWISE_FOR_PARITY } from '../../ast/interpret.js'

const N = 40
const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1700000000 + i * 86400,
  o: 100 + i, h: 102 + i, l: 98 + i, c: 100 + i, v: 1000 + i,
}))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const head = '//@version=5\nindicator("t")\n'

function runPine(src, inputs) {
  const built = buildRuntimeIr(src, { bars: BARS, inputs: inputs || {} })
  if (!built.ok) throw new Error(`refused ${built.refusal.guard}: ${built.refusal.message}`)
  const program = lowerIrProgram(built.ir)
  const r = execute(program, { bars: N, series: SERIES, columns: program.columns, confirmed: true })
  return { out: Array.from(r.outputs[0]), outs: r.outputs.map((o) => Array.from(o)), program, budget: r.budget, ir: built.ir }
}
const refusalOf = (src) => {
  const b = buildRuntimeIr(src, { bars: BARS, inputs: {} })
  expect(b.ok, 'expected a refusal').toBe(false)
  return b.refusal
}

describe('a pointwise builtin applied to a value the runtime mutated', () => {
  it('⭐⭐ math.max over runtime state', () => {
    const { out } = runPine(`${head}var x = 0.0\nx := x + 1\nplot(math.max(x, 5))\n`)
    expect(out).toEqual(Array.from({ length: N }, (_, i) => Math.max(i + 1, 5)))
  })

  it('⭐ the bare v2 spelling resolves to the same table entry', () => {
    const { out } = runPine(`${head}var x = 0.0\nx := x + 1\nplot(max(x, 5))\n`)
    expect(out).toEqual(Array.from({ length: N }, (_, i) => Math.max(i + 1, 5)))
  })

  it('⭐ math.min, math.abs, math.sqrt, math.round, math.sign over state', () => {
    const mk = (call) => `${head}var x = 0.0\nx := x - 2\nplot(${call})\n`
    const st = (i) => -2 * (i + 1)
    expect(runPine(mk('math.min(x, -10)')).out).toEqual(Array.from({ length: N }, (_, i) => Math.min(st(i), -10)))
    expect(runPine(mk('math.abs(x)')).out).toEqual(Array.from({ length: N }, (_, i) => Math.abs(st(i))))
    expect(runPine(mk('math.sign(x)')).out).toEqual(Array.from({ length: N }, () => -1))
    expect(runPine(mk('math.round(x / 3)')).out).toEqual(Array.from({ length: N }, (_, i) => Math.round(st(i) / 3)))
  })

  it('⭐⭐ math.log RENAMES ONTO `ln` through a shape, and the rename executes', () => {
    // `PINE_CALL_SHAPES.log` is `{table:'ln', build:[{pine:0}]}` — an identity
    // build, so the classifier admits it. That is the ONE shape kind allowed here:
    // a spelling change, never an argument rewrite.
    const { out } = runPine(`${head}var x = 0.0\nx := x + 1\nplot(math.log(x))\n`)
    expect(out).toEqual(Array.from({ length: N }, (_, i) => Math.log(i + 1)))
    expect(runPine(`${head}var x = 0.0\nx := x + 1\nplot(math.log10(x))\n`).out)
      .toEqual(Array.from({ length: N }, (_, i) => Math.log10(i + 1)))
    expect(runPine(`${head}var x = 0.0\nx := x + 1\nplot(math.exp(x / 100))\n`).out)
      .toEqual(Array.from({ length: N }, (_, i) => Math.exp((i + 1) / 100)))
  })

  it('⭐⭐ na(x) over runtime state — and `na` is a Pine TYPE question, not a host null', () => {
    // `x` stays `na` until the condition first fires, so `na(x)` must answer 1
    // then 0 — a per-bar boolean the columnar lane could not have been asked for
    // here, because `x` does not exist as a column.
    const src = `${head}var x = na\nif close > 120\n    x := close\nplot(na(x) ? 1 : 0)\n`
    const { out } = runPine(src)
    let seen = false
    for (let i = 0; i < N; i += 1) {
      if (BARS[i].c > 120) seen = true
      expect(out[i], `bar ${i}`).toBe(seen ? 0 : 1)
    }
    // non-vacuity: the fixture must contain both states
    expect(out.includes(1)).toBe(true)
    expect(out.includes(0)).toBe(true)
  })

  it('⭐⭐ nz(x) — and nz(x) is nz(x, 0), pine.js\'s own ruling', () => {
    const src = `${head}var x = na\nif close > 120\n    x := close\nplot(nz(x))\n`
    const { out } = runPine(src)
    let cur = NaN
    for (let i = 0; i < N; i += 1) {
      if (BARS[i].c > 120) cur = BARS[i].c
      expect(out[i], `bar ${i}`).toBe(Number.isNaN(cur) ? 0 : cur)
    }
  })

  it('⭐ nz(x, replacement) with an explicit second argument', () => {
    const src = `${head}var x = na\nif close > 120\n    x := close\nplot(nz(x, -1))\n`
    const { out } = runPine(src)
    let cur = NaN
    for (let i = 0; i < N; i += 1) {
      if (BARS[i].c > 120) cur = BARS[i].c
      expect(out[i]).toBe(Number.isNaN(cur) ? -1 : cur)
    }
  })
})

describe('composition — the value ABI works in both directions', () => {
  it('⭐⭐ state → pointwise → state (§24)', () => {
    const src = `${head}var x = 0.0\nx := x + 3\nx := math.max(x, 10)\nplot(x)\n`
    const { out } = runPine(src)
    let x = 0
    const want = []
    for (let i = 0; i < N; i += 1) { x = Math.max(x + 3, 10); want.push(x) }
    expect(out).toEqual(want)
  })

  it('⭐⭐ stateful UDF → pointwise (§25)', () => {
    const src = `${head}f(v) =>\n    var c = 0.0\n    c := c + v\n    c\nplot(math.min(f(2), 9))\n`
    const { out } = runPine(src)
    expect(out).toEqual(Array.from({ length: N }, (_, i) => Math.min((i + 1) * 2, 9)))
  })

  it('⭐⭐ pointwise → stateful UDF (§26)', () => {
    const src = `${head}f(v) =>\n    var c = 0.0\n    c := c + v\n    c\nvar x = 0.0\nx := x + 1\nplot(f(math.min(x, 3)))\n`
    const { out } = runPine(src)
    let c = 0
    const want = []
    for (let i = 0; i < N; i += 1) { c += Math.min(i + 1, 3); want.push(c) }
    expect(out).toEqual(want)
  })

  it('⭐ pointwise inside a UDF body, and inside a branch (§23)', () => {
    const src = `${head}f(v) =>\n    var c = 0.0\n    if v > 0\n        c := math.max(c, v)\n    c\nvar x = 0.0\nx := x + 1\nplot(f(x))\n`
    const { out } = runPine(src)
    let c = 0
    const want = []
    for (let i = 0; i < N; i += 1) { const v = i + 1; if (v > 0) c = Math.max(c, v); want.push(c) }
    expect(out).toEqual(want)
  })

  it('⭐ a member input feeds a pointwise call over state', () => {
    const src = `${head}floor = input.int(7, "Floor")\nvar x = 0.0\nx := x + 1\nplot(math.max(x, floor))\n`
    const { out } = runPine(src)
    expect(out).toEqual(Array.from({ length: N }, (_, i) => Math.max(i + 1, 7)))
  })

  it('⛔ argument ORDER stays observable — a swapped pow is a different number (§28)', () => {
    const a = runPine(`${head}var x = 0.0\nx := x + 2\nplot(math.pow(x, 2))\n`).out
    const b = runPine(`${head}var x = 0.0\nx := x + 2\nplot(math.pow(2, x))\n`).out
    expect(a).toEqual(Array.from({ length: N }, (_, i) => Math.pow(2 * (i + 1), 2)))
    expect(b).toEqual(Array.from({ length: N }, (_, i) => Math.pow(2, 2 * (i + 1))))
    expect(a[3]).not.toBe(b[3])
  })
})

describe('⭐⭐ graph-vs-runtime differential for pointwise (§29)', () => {
  // Where the SAME call is expressible in both lanes — over a pure series rather
  // than over state — the two must agree. This is what proves the runtime did not
  // acquire a second implementation of a settled builtin.
  const CASES = [
    'math.max(close, 101)',
    'math.min(close, 101)',
    'math.abs(close - 110)',
    'math.sqrt(close)',
    'math.round(close / 7)',
    'math.pow(close, 2)',
    'nz(close, 0)',
  ]
  for (const call of CASES) {
    it(`⭐ ${call} agrees with the columnar lane`, () => {
      // runtime lane: force it off the pure path by touching state, then subtract
      // the state back out so the VALUE is the pure one.
      const { out } = runPine(`${head}var z = 0.0\nplot(${call} + z)\n`)
      // columnar lane: the shipped door's own translation of the same expression
      const built = buildRuntimeIr(`${head}plot(${call})\n`, { bars: BARS })
      expect(built.ok).toBe(true)
      const col = built.ir.columns[built.ir.statements[0].value.index]
      for (let i = 0; i < N; i += 1) {
        if (Number.isNaN(col[i])) expect(Number.isNaN(out[i]), `bar ${i}`).toBe(true)
        else expect(out[i], `${call} bar ${i}`).toBe(col[i])
      }
    })
  }
})

describe('⛔ what 2F-1 does NOT do — the split stays honest', () => {
  it('a WINDOWED builtin over state is still refused, never approximated (§31)', () => {
    expect(refusalOf(`${head}var x = 0.0\nx := close\nplot(ta.sma(x, 5))\n`).guard)
      .toBe('runtime:call-windowed-state')
    expect(refusalOf(`${head}var x = 0.0\nx := close\nplot(ta.ema(x, 5))\n`).guard)
      .toBe('runtime:call-windowed-state')
  })

  it('a REQUEST over state is still refused (§33)', () => {
    const r = refusalOf(`${head}var x = 0.0\nx := close\nplot(request.security(syminfo.tickerid, "D", x))\n`)
    expect(['runtime:request-with-state', 'runtime:call-windowed-state']).toContain(r.guard)
  })

  it('⛔ a non-value namespace is NOT stripped into a table collision', () => {
    // `str.upper` must not resolve to some table entry called `upper`; text is a
    // value-model change and is deferred by name (§22).
    const r = refusalOf(`${head}var x = 0.0\nx := close\nplot(str.length(str.upper("ab")) + x)\n`)
    expect(r.guard).not.toBe('runtime:call-pointwise-state')
  })

  it('⛔⛔ THE CLASSIFIER ITSELF — five authorities, and it fails closed', () => {
    // ⭐ EXERCISING THE FUNCTION, NOT RESTATING ITS DATA. While `pointwiseTarget`
    // was nested inside `buildRuntimeIr` the only reachable assertion was a
    // property of the shipped tables — so DELETING a guard broke nothing and no
    // rail noticed, because no rewrite shape happens to name a pointwise target
    // today. Hoisted and exported for exactly this.
    expect(pointwiseTarget('math.max')).toMatchObject({ table: 'max' })
    expect(pointwiseTarget('max')).toMatchObject({ table: 'max' })
    expect(pointwiseTarget('math.log')).toMatchObject({ table: 'ln' })   // an identity RENAME
    expect(pointwiseTarget('nz')).toMatchObject({ table: 'nz' })

    // ⛔ the namespace gate — a namespace that does not carry values is never stripped
    expect(pointwiseTarget('str.max')).toBeNull()
    expect(pointwiseTarget('request.max')).toBeNull()
    expect(pointwiseTarget('array.max')).toBeNull()
    // ⛔ the identity-build gate — `stoch`/`atr`/`cci` REWRITE their arguments
    expect(pointwiseTarget('ta.stoch')).toBeNull()
    expect(pointwiseTarget('ta.atr')).toBeNull()
    expect(pointwiseTarget('ta.cci')).toBeNull()
    // ⛔⛔ …AND THOSE THREE PROVE NOTHING ABOUT THE GUARD, because each names a
    // NON-pointwise table and `isPointwise` would reject it one line later —
    // measured: deleting `if (!identity) return null` left all 124 runtime tests
    // green. THIS is the case that fires it: a rewrite shape onto a target that
    // is otherwise perfectly admissible. Applying that build by passing Pine's
    // arguments straight through would compute `abs(high)` for `math.abs(x)`.
    const REWRITE_ONTO_A_POINTWISE_TARGET = {
      abs: { table: 'abs', pineArity: 1, build: [{ series: 'high' }] },
      max: { table: 'max', pineArity: 2, build: [{ pine: 1 }, { pine: 0 }] },
    }
    expect(pointwiseTarget('math.abs', REWRITE_ONTO_A_POINTWISE_TARGET)).toBeNull()
    expect(pointwiseTarget('math.max', REWRITE_ONTO_A_POINTWISE_TARGET)).toBeNull()
    // …and the control: the SAME targets through an identity build are admitted,
    // so the refusals above are the guard and not the seam.
    const IDENTITY = {
      abs: { table: 'abs', pineArity: 1, build: [{ pine: 0 }] },
      max: { table: 'max', pineArity: 2, build: [{ pine: 0 }, { pine: 1 }] },
    }
    expect(pointwiseTarget('math.abs', IDENTITY)).toMatchObject({ table: 'abs' })
    expect(pointwiseTarget('math.max', IDENTITY)).toMatchObject({ table: 'max' })
    // ⛔ declared but NOT pointwise, and not declared at all
    expect(pointwiseTarget('ta.sma')).toBeNull()
    expect(pointwiseTarget('ta.ema')).toBeNull()
    expect(pointwiseTarget('ta.cum')).toBeNull()
    expect(pointwiseTarget('iff')).toBeNull()
    // ⛔ `int` is excluded ON PURPOSE — pine.js records that cast as
    // written-and-taken-back-out, so a runtime-only implementation would diverge
    // across lanes under the member's own title.
    expect(pointwiseTarget('int')).toBeNull()
    expect(pointwiseTarget('')).toBeNull()
    expect(pointwiseTarget(undefined)).toBeNull()
  })

  it('⛔⛔ NO NON-IDENTITY SHAPE CAN REACH THE POINTWISE PATH — over the real tables', () => {
    // The property behind the guard above, asserted over the shipped tables so
    // that ADDING a rewrite shape onto a pointwise target (say a source adapter
    // onto `abs`) goes red here before the runtime can silently miscompute it.
    const identity = (shape) => Array.isArray(shape.build)
      && shape.build.every((b, i) => b && b.pine === i && Object.keys(b).length === 1)
    const offenders = []
    for (const [pineName, shape] of Object.entries(PINE_CALL_SHAPES)) {
      const table = shape.table || pineName
      const spec = TABLE.functions[table]
      const reachable = !!spec && isPointwise(spec)
        && typeof POINTWISE_FOR_PARITY[table] === 'function'
      if (reachable && !identity(shape)) offenders.push(`${pineName} -> ${table}`)
    }
    expect(offenders).toEqual([])

    // ⛔ NON-VACUITY, twice over: the predicate must actually discriminate, and
    // the loop must actually have found pointwise-reachable shapes to judge.
    expect(identity(PINE_CALL_SHAPES.max)).toBe(true)
    expect(identity(PINE_CALL_SHAPES.stoch)).toBe(false)
    expect(identity(PINE_CALL_SHAPES.atr)).toBe(false)
    const reached = Object.entries(PINE_CALL_SHAPES).filter(([n, s]) => {
      const spec = TABLE.functions[s.table || n]
      return !!spec && isPointwise(spec) && typeof POINTWISE_FOR_PARITY[s.table || n] === 'function'
    })
    expect(reached.length).toBeGreaterThan(0)
  })

  it('⛔ the value-namespace set is pine.js\'s, and it does NOT admit `str`/`request`', () => {
    expect(VALUE_NAMESPACES.has('math')).toBe(true)
    expect(VALUE_NAMESPACES.has('ta')).toBe(true)
    expect(VALUE_NAMESPACES.has('str')).toBe(false)
    expect(VALUE_NAMESPACES.has('request')).toBe(false)
    expect(VALUE_NAMESPACES.has('array')).toBe(false)
  })
})
