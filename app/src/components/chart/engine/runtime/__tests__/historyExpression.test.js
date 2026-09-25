// app/src/components/chart/engine/runtime/__tests__/historyExpression.test.js
//
// ─── ⭐⭐⭐ HISTORY / WINDOW / CHANGE OVER AN **EXPRESSION** ─────────────────
//
// `runtime:history-expression` is three refusal sites with one root cause: a
// history offset, a finite window and `ta.change` each need a COMMITTED SERIES,
// and until now only a declared variable had one. `(x + 1)[1]`, `ta.sma(x+1,5)`
// and `ta.change(x*2)` are ordinary Pine and every one of them refused.
//
// ⭐⭐ THE FIX IS THE REWRITE THE REFUSAL ALREADY DESCRIBED — PERFORMED, NOT
// DEMANDED. The message read *"needs that expression's own committed series"*,
// and a member's answer to it is to write `tmp = x + 1` on the line above. That
// binding is now hoisted for them, exactly as `request.security`'s region has
// hoisted one since `477da5bc8`. There is no new evaluation model: a hoisted
// `tmp` is an ordinary slot with an ordinary ring.
//
// ⛔⛔ THE SCOPE IS THE ROOT STATEMENT LIST, AND THAT IS A CORRECTNESS BOUND,
// NOT A CONVENIENCE. A declare hoisted out of an `if` body would run on every
// bar, while the window inside the body runs only on the bars the branch takes
// — two different series, and TradingView's answer for a conditionally-called
// `ta.*` is NOT vendor-pinned here (`carriedState.test.js` pins the opposite
// rule for recurrences: they step only when called). So a root statement
// hoists and everything else keeps refusing BY NAME. Rails below.
//
// ⛔⛔ AND A NAME THAT IS NOT IN SCOPE MUST STILL REFUSE
// `runtime:function-global-state`. Hoisting *anything* the site could not
// resolve is the shortcut, and it would lift a refusal nobody asked to lift —
// the exact failure `pineRuntimeFrontend.js` records for the wider
// deferred-function inlining. Only a node that is genuinely NOT A NAME hoists.
//
// ⭐ THE ORACLE IS THE SHIPPED COLUMNAR LANE. `pureLane('ta.sma(close+1,5)')`
// runs the production door over the same bars, so "identical" here is a
// measurement against the lane that already serves members, never a
// hand-computed expectation.

import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { STMT } from '../ir.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'
import { translatePine } from '../../ast/pine.js'
import { parseFormula } from '../../ast/parse.js'
import { interpret } from '../../ast/interpret.js'

const N = 40
// ⛔ A MOVING, NON-MONOTONIC SOURCE. On a flat or straight-line series a mean,
// a lagged read and the source itself all agree, and every assertion below
// would pass for a runtime that hoisted the WRONG subtree.
const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1700000000 + i * 86400,
  o: 100 + i,
  h: 102 + i + (i % 3),
  l: 98 + i - (i % 4),
  c: 100 + Math.sin(i / 2.3) * 12 + i * 0.7,
  v: 1000 + i * 13,
}))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const head = '//@version=5\nindicator("t")\n'
/** The two lines that give `x` a mutable slot carrying `close`. */
const state = 'var x = 0.0\nx := close\n'

function build(src, inputs) {
  const b = buildRuntimeIr(src, { bars: BARS, inputs: inputs || {} })
  if (!b.ok) throw new Error(`refused ${b.refusal.guard}: ${b.refusal.message}`)
  return b
}
function runPine(src, inputs) {
  const built = build(src, inputs)
  const program = lowerIrProgram(built.ir)
  const r = execute(program, {
    bars: N, series: SERIES, columns: program.columns, confirmed: true,
  })
  return { out: Array.from(r.outputs[0]), program, ir: built.ir }
}
const refusalOf = (src, inputs) => {
  const b = buildRuntimeIr(src, { bars: BARS, inputs: inputs || {} })
  expect(b.ok, 'expected a refusal, got a program').toBe(false)
  return b.refusal
}
/** The SHIPPED columnar door's answer for the same Pine expression. */
function pureLane(expr) {
  const t = translatePine(`${head}plot(${expr})\n`)
  expect(t.ok, JSON.stringify(t.refusal || {})).toBe(true)
  const parsed = parseFormula(t.outputs[0].formula)
  expect(parsed.ok).toBe(true)
  const col = interpret(parsed.ast, BARS, {})
  return Array.from({ length: N }, (_, i) => (typeof col === 'number' ? col : col[i]))
}
const sameSeries = (got, want, label) => {
  for (let i = 0; i < N; i += 1) {
    if (Number.isNaN(want[i])) expect(Number.isNaN(got[i]), `${label} bar ${i} should be na`).toBe(true)
    else expect(got[i], `${label} bar ${i}`).toBeCloseTo(want[i], 10)
  }
}

