// app/src/components/chart/engine/runtime/__tests__/carriedState.test.js
//
// ─── ⭐⭐⭐ 2F-2C — GENERALIZED CARRIED-STATE BUILTIN EXECUTION ───────────────
//
// A finite window answers from `span` recent INPUTS. A carried builtin answers
// from a few scalars it has been keeping, and remembers its own OUTPUT — which
// no window of inputs can supply. `interpret.js::CARRIED` is that family, and
// `{cells, init, step}` is to it what `{span, reduce}` is to `FINITE_WINDOW`.
//
// ⛔⛔ THERE IS NO SECOND EMA. `smoothStep` is the whole rule; `smoothCol` is a
// driver over it for the columnar lane and `OP.CARRIED` is a driver over it for
// the bar loop. Neither computes an exponential average of its own.
//
// ⛔⛔ AND NO RING. A recurrence reads ONE value per bar. Allocating a history
// ring for its inputs — the obvious reuse of 2F-2A's machinery — would reserve
// memory the semantics never asked for; the rails below assert the ring is NOT
// allocated, because "it works and it is wasteful" is invisible otherwise.
//
// ⛔⛔ IT STEPS INSIDE THE CALL. TradingView advances a recurrent builtin only on
// bars where its call actually executes (vendor-pinned 2026-09-08). History does
// the OPPOSITE — chart-bar indexed, HOLDS across a skipped site (P7.2). Two
// lifetimes, two rules; building this on the end-of-bar commit phase would
// silently implement the model the vendor excludes.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { buildRuntimeIr, carriedTarget } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'
import { RuntimeLimitError } from '../limits.js'
import { translatePine } from '../../ast/pine.js'
import { parseFormula } from '../../ast/parse.js'
import { interpret, CARRIED, FINITE_WINDOW } from '../../ast/interpret.js'

const N = 40
// ⛔ A MOVING SOURCE. On a flat series an EMA, an RMA and the source itself all
// converge to the same number, and every assertion below would pass for a
// runtime that ran the wrong member (`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`).
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

function build(src, inputs) {
  const b = buildRuntimeIr(src, { bars: BARS, inputs: inputs || {} })
  if (!b.ok) throw new Error(`refused ${b.refusal.guard}: ${b.refusal.message}`)
  return b
}
function runPine(src, inputs, limits) {
  const built = build(src, inputs)
  const program = lowerIrProgram(built.ir)
  const r = execute(program, { bars: N, series: SERIES, columns: program.columns, confirmed: true }, limits)
  return { out: Array.from(r.outputs[0]), outs: r.outputs.map((o) => Array.from(o)), program, budget: r.budget, ir: built.ir }
}
const refusalOf = (src) => {
  const b = buildRuntimeIr(src, { bars: BARS, inputs: {} })
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

const MEMBERS = Object.keys(CARRIED)

describe('⭐⭐⭐ graph-vs-runtime differential — every declared member (§47/§76)', () => {
  for (const fn of MEMBERS) {
    it(`⭐ ta.${fn} over runtime state equals the columnar lane, index for index`, () => {
      const { out } = runPine(`${head}var x = 0.0\nx := close\nplot(ta.${fn}(x, 6))\n`)
      const want = pureLane(`ta.${fn}(close, 6)`)
      // ⛔ THE WARM-UP IS PART OF THE COMPARISON. A recurrence's early bars are
      // where a seeding difference lives and the only place it is ever visible;
      // comparing from bar 20 is how this class of defect survives.
      expect(want.slice(0, 5).every((v) => Number.isNaN(v)), 'the fixture must exercise a warm-up').toBe(true)
      sameSeries(out, want, fn)
    })
  }

  it('⛔ NON-VACUITY — the members are distinguishable on this fixture', () => {
    const seen = MEMBERS.map((fn) =>
      JSON.stringify(runPine(`${head}var x = 0.0\nx := close\nplot(ta.${fn}(x, 6))\n`).out.slice(10, 16)))
    expect(new Set(seen).size, 'ema and rma must not agree here').toBe(MEMBERS.length)
  })

  it('⭐ several lengths, including 1', () => {
    for (const n of [1, 2, 9, 20]) {
      const { out } = runPine(`${head}var x = 0.0\nx := close\nplot(ta.ema(x, ${n}))\n`)
      sameSeries(out, pureLane(`ta.ema(close, ${n})`), `ema len ${n}`)
    }
  })
})

describe('⭐⭐ the source can be any runtime value, at any scope', () => {
  it('⭐ TOP-LEVEL state that is NOT a copy of a price column', () => {
    // ⛔ `x := close` cases could pass for a runtime that quietly used the
    // original column. A running sum exists only because the bar loop built it.
    const src = `${head}var acc = 0.0\nacc := acc + close\nplot(ta.ema(acc, 3))\n`
    const { out } = runPine(src)
    const seen = []
    let a = 0
    for (let i = 0; i < N; i += 1) { a += BARS[i].c; seen.push(a) }
    const k = 2 / 4
    let prev = NaN
    for (let i = 0; i < N; i += 1) {
      if (i < 2) { expect(Number.isNaN(out[i]), `bar ${i}`).toBe(true); continue }
      prev = i === 2 ? (seen[0] + seen[1] + seen[2]) / 3 : prev * (1 - k) + seen[i] * k
      expect(out[i], `bar ${i}`).toBeCloseTo(prev, 9)
    }
  })

  it('⭐⭐ AN EXPRESSION SOURCE — a recurrence needs no committed series', () => {
    // ⛔ THE ASYMMETRY WITH 2F-2B IS DELIBERATE AND LOAD-BEARING.
    // `ta.sma(x + 1, 5)` refuses (`runtime:history-expression`) because a window
    // needs a committed series; `ta.ema(x + 1, 5)` executes, because a
    // recurrence reads only this bar's value.
    const { out, ir } = runPine(`${head}var x = 0.0\nx := close\nplot(ta.ema(x + 1, 5))\n`)
    sameSeries(out, pureLane('ta.ema(close + 1, 5)'), 'expression source')
    expect(ir.history, 'an expression source must allocate NO ring').toHaveLength(0)
    expect(refusalOf(`${head}var x = 0.0\nx := close\nplot(ta.sma(x + 1, 5))\n`).guard)
      .toBe('runtime:history-expression')
  })

  it('⭐⭐ a UDF PARAMETER', () => {
    const { out } = runPine(`${head}f(v) =>\n    ta.ema(v, 5)\nplot(f(close))\n`)
    sameSeries(out, pureLane('ta.ema(close, 5)'), 'udf param')
  })

  it('⭐ a UDF LOCAL', () => {
    const { out } = runPine(`${head}f(v) =>\n    y = v * 2\n    ta.ema(y, 5)\nplot(f(close))\n`)
    sameSeries(out, pureLane('ta.ema(close * 2, 5)'), 'udf local')
  })

  it('⭐⭐ a UDF PERSISTENT local — 2E, P7.2 and 2F-2C in one expression', () => {
    const src = `${head}f(v) =>\n    var c = 0.0\n    c := c + v\n    ta.ema(c, 3)\nplot(f(1))\n`
    const { out } = runPine(src)
    const k = 2 / 4
    let prev = NaN
    for (let i = 0; i < N; i += 1) {
      const c = i + 1
      if (i < 2) { expect(Number.isNaN(out[i]), `bar ${i}`).toBe(true); continue }
      prev = i === 2 ? (1 + 2 + 3) / 3 : prev * (1 - k) + c * k
      expect(out[i], `bar ${i}`).toBeCloseTo(prev, 9)
    }
  })

  it('⭐ NESTED UDFs keep distinct instances', () => {
    const src = `${head}g(w) =>\n    ta.ema(w, 4)\nf(v) =>\n    g(v) + ta.ema(v, 4)\nplot(f(close))\n`
    const { out, ir } = runPine(src)
    // two instances: the inner g's and the outer f's
    expect(ir.carried).toHaveLength(2)
    sameSeries(out, pureLane('ta.ema(close, 4)').map((v) => v * 2), 'nested')
  })
})

describe('⛔⛔ INSTANCE IDENTITY — the silent-wrong-result surface (§19/§20/§39)', () => {
  it('⛔⛔ TWO CALL SITES OF ONE UDF NEVER SHARE STATE', () => {
    // ⭐ THE VENDOR'S OWN DISCRIMINATOR. EMA is linear, so independent state
    // makes the second site EXACTLY twice the first; shared state interleaves
    // two inputs through one filter and admits no such identity. TradingView
    // gives |b - 2a| = 0 on every captured bar
    // (`recurrent-callsite-identity-and-event-history-spy-1d-2026-09-08`).
    const src = `${head}f(v) =>\n    ta.ema(v, 5)\nplot(f(close))\nplot(f(close * 2))\n`
    const { outs, program } = runPine(src)
    expect(program.carried).toHaveLength(2)
    expect(program.callSites[0].carriedBase).not.toBe(program.callSites[1].carriedBase)
    for (let i = 0; i < N; i += 1) {
      if (Number.isNaN(outs[0][i])) { expect(Number.isNaN(outs[1][i])).toBe(true); continue }
      expect(outs[1][i], `bar ${i}: site 2 must be exactly twice site 1`).toBeCloseTo(2 * outs[0][i], 9)
    }
    // ⛔ NON-VACUITY: the two sites really do carry different numbers.
    expect(outs[0][20]).not.toBeCloseTo(outs[1][20], 3)
  })

  it('⛔⛔ TWO TOP-LEVEL CALLS of the same builtin never share state', () => {
    const src = `${head}var x = 0.0\nx := close\nplot(ta.ema(x, 5))\nplot(ta.ema(x * 3, 5))\n`
    const { outs, program } = runPine(src)
    expect(program.carried).toHaveLength(2)
    for (let i = 0; i < N; i += 1) {
      if (Number.isNaN(outs[0][i])) continue
      expect(outs[1][i], `bar ${i}`).toBeCloseTo(3 * outs[0][i], 9)
    }
  })

  it('⭐ ONE instance PERSISTS across bars — state is not re-created per bar (§21)', () => {
    // ⛔ A runtime that re-initialised every bar would warm up forever and emit
    // `na` on every bar; one that kept state but re-seeded would track the
    // source exactly. Both are excluded by matching the columnar lane, but the
    // failure is named here so the diagnosis is one line rather than a hunt.
    const { out } = runPine(`${head}var x = 0.0\nx := close\nplot(ta.ema(x, 5))\n`)
    expect(out.slice(10).every((v) => Number.isFinite(v)), 'state must survive the bar boundary').toBe(true)
    const close = BARS.map((b) => b.c)
    expect(out[30], 'an EMA must LAG its source, not equal it').not.toBeCloseTo(close[30], 6)
  })
})

describe('⭐⭐ cross-feature seams (§40–§44)', () => {
  it('⛔⛔ SKIPPED CALL SITE — the recurrence does NOT step (vendor-pinned)', () => {
    // ⭐⭐ THE MEASURED TRADINGVIEW RULE. `f`'s internal EMA advances only on the
    // bars where `f` actually runs, so the result is an EMA of the EVEN-BAR
    // SUBSEQUENCE — not an every-bar EMA sampled on even bars.
    const src = `${head}f(v) =>\n    ta.ema(v, 3)\ngo = bar_index % 2 == 0\nfloat p = na\nif go\n    p := f(close)\nplot(p)\nplot(go ? 1 : 0)\n`
    const { outs } = runPine(src)
    const [p, D] = outs
    const evens = []
    for (let i = 0; i < N; i += 1) if (D[i] === 1) evens.push(i)
    const k = 2 / 4
    let prev = NaN
    let seen = 0
    for (const i of evens) {
      seen += 1
      if (seen < 3) { expect(Number.isNaN(p[i]), `bar ${i} warm-up`).toBe(true); continue }
      prev = seen === 3
        ? (BARS[evens[0]].c + BARS[evens[1]].c + BARS[evens[2]].c) / 3
        : prev * (1 - k) + BARS[i].c * k
      expect(p[i], `bar ${i}`).toBeCloseTo(prev, 9)
    }
    // ⛔ NON-VACUITY: the EXCLUDED model (step every chart bar with the held
    // input) gives a different number, so this fixture can tell them apart.
    const every = pureLane('ta.ema(close, 3)')
    const last = evens[evens.length - 1]
    expect(p[last]).not.toBeCloseTo(every[last], 3)
  })

  it('⭐ a `var` skipped site HOLDS its output while its state does not advance', () => {
    // ⛔ THE TWO HALVES ARE DIFFERENT MECHANISMS AND BOTH ARE VENDOR-PINNED:
    // P7.2 says a HELD series holds across skipped bars; 2F-2C says the
    // recurrence inside does not step. Asserting only one lets the other regress.
    //
    // ⚰️ AND `var` IS LOAD-BEARING IN THE FIXTURE ITSELF. Written `float p = na`
    // this test failed at bar 5 — correctly: a plain local is re-initialised to
    // `na` EVERY bar, so it cannot hold anything, while the case above (which
    // reads only executed bars) passes either way. The vendor probe used
    // `var float pif = na` for exactly this reason. Two Pine constructs, one
    // keyword apart, and only one of them can express 'holds'.
    const src = `${head}f(v) =>\n    ta.ema(v, 3)\ngo = bar_index % 2 == 0\nvar float p = na\nif go\n    p := f(close)\nplot(p)\nplot(go ? 1 : 0)\n`
    const { outs } = runPine(src)
    const [p, D] = outs
    for (let i = 1; i < N; i += 1) {
      if (D[i] === 1) continue
      if (Number.isNaN(p[i - 1])) continue
      expect(p[i], `bar ${i} holds the previous value`).toBeCloseTo(p[i - 1], 12)
    }
  })

  it('⭐ else-if → state → recurrence (P7.4 × 2F-2C)', () => {
    const src = `${head}var s = 0.0\nif close > 110\n    s := 2\nelse if close > 100\n    s := 1\nelse\n    s := 0\nplot(ta.ema(s, 3))\n`
    const { out } = runPine(src)
    const seen = BARS.map((b) => (b.c > 110 ? 2 : b.c > 100 ? 1 : 0))
    expect(new Set(seen).size, 'the fixture must reach more than one arm').toBeGreaterThan(1)
    const k = 2 / 4
    let prev = NaN
    for (let i = 0; i < N; i += 1) {
      if (i < 2) continue
      prev = i === 2 ? (seen[0] + seen[1] + seen[2]) / 3 : prev * (1 - k) + seen[i] * k
      expect(out[i], `bar ${i}`).toBeCloseTo(prev, 9)
    }
  })

  it('⭐ pointwise → recurrence (2F-1 × 2F-2C)', () => {
    const src = `${head}var x = 0.0\nx := math.max(close, 100)\nplot(ta.ema(x, 4))\n`
    const { out } = runPine(src)
    sameSeries(out, pureLane('ta.ema(math.max(close, 100), 4)'), 'pointwise feed')
  })

  it('⭐⭐ FINITE WINDOW → recurrence, and recurrence → finite window (2F-2B × 2F-2C)', () => {
    // Sophisticated Pine composes the families; both directions must hold.
    const a = runPine(`${head}var x = 0.0\nx := close\nvar w = 0.0\nw := ta.sma(x, 4)\nplot(ta.ema(w, 3))\n`)
    sameSeries(a.out, pureLane('ta.ema(ta.sma(close, 4), 3)'), 'window then recurrence')
    const b = runPine(`${head}var x = 0.0\nx := close\nvar e = 0.0\ne := ta.ema(x, 3)\nplot(ta.sma(e, 4))\n`)
    sameSeries(b.out, pureLane('ta.sma(ta.ema(close, 3), 4)'), 'recurrence then window')
    expect(b.program.windows.length, 'the window half still allocates a ring').toBeGreaterThan(0)
  })

  it('⭐ history AND recurrence over the same series', () => {
    const src = `${head}var x = 0.0\nx := close\nplot(ta.ema(x, 3) - x[2])\n`
    const { out } = runPine(src)
    const e = pureLane('ta.ema(close, 3)')
    for (let i = 2; i < N; i += 1) expect(out[i], `bar ${i}`).toBeCloseTo(e[i] - BARS[i - 2].c, 9)
  })
})

describe('⭐ length, resources and what is NOT admitted', () => {
  it('⭐ an INPUT-DERIVED length folds, freezing the default as `pine.js` does', () => {
    const src = `${head}n = input.int(7, "Len")\nvar x = 0.0\nx := close\nplot(ta.ema(x, n))\n`
    const { out, program } = runPine(src)
    expect(program.carried[0].n).toBe(7)
    sameSeries(out, pureLane('ta.ema(close, 7)'), 'input length')
  })

  it('⛔ a length only known while the bar runs refuses, and SAYS length', () => {
    const r = refusalOf(`${head}var x = 0.0\nx := close\nplot(ta.ema(x, bar_index))\n`)
    expect(r.guard).toBe('runtime:history-dynamic-offset')
    expect(r.message).toMatch(/length of/)
  })

  it('⛔⛔ NO RING IS ALLOCATED FOR A CARRIED SOURCE (§33)', () => {
    // ⭐ THE PERFORMANCE WIN, ASSERTED. `ta.ema(x, 200)` describes itself in terms
    // of prior OUTPUTS, and the lazy reading is "so it needs 200 prior inputs".
    // It needs three scalars. A regression here is invisible in every value test.
    const { ir, program } = runPine(`${head}var x = 0.0\nx := close\nplot(ta.ema(x, 200))\n`)
    expect(ir.history, 'a recurrence must allocate no history ring').toHaveLength(0)
    expect(program.windows).toHaveLength(0)
    expect(program.carried).toHaveLength(1)
  })

  it('⭐ carried resources are counted, and stop BY NAME', () => {
    const { budget } = runPine(`${head}var x = 0.0\nx := close\nplot(ta.ema(x, 5))\n`)
    expect(budget.counts.CARRIED_INSTANCES).toBe(1)
    expect(budget.counts.CARRIED_CELLS).toBe(CARRIED.ema.cells)
    expect(budget.counts.CARRIED_STEPS).toBe(N)
    let err = null
    try {
      runPine(`${head}var x = 0.0\nx := close\nplot(ta.ema(x, 5))\n`, {}, { CARRIED_STEPS: 10 })
    } catch (e) { err = e }
    expect(err).toBeInstanceOf(RuntimeLimitError)
    expect(err.limit).toBe('CARRIED_STEPS')
  })

  it('⛔ the families stay apart — a member is in exactly one table', () => {
    for (const fn of Object.keys(CARRIED)) {
      expect(FINITE_WINDOW[fn], `${fn} is in BOTH tables`).toBeUndefined()
    }
    for (const fn of Object.keys(FINITE_WINDOW)) {
      expect(CARRIED[fn], `${fn} is in BOTH tables`).toBeUndefined()
    }
  })

  it('⛔ still refused: a window COMPOSITE, a shipped-impl builtin, an undeclared one', () => {
    expect(refusalOf(`${head}var x = 0.0\nx := close\nplot(ta.hma(x, 5))\n`).guard)
      .toBe('runtime:call-windowed-state')
    expect(refusalOf(`${head}var x = 0.0\nx := close\nplot(ta.rsi(x, 5))\n`).guard)
      .toBe('runtime:call-windowed-state')
    expect(refusalOf(`${head}var x = 0.0\nx := close\nplot(ta.cum(x))\n`).guard)
      .toBe('runtime:call-undeclared-builtin-state')
  })

  it('⛔⛔ `barssince`/`valuewhen` are NOT carried members, and the reason is not shyness', () => {
    // They are the same SHAPE (a forward pass over two scalars) and they are
    // excluded because `pine.js` refuses the Pine spellings BY NAME: Pine's are
    // unbounded / occurrence-indexed, this table's are bounded / period-indexed.
    // Admitting them would build a runtime for a spelling no member can reach.
    expect(CARRIED.barssince).toBeUndefined()
    expect(CARRIED.valuewhen).toBeUndefined()
    for (const src of ['ta.barssince(close > open)', 'ta.valuewhen(close > open, close, 0)']) {
      const t = translatePine(`${head}plot(${src})\n`)
      expect(t.ok, `${src} should be refused at the Pine door`).toBe(false)
      expect(t.refusal.guard).toBe('pine:function')
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────

const VENDOR_DIR = path.resolve(process.cwd(), '../tests/fixtures/vendor/runtime')
const readObs = (f) => JSON.parse(fs.readFileSync(path.join(VENDOR_DIR, f), 'utf8'))

describe('⭐⭐⭐ VENDOR — what TradingView actually does (2026-09-08)', () => {
  const obs = readObs('recurrent-na-and-skipped-callsite-spy-1d-2026-09-08.json')

  it('⭐⭐ THE STEP FUNCTION REPRODUCES THE VENDOR, SEEDED FROM THE VENDOR', () => {
    // ⛔⛔ WHY IT IS SEEDED FROM THEIR VALUE AND NOT FROM BAR 0. TradingView runs
    // its studies over history that predates any capture window, so the vendor's
    // value at the first captured bar already carries state we cannot see
    // (`divergences.json::recursive-smoother-cold-start-in-a-finite-capture`).
    // Comparing absolute values would measure that artifact, not the maths. What
    // IS comparable — and what actually pins the recurrence — is the TRANSITION:
    // given their value and the next bar's source, does our step land on their
    // next value?
    const rows = obs.vendor.skippedCallSite.filter((r) => r.go === 1)
    expect(rows.length, 'the fixture must carry executed invocations').toBeGreaterThan(4)
    const spec = CARRIED.ema
    const st = new Float64Array(spec.cells)
    let checked = 0
    for (let i = 1; i < rows.length; i += 1) {
      st[0] = rows[i - 1].pt          // seed prev from THEIR value
      st[1] = 5
      st[2] = 0
      const got = spec.step(st, 0, rows[i].close, 5, spec.alpha(5))
      expect(got, `executed invocation at bar_index ${rows[i].bar_index}`)
        .toBeCloseTo(rows[i].pt, 9)
      checked += 1
    }
    expect(checked).toBeGreaterThan(4)
  })

  it('⛔⛔ AND THE EXCLUDED MODEL IS EXCLUDED BY THE SAME ROWS', () => {
    // A rail that only confirms the chosen model can pass while the wrong one
    // would too. These rows separate them: an every-chart-bar recurrence would
    // make `pt` equal `every` on executed bars, and it never does.
    const rows = obs.vendor.skippedCallSite.filter((r) => r.go === 1)
    for (const r of rows) {
      expect(r.pt, `bar_index ${r.bar_index}`).not.toBeCloseTo(r.every, 6)
    }
  })

  it('⚰️⚰️ `na` INPUT — THE VENDOR HOLDS, WE RESET, AND THAT IS A KNOWN DEFECT', () => {
    // ⛔ THIS RAIL ASSERTS OUR *WRONG* BEHAVIOUR ON PURPOSE, so the divergence
    // cannot be closed by accident and cannot be fixed without someone reading
    // this. `divergences.json::nan-restarts-the-smoother` is `confirmed` with
    // this observation; flipping `smoothStep` changes every shipped chart whose
    // source has a mid-series hole, which is an owner ruling.
    const spec = CARRIED.ema
    const st = new Float64Array(spec.cells)
    spec.init(st, 0)
    for (let i = 0; i < 10; i += 1) spec.step(st, 0, 100 + i, 10, spec.alpha(10))
    const before = st[0]
    expect(Number.isFinite(before)).toBe(true)
    expect(Number.isNaN(spec.step(st, 0, NaN, 10, spec.alpha(10))), 'the hole itself is na').toBe(true)
    // OURS: the state is gone and the next finite bar starts a fresh warm-up.
    expect(Number.isNaN(st[0]), 'ours resets').toBe(true)
    expect(Number.isNaN(spec.step(st, 0, 110, 10, spec.alpha(10))), 'ours is still warming').toBe(true)

    // THEIRS, read off the chart: a value on the VERY NEXT BAR, and it is the
    // pre-hole state stepped once.
    const h = obs.vendor.naHole
    const at = h.findIndex((r) => r.srcna === null)
    expect(at, 'the fixture must contain a hole').toBeGreaterThan(0)
    expect(h[at + 1].ena, 'the vendor emits a number on the next bar').not.toBeNull()
    const k = 2 / 11
    expect(h[at + 1].ena).toBeCloseTo(h[at - 1].ena * (1 - k) + h[at + 1].srcna * k, 9)
    const kr = 1 / 10
    expect(h[at + 1].rna).toBeCloseTo(h[at - 1].rna * (1 - kr) + h[at + 1].srcna * kr, 9)
  })

  it('⭐ call-site independence, on the vendor\'s own numbers', () => {
    const o2 = readObs('recurrent-callsite-identity-and-event-history-spy-1d-2026-09-08.json')
    for (const r of o2.vendor.rows) {
      expect(r.b_f_close_times_2, `bar_index ${r.bar_index}`).toBeCloseTo(2 * r.a_f_close, 9)
    }
  })
})

describe('⭐⭐ §49 — the refactor itself is behaviour-preserving', () => {
  /** The ORIGINAL loop, transcribed before the factoring. ⛔ An independent
   *  longhand, not a call into the thing under test — comparing `smoothCol` to
   *  itself would pass for any implementation. */
  function originalSmooth(series, n, k) {
    const out = new Float64Array(series.length).fill(NaN)
    let prev = NaN
    let count = 0
    let sum = 0
    for (let i = 0; i < series.length; i += 1) {
      const v = series[i]
      if (!Number.isFinite(v)) { prev = NaN; count = 0; sum = 0; continue }
      if (Number.isNaN(prev)) {
        sum += v
        count += 1
        if (count === n) { prev = sum / n; out[i] = prev }
      } else {
        prev = prev * (1 - k) + v * k
        out[i] = prev
      }
    }
    return out
  }
  /** The SHIPPED path, driven through the shared step. */
  function viaTable(series, n, fn) {
    const spec = CARRIED[fn]
    const st = new Float64Array(spec.cells)
    spec.init(st, 0)
    const k = spec.alpha(n)
    return Array.from(series, (v) => spec.step(st, 0, v, n, k))
  }

  const CASES = {
    plain: Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 3) * 10),
    'holes in the middle': Array.from({ length: 60 }, (_, i) => (i === 25 || i === 26 ? NaN : 100 + i)),
    'hole before the seed': Array.from({ length: 60 }, (_, i) => (i === 2 ? NaN : 100 + i)),
    'all na': Array.from({ length: 20 }, () => NaN),
    'shorter than n': [1, 2, 3],
    'infinity': Array.from({ length: 30 }, (_, i) => (i === 10 ? Infinity : 50 + i)),
    'negatives': Array.from({ length: 40 }, (_, i) => -100 + i * 3),
  }

  for (const fn of MEMBERS) {
    for (const [label, data] of Object.entries(CASES)) {
      for (const n of [1, 4, 14]) {
        it(`⭐ ${fn} n=${n} — ${label}: old === new`, () => {
          const k = CARRIED[fn].alpha(n)
          const want = originalSmooth(data, n, k)
          const got = viaTable(data, n, fn)
          expect(got).toHaveLength(want.length)
          for (let i = 0; i < want.length; i += 1) {
            if (Number.isNaN(want[i])) expect(Number.isNaN(got[i]), `bar ${i}`).toBe(true)
            else expect(got[i], `bar ${i}`).toBe(want[i])   // ⛔ EXACT, not close
          }
        })
      }
    }
  }

  it('⛔ NON-VACUITY — the longhand really can disagree', () => {
    // If `originalSmooth` were accidentally equivalent to anything, this suite
    // would prove nothing. A deliberately wrong alpha must break it.
    const data = CASES.plain
    const want = originalSmooth(data, 4, CARRIED.ema.alpha(4))
    const wrong = originalSmooth(data, 4, CARRIED.rma.alpha(4))
    expect(want[30]).not.toBe(wrong[30])
  })
})

describe('⛔⛔ THE CARRIED CLASSIFIER — exercised, not restated', () => {
  const op = (name, args) => ({ type: 'op', name, args })
  const call = (name, args) => ({ type: 'call', name, args })

  it('⭐ the shipped tables still answer what the fixtures rely on', () => {
    expect(carriedTarget('ta.ema')).toEqual({ table: 'ema' })
    expect(carriedTarget('ta.rma')).toEqual({ table: 'rma' })
    expect(carriedTarget('ta.sma'), 'a finite-window member is not carried').toBeNull()
    expect(carriedTarget('ta.cum'), 'undeclared by the closed table').toBeNull()
    expect(carriedTarget('str.ema'), 'a non-value namespace cannot reach the table').toBeNull()
  })

  it('⛔ A NAMESPACED REWRITE REFUSES — the `ta.highestbars` lesson, pre-paid', () => {
    // ⚠️ UNREACHABLE WITH THE SHIPPED TABLES: no `CARRIED` member is rewritten
    // by `PINE_NAMESPACED_TREE`, so this guard changes no answer today and a
    // mutation run WOULD report it surviving. That is the `histPresent`
    // situation — except the guard is not dead ceremony, it is the exact defect
    // 2F-2B shipped and had to fix. So it is made REACHABLE instead of argued
    // for: a synthetic tree names a carried member the way `ta.highestbars`
    // names a window member.
    const tree = { 'ta.ema': (a) => op('u-', [call('ema', a)]) }
    expect(carriedTarget('ta.ema', tree), 'a rewritten member must refuse, not reach the bare entry')
      .toBeNull()
    // ⭐ CONTROL: with an EMPTY tree the same name is admitted, so the refusal
    // above is the guard firing and not the name failing some other check.
    expect(carriedTarget('ta.ema', {})).toEqual({ table: 'ema' })
  })

  it('⛔ membership belongs to the TABLE, and a synthetic one proves the lookup is live', () => {
    // With `sma` injected as a carried member the classifier admits it; against
    // the real table it does not. A hard-coded name list would fail both ways.
    expect(carriedTarget('ta.sma', {}, { sma: {} })).toEqual({ table: 'sma' })
    expect(carriedTarget('ta.sma')).toBeNull()
    // ...but the CLOSED TABLE still gates it: a name it never declares is out
    // even when the carried table claims it.
    expect(carriedTarget('ta.notathing', {}, { notathing: {} })).toBeNull()
  })
})