describe('⭐⭐⭐ history over an EXPRESSION', () => {
  it('⛔ CONTROL — a PURE expression offset already runs, so the fixture can distinguish', () => {
    // `(close + open)[1]` reads no slot, so it never reaches this capability at
    // all: the whole tree goes to the columnar lane. If this ever fails, every
    // case below is measuring the wrong seam.
    const { out } = runPine(`${head}plot((close + open)[1])\n`)
    sameSeries(out, pureLane('(close + open)[1]'), 'pure offset control')
    expect(Number.isNaN(out[0]), 'bar 0 has no previous bar').toBe(true)
  })

  it('⭐⭐ `(x + 1)[1]` over a mutable slot answers the columnar lane\'s series', () => {
    const { out } = runPine(`${head}${state}plot((x + 1)[1])\n`)
    sameSeries(out, pureLane('(close + 1)[1]'), 'expression offset')
  })

  it('⭐ `(x + 1)[0]` IS `x + 1` — and allocates no ring', () => {
    const { out, ir } = runPine(`${head}${state}plot((x + 1)[0])\n`)
    sameSeries(out, pureLane('close + 1'), 'zero offset')
    expect(ir.history, 'a zero offset needs no ring').toHaveLength(0)
  })

  it('⭐⭐ THE HOIST LANDS BEFORE THE STATEMENT THAT NEEDS IT', () => {
    // ⛔⛔ ORDER IS THE WHOLE CORRECTNESS ARGUMENT, and a value comparison
    // cannot make it. A binding emitted AFTER the plot would read one bar stale
    // on every bar — and against a series that is itself lagged, "one bar
    // stale" is a plausible-looking curve. The structure is what says it.
    const { ir } = runPine(`${head}${state}plot((x + 1)[1])\n`)
    const kinds = ir.statements.map((s) => s.kind)
    const hoistAt = kinds.lastIndexOf(STMT.DECLARE)
    const emitAt = kinds.indexOf(STMT.EMIT)
    expect(emitAt, 'the plot is emitted').toBeGreaterThan(-1)
    expect(hoistAt, 'the hoisted binding exists').toBeGreaterThan(-1)
    expect(hoistAt, 'the hoist runs BEFORE the statement that reads it').toBeLessThan(emitAt)
    // ⛔ NON-VACUITY: the hoist is a statement the source does not contain.
    // `var x = 0.0` is the only declare the member wrote, so two proves one was
    // added rather than that a pre-existing one happened to sit early.
    expect(kinds.filter((k) => k === STMT.DECLARE).length,
      'the hoist ADDS a declare').toBe(2)
    expect(ir.slots.some((s) => /^history src /.test(s.name)),
      'and it is the synthetic one, named so no Pine identifier can collide').toBe(true)
  })

  it('⭐⭐ TWO DIFFERENT EXPRESSIONS GET TWO RINGS — never one shared series', () => {
    const { ir } = runPine(`${head}${state}plot((x + 1)[1] + (x * 2)[1])\n`)
    expect(ir.history.length, 'one ring per hoisted expression').toBe(2)
  })
})

describe('⭐⭐⭐ a FINITE WINDOW over an EXPRESSION', () => {
  it('⛔ CONTROL — a window over a plain SLOT already runs', () => {
    const { out } = runPine(`${head}${state}plot(ta.sma(x, 5))\n`)
    sameSeries(out, pureLane('ta.sma(close, 5)'), 'window over a slot control')
  })

  it('⭐⭐ `ta.sma(x + 1, 5)` answers the columnar lane\'s series', () => {
    const { out } = runPine(`${head}${state}plot(ta.sma(x + 1, 5))\n`)
    sameSeries(out, pureLane('ta.sma(close + 1, 5)'), 'window over an expression')
  })

  it('⭐⭐ COMPUTED LENGTH — an INPUT NAME, not a literal, still sizes the ring', () => {
    // ⛔⛔ THE ITEM-(1) PRINCIPLE FROM `table.clear`, and it is why this case
    // exists at all: an integer literal at the call site folds to a constant, so
    // a rail built only from literals leaves the path that RESOLVES AND FOLDS a
    // length completely unexercised. Here the length is a NAME the folder has to
    // chase to an input declaration.
    //
    // ⭐ THE DEFAULT IS 7 AND NO OTHER NUMBER IN THIS FILE IS 7, so a fallback
    // to a hardcoded width could not pass this by coincidence.
    const src = `${head}len = input.int(7, "len")\n${state}plot(ta.sma(x + 1, len))\n`
    const { out, ir } = runPine(src)
    expect(ir.windows[0].span, 'the ring is sized from the input').toBe(7)
    sameSeries(out, pureLane('ta.sma(close + 1, 7)'), 'computed window length')

    // ⚠️⚠️ AND WHAT IS FROZEN IS THE INPUT'S **DEFAULT**, NOT A LATER OVERRIDE.
    // That is `pine.js`'s deliberate rule (owner decision 2026-08-11, pinned by
    // `history.test.js`), and this case agrees with that authority rather than
    // becoming a second one: a hoisted expression's ring must obey exactly the
    // rule a named variable's ring already obeys, or a member's knob would mean
    // one thing over `x` and another over `x + 1`.
    const { ir: ir3 } = runPine(src, { len: 3 })
    expect(ir3.windows[0].span, 'an override does not resize a frozen ring').toBe(7)
  })

  it('⭐⭐ COMPUTED OFFSET — a history offset from an INPUT NAME, not a literal', () => {
    const src = `${head}back = input.int(3, "back")\n${state}plot((x + 1)[back])\n`
    const { out, ir } = runPine(src)
    expect(ir.history[0].depth, 'the ring depth is folded from the input').toBe(3)
    sameSeries(out, pureLane('(close + 1)[3]'), 'computed history offset')
    const { ir: ir5 } = runPine(src, { back: 5 })
    expect(ir5.history[0].depth, 'an override does not deepen a frozen ring').toBe(3)
  })

  it('⭐ `ta.highest` over an expression — the window family, not just `sma`', () => {
    const { out } = runPine(`${head}${state}plot(ta.highest(x * 2, 4))\n`)
    sameSeries(out, pureLane('ta.highest(close * 2, 4)'), 'highest over an expression')
  })
})

describe('⭐⭐⭐ `ta.change` over an EXPRESSION', () => {
  it('⛔ CONTROL — `ta.change` over a plain SLOT already runs', () => {
    const { out } = runPine(`${head}${state}plot(ta.change(x))\n`)
    sameSeries(out, pureLane('ta.change(close)'), 'change over a slot control')
  })

  it('⭐⭐ `ta.change(x * 2)` answers the columnar lane\'s series', () => {
    const { out } = runPine(`${head}${state}plot(ta.change(x * 2))\n`)
    sameSeries(out, pureLane('ta.change(close * 2)'), 'change over an expression')
  })
})

describe('⛔⛔ WHAT STILL REFUSES — every wall named', () => {
  it('⛔ a name the site cannot resolve still refuses `runtime:function-global-state`', () => {
    // ⛔⛔ THE LIFTED-REFUSAL TRAP. Hoisting whatever the site could not resolve
    // would make this compile, and it must not: a function reading a mutable
    // global is a separate capability with its own measurement. Only a node
    // that is genuinely NOT A NAME may hoist.
    const r = refusalOf(`${head}${state}f() =>\n    ta.sma(x, 5)\nplot(f())\n`)
    expect(r.guard).toBe('runtime:function-global-state')
  })

  it('⛔ history over an expression INSIDE A FUNCTION still refuses by name', () => {
    expect(refusalOf(`${head}f(v) =>\n    (v + 1)[1]\nplot(f(close))\n`).guard)
      .toBe('runtime:history-expression')
  })

  it('⛔ a window over an expression INSIDE A FUNCTION still refuses by name', () => {
    expect(refusalOf(`${head}f(v) =>\n    ta.sma(v + 1, 5)\nplot(f(close))\n`).guard)
      .toBe('runtime:history-expression')
  })

  it('⛔⛔ inside an `if` BODY it still refuses — the hoist would change WHEN it runs', () => {
    const src = `${head}${state}var y = 0.0\nif close > 0\n    y := ta.sma(x + 1, 5)\nplot(y)\n`
    expect(refusalOf(src).guard).toBe('runtime:history-expression')
  })

  it('⛔ a RUNTIME-DERIVED offset over an expression refuses `runtime:history-dynamic-offset`', () => {
    const r = refusalOf(`${head}${state}plot((x + 1)[bar_index % 3])\n`)
    expect(r.guard).toBe('runtime:history-dynamic-offset')
  })
})
