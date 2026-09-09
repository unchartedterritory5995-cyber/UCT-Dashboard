// app/src/components/chart/engine/runtime/__tests__/finiteWindow.test.js
//
// ─── ⭐⭐⭐ 2F-2B — FINITE-WINDOW BUILTINS OVER RUNTIME-PRODUCED SERIES ───────
//
// The series bridge. `sma(x, 5)` where `x` is a value the runtime mutated, or a
// UDF parameter — which the census says is where 21 of the 24 real scripts put it.
//
// ⛔⛔ THERE IS NO SECOND SMA. `interpret.js` declares the family in
// `FINITE_WINDOW` as `{reduce, span}` pairs, and BOTH lanes consume it: the
// columnar lane through `rolling`, which walks the whole series, and this runtime
// through a per-bar window drawn from the history rings. The reducer object is
// literally the same one. A runtime that re-derived the mean would be a second
// authority over settled arithmetic, and the first thing to diverge is the case
// nobody tests.
//
// ⛔ AND NO SYNTHETIC COLUMN. The window is built per bar, `span` wide, from the
// live value plus `span - 1` committed bars — never by materialising the whole
// series out of the ring to feed the columnar pass.
//
// ⛔ MEMBERSHIP IS AN IMPLEMENTATION FACT. `ema`/`rma` carry the previous OUTPUT;
// `valuewhen`/`barssince` search backwards for a CONDITION; `cum` accumulates
// without bound. None of them is here, and the rails below prove they are still
// refused rather than quietly averaged.

import { describe, it, expect } from 'vitest'

import { buildRuntimeIr, namespacedWindowShape } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'
import { RuntimeLimitError } from '../limits.js'
import { translatePine } from '../../ast/pine.js'
import { parseFormula } from '../../ast/parse.js'
import { interpret, FINITE_WINDOW } from '../../ast/interpret.js'

const N = 30
// A source that MOVES — a flat series makes a mean, a max and a median agree, and
// a rail that cannot tell three reducers apart is not a rail.
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

function runPine(src, inputs, limits) {
  const built = buildRuntimeIr(src, { bars: BARS, inputs: inputs || {} })
  if (!built.ok) throw new Error(`refused ${built.refusal.guard}: ${built.refusal.message}`)
  const program = lowerIrProgram(built.ir)
  const r = execute(program, { bars: N, series: SERIES, columns: program.columns, confirmed: true }, limits)
  return { out: Array.from(r.outputs[0]), outs: r.outputs.map((o) => Array.from(o)), program, budget: r.budget }
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

// Every member `interpret.js` declares, so a new one cannot be added there and
// silently go untested here.
const MEMBERS = Object.keys(FINITE_WINDOW)

describe('⭐⭐⭐ graph-vs-runtime differential — every declared member (§39)', () => {
  for (const fn of MEMBERS) {
    it(`⭐ ta.${fn} over runtime state equals the columnar lane`, () => {
      // `x := close` makes x's SERIES identical to close's, so the two lanes must
      // agree bar for bar — including the warm-up NaNs at the start.
      const { out } = runPine(`${head}var x = 0.0\nx := close\nplot(ta.${fn}(x, 4))\n`)
      sameSeries(out, pureLane(`ta.${fn}(close, 4)`), fn)
    })
  }

  it('⛔ NON-VACUITY — the fixture separates the reducers from one another', () => {
    // If the source were flat, mean/max/median/stdev would coincide and every
    // assertion above would pass for a runtime that ran the wrong reducer.
    const seen = MEMBERS.map((fn) => JSON.stringify(
      runPine(`${head}var x = 0.0\nx := close\nplot(ta.${fn}(x, 4))\n`).out.slice(6, 12)))
    expect(new Set(seen).size, 'distinct answers across members').toBeGreaterThan(6)
  })

  it('⭐ several lengths, including span 1 and a long one', () => {
    for (const n of [1, 2, 5, 12]) {
      const { out } = runPine(`${head}var x = 0.0\nx := close\nplot(ta.sma(x, ${n}))\n`)
      sameSeries(out, pureLane(`ta.sma(close, ${n})`), `sma len ${n}`)
    }
  })

  it('⭐ `rising`/`falling` keep their n+1 span — the table owns it, not the call site', () => {
    // ⛔ `ta.rising(x, n)` compares n+1 BARS to answer about n intervals. Asking
    // for n bars would be one short on every call; the span lives in
    // `FINITE_WINDOW` so the two lanes cannot disagree about it.
    expect(FINITE_WINDOW.rising.span(3)).toBe(4)
    expect(FINITE_WINDOW.sma.span(3)).toBe(3)
    const { program } = runPine(`${head}var x = 0.0\nx := close\nplot(ta.rising(x, 3))\n`)
    expect(program.windows[0].span).toBe(4)
  })
})

describe('⭐⭐ the source can be any runtime series, at any scope', () => {
  it('⭐ TOP-LEVEL state that is NOT a copy of a price series', () => {
    // ⛔ The `x := close` cases above could pass for a runtime that quietly used
    // the ORIGINAL column. This one cannot: `x` is a running sum that exists only
    // because the runtime built it.
    const src = `${head}var acc = 0.0\nacc := acc + close\nplot(ta.sma(acc, 3))\n`
    const { out } = runPine(src)
    const seen = []
    let a = 0
    for (let i = 0; i < N; i += 1) { a += BARS[i].c; seen.push(a) }
    for (let i = 0; i < N; i += 1) {
      if (i < 2) { expect(Number.isNaN(out[i]), `bar ${i}`).toBe(true); continue }
      expect(out[i], `bar ${i}`).toBeCloseTo((seen[i] + seen[i - 1] + seen[i - 2]) / 3, 9)
    }
  })

  it('⭐⭐ a UDF PARAMETER — the shape 21 of 24 real scripts use', () => {
    const { out } = runPine(`${head}f(v) =>\n    ta.sma(v, 4)\nplot(f(close))\n`)
    sameSeries(out, pureLane('ta.sma(close, 4)'), 'udf param')
  })

  it('⭐ a UDF LOCAL', () => {
    const { out } = runPine(`${head}f(v) =>\n    y = v * 2\n    ta.sma(y, 4)\nplot(f(close))\n`)
    sameSeries(out, pureLane('ta.sma(close * 2, 4)'), 'udf local')
  })

  it('⭐⭐ a UDF PERSISTENT local — 2E state, P7.2 history and 2F-2B windows at once', () => {
    const src = `${head}f(v) =>\n    var c = 0.0\n    c := c + v\n    ta.sma(c, 3)\nplot(f(1))\n`
    const { out } = runPine(src)
    // c counts invocations: 1, 2, 3 …
    for (let i = 0; i < N; i += 1) {
      if (i < 2) { expect(Number.isNaN(out[i]), `bar ${i}`).toBe(true); continue }
      expect(out[i], `bar ${i}`).toBeCloseTo(((i + 1) + i + (i - 1)) / 3, 9)
    }
  })

  it('⭐⭐⭐ TWO call sites keep separate windows', () => {
    const src = `${head}f(v) =>\n    ta.sma(v, 3)\nplot(f(close))\nplot(f(open * 10))\n`
    const { outs, program } = runPine(src)
    // ⚰️ THIS ASSERTED **ONE** PLAN FOR TWO SITES, AND IT WAS RIGHT UNTIL THE NA
    // POLICIES LANDED. 2F-2B could share a plan entry because the window's only
    // per-bar storage was a scratch buffer — filled and reduced inside one
    // opcode, so it could never span two sites. The measured `skip` policy needs
    // a ring of the last n FINITE observations, which is STATE; two call sites
    // sharing one would interleave two series into a single window. So windows
    // are now materialised per site, like `persistBase`, `historyBase` and
    // `carriedBase` before them — the fourth use of that addressing.
    expect(program.windows).toHaveLength(2)
    expect(program.callSites[0].windowBase).not.toBe(program.callSites[1].windowBase)
    expect(program.callSites).toHaveLength(2)
    expect(program.callSites[0].historyBase).not.toBe(program.callSites[1].historyBase)
    sameSeries(outs[0], pureLane('ta.sma(close, 3)'), 'site 0')
    sameSeries(outs[1], pureLane('ta.sma(open * 10, 3)'), 'site 1')
    expect(outs[0][10]).not.toBe(outs[1][10])
  })

  it('⭐ NESTED UDFs', () => {
    const src = `${head}g(w) =>\n    ta.sma(w, 3)\nf(v) =>\n    g(v) + ta.sma(v, 3)\nplot(f(close))\n`
    const { out } = runPine(src)
    const want = pureLane('ta.sma(close, 3)')
    sameSeries(out, want.map((v) => v * 2), 'nested')
  })
})

describe('⭐⭐ cross-feature seams — windows are not an island', () => {
  it('⚠️ SKIPPED call site + window — INFERRED, NOT MEASURED (see the note)', () => {
    // ⛔⛔ THE NA POLICIES MADE THIS CASE AMBIGUOUS AND IT IS NOW OPEN EVIDENCE.
    //
    // A `propagate` window reads the committed ring, which P7.2 vendor-pinned as
    // CHART-BAR indexed and HOLDING across a skipped call. A `skip` window reads
    // its own observation ring, which can only be appended when the opcode RUNS
    // — i.e. invocation-indexed, exactly like the carried state whose skipped-UDF
    // behaviour WAS vendor-pinned (`recurrent-na-and-skipped-callsite`).
    //
    // So the two policies now index differently for a window inside a
    // conditionally-executed UDF, and NOTHING MEASURES WHICH IS RIGHT. The
    // implementation follows the nearest evidence — a builtin inside a skipped
    // UDF does not advance — but that is an INFERENCE from the recurrent family,
    // not an observation of the window family. Recorded in the gap register; a
    // probe is named there. This case asserts what the code does so the choice is
    // visible, and is labelled so nobody reads it as vendor-pinned.
    const src = `${head}f(v) =>\n    ta.sma(v, 3)\ngo = bar_index % 2 == 0\nfloat p = na\nif go\n    p := f(bar_index)\nplot(p)\nplot(go ? 1 : 0)\n`
    const { outs } = runPine(src)
    const [p, D] = outs
    // ⭐ `sma` is a SKIP member, so its observation ring appends only on the bars
    // where the call actually runs: the answer is the mean of the last three
    // EXECUTED invocations, not of a held chart-bar series.
    const executed = []
    for (let i = 0; i < N; i += 1) if (D[i] === 1) executed.push(i)
    let seen = 0
    for (const i of executed) {
      seen += 1
      if (seen < 3) { expect(Number.isNaN(p[i]), `bar ${i} warm-up`).toBe(true); continue }
      const last3 = executed.slice(seen - 3, seen)
      expect(p[i], `bar ${i}`).toBeCloseTo((last3[0] + last3[1] + last3[2]) / 3, 9)
    }
    // ⛔ NON-VACUITY: a chart-bar-indexed reading gives a DIFFERENT number, so
    // this fixture can tell the two models apart — which is exactly why the
    // choice needed recording rather than assuming.
    const k = executed[10]
    const held = [k, k - 1, k - 2].map((b) => (b % 2 === 0 ? b : b - 1))
    expect((held[0] + held[1] + held[2]) / 3).not.toBeCloseTo(p[k], 6)
  })
  it('⭐ else-if → state → window (P7.4 × 2F-2B)', () => {
    const src = `${head}var s = 0.0\nif close > 110\n    s := 2\nelse if close > 100\n    s := 1\nelse\n    s := 0\nplot(ta.sma(s, 3))\n`
    const { out } = runPine(src)
    const seen = BARS.map((b) => (b.c > 110 ? 2 : b.c > 100 ? 1 : 0))
    for (let i = 2; i < N; i += 1) {
      expect(out[i], `bar ${i}`).toBeCloseTo((seen[i] + seen[i - 1] + seen[i - 2]) / 3, 9)
    }
    expect(new Set(seen).size, 'the fixture must reach more than one arm').toBeGreaterThan(1)
  })

  it('⭐ pointwise → state → window (2F-1 × 2F-2B)', () => {
    const src = `${head}var x = 0.0\nx := math.max(close, 100)\nplot(ta.sma(x, 3))\n`
    const { out } = runPine(src)
    const seen = BARS.map((b) => Math.max(b.c, 100))
    for (let i = 2; i < N; i += 1) {
      expect(out[i], `bar ${i}`).toBeCloseTo((seen[i] + seen[i - 1] + seen[i - 2]) / 3, 9)
    }
  })

  it('⭐ history AND a window over the same series', () => {
    const src = `${head}var x = 0.0\nx := close\nplot(ta.sma(x, 3) - x[2])\n`
    const { out } = runPine(src)
    const sma = pureLane('ta.sma(close, 3)')
    for (let i = 2; i < N; i += 1) expect(out[i], `bar ${i}`).toBeCloseTo(sma[i] - BARS[i - 2].c, 9)
  })
})

describe('⭐⭐ the NA POLICIES, over a GAPPY RUNTIME SERIES (2026-09-08 ruling)', () => {
  // ⛔ THESE CASES EXIST BECAUSE THREE MUTATIONS SURVIVED WITHOUT THEM. Once
  // `sma` moved to the `skip` policy it stopped reading the history ring, so
  // every rail that used `sma` also stopped covering the ring — the run
  // boundary, the per-site base and the ring depth all went untested at once. A
  // suite can lose coverage by a change that breaks nothing.
  const gappy = `var x = 0.0\nx := bar_index % 7 == 0 and bar_index > 4 ? na : close\n`

  it('⭐⭐ RESTART — `highest` begins again after a hole, and stops AT it', () => {
    const { outs } = runPine(`${head}${gappy}plot(ta.highest(x, 5))\nplot(ta.lowest(x, 5))\n`)
    const [hi, lo] = outs
    const src = BARS.map((b, i) => (i % 7 === 0 && i > 4 ? NaN : b.c))
    for (let i = 6; i < N; i += 1) {
      if (Number.isNaN(src[i])) { expect(Number.isNaN(hi[i]), `bar ${i} is the hole`).toBe(true); continue }
      let start = i
      while (start > i - 4 && start > 0 && Number.isFinite(src[start - 1])) start -= 1
      const run = src.slice(start, i + 1)
      expect(hi[i], `bar ${i}`).toBeCloseTo(Math.max(...run), 10)
      expect(lo[i], `bar ${i}`).toBeCloseTo(Math.min(...run), 10)
    }
    // ⛔ NON-VACUITY: reducing across the hole would give a different answer.
    const after = 7 + 1
    expect(hi[after]).toBeCloseTo(src[after], 10)
    expect(hi[after]).not.toBeCloseTo(Math.max(...src.slice(after - 4, after + 1).filter(Number.isFinite)), 6)
  })

  it('⭐ SKIP — `sma` answers ON the hole, over the last 5 finite values', () => {
    const { out } = runPine(`${head}${gappy}plot(ta.sma(x, 5))\n`)
    const src = BARS.map((b, i) => (i % 7 === 0 && i > 4 ? NaN : b.c))
    for (let i = 12; i < N; i += 1) {
      const f = []
      for (let k = i; k >= 0 && f.length < 5; k -= 1) if (Number.isFinite(src[k])) f.push(src[k])
      if (f.length < 5) continue
      expect(out[i], `bar ${i}`).toBeCloseTo(f.reduce((a, b) => a + b, 0) / 5, 9)
    }
    const hole = 14
    expect(Number.isNaN(src[hole])).toBe(true)
    expect(Number.isFinite(out[hole]), 'skip answers ON the hole').toBe(true)
  })

  it('⭐⭐ a PROPAGATE member still uses the committed RING, per call site', () => {
    // `wma` stayed on `propagate`, so it is what now exercises `historyBase` and
    // the ring depth that `sma` used to cover.
    const src = `${head}f(v) =>\n    ta.wma(v, 4)\nplot(f(close))\nplot(f(open * 3))\n`
    const { outs, program } = runPine(src)
    expect(program.history.length, 'one ring per call site').toBe(2)
    for (const h of program.history) expect(h.depth, 'depth is span - 1').toBe(3)
    expect(program.callSites[0].historyBase).not.toBe(program.callSites[1].historyBase)
    sameSeries(outs[0], pureLane('ta.wma(close, 4)'), 'wma site 0')
    sameSeries(outs[1], pureLane('ta.wma(open * 3, 4)'), 'wma site 1')
  })
})
describe('⭐ length semantics and resources', () => {
  it('⭐ an INPUT-DERIVED length folds, freezing the default as `pine.js` does', () => {
    const src = `${head}n = input.int(5, "Len")\nvar x = 0.0\nx := close\nplot(ta.sma(x, n))\n`
    const { out, program } = runPine(src)
    expect(program.windows[0].span).toBe(5)
    sameSeries(out, pureLane('ta.sma(close, 5)'), 'input length')
  })

  it('⛔ a length only known while the bar runs refuses, and SAYS length', () => {
    // ⛔ A RING IS SIZED BEFORE BAR 0. A length that only exists once the bar
    // is running cannot size one, so it must refuse rather than pick a width.
    const src = `${head}var x = 0.0\nx := close\nplot(ta.sma(x, bar_index))\n`
    const r = refusalOf(src)
    expect(r.guard).toBe('runtime:history-dynamic-offset')
    // ⭐ THE GUARD IS SHARED WITH `x[n]` ON PURPOSE (one knob, one meaning) but
    // the SENTENCE must name a length, or it points the reader at the ring.
    expect(r.message).toMatch(/length of/)
    expect(r.message).not.toMatch(/^a history offset/)
  })

  it('⚠️ MEASURED GAP — ARITHMETIC over an input does NOT fold yet', () => {
    // A bare input name folds because `pine.js` substitutes the frozen default
    // and the canonical node IS a `num`. `k + 2` stays an `op` node, so the
    // fold refuses. That is CONSERVATIVE — a refusal, never a wrong width — but
    // it is a real gap and this pins it as a fact rather than folklore. Closing
    // it means consulting `pine.js`'s own `constantValueOf` (with its fold
    // budget), which touches history offsets too and is therefore NOT 2F-2B's
    // to change. ⛔ If this test ever goes red because the length now folds,
    // that is the fix landing — assert the value, do not delete the case.
    const src = `${head}k = input.int(5, "K")\nvar x = 0.0\nx := close\nplot(ta.sma(x, k + 2))\n`
    expect(refusalOf(src).guard).toBe('runtime:history-dynamic-offset')
  })

  it('⛔ a FRACTIONAL or NEGATIVE length refuses — a ring has whole cells', () => {
    // ⛔ SURFACED BY A SURVIVING MUTATION. The fold checks `Number.isInteger`
    // and `>= 0`, and nothing exercised either — so cutting both halves left the
    // suite green. A window of 2.5 bars is not a thing to round; it is a thing
    // to refuse.
    for (const bad of ['2.5', '0', '-3']) {
      const src = `${head}var x = 0.0\nx := close\nplot(ta.sma(x, ${bad}))\n`
      const b = buildRuntimeIr(src, { bars: BARS, inputs: {} })
      expect(b.ok, `length ${bad} must not compile`).toBe(false)
    }
  })
  it('⭐ the ring is sized to span-1, not to the whole history', () => {
    const { program } = runPine(`${head}var x = 0.0\nx := close\nplot(ta.sma(x, 8))\n`)
    expect(program.history[0].depth).toBe(7)
    expect(program.windows[0].span).toBe(8)
  })

  it('⛔ WINDOW_CELLS is charged, and stops by name', () => {
    const { budget } = runPine(`${head}var x = 0.0\nx := close\nplot(ta.sma(x, 5))\n`)
    // ⚰️ THIS WAS `5 * (N - 4)` — cells charged only past the warm-up, because a
    // `propagate` window returns before charging while the ring is short. `sma`
    // is a SKIP member now: its observation ring is fed on EVERY bar (that is how
    // it finds the last n finite values), so it charges from bar 0. The number
    // moved because the work moved, which is what a cost counter is for.
    expect(FINITE_WINDOW.sma.na, 'this count belongs to the skip policy').toBe('skip')
    expect(budget.counts.WINDOW_CELLS).toBe(5 * N)
    let err = null
    try { runPine(`${head}var x = 0.0\nx := close\nplot(ta.sma(x, 5))\n`, {}, { WINDOW_CELLS: 20 }) } catch (e) { err = e }
    expect(err).toBeInstanceOf(RuntimeLimitError)
    expect(err.limit).toBe('WINDOW_CELLS')
  })
})

describe('⛔⛔ what 2F-2B does NOT admit — the families stay apart', () => {
  it('RECURRENT builtins are still not FINITE-WINDOW members (2F-2C runs them elsewhere)', () => {
    // ⚰️ These asserted a REFUSAL until 2F-2C. The family separation is what
    // mattered and it still holds — `ema`/`rma` execute through `CARRIED`, never
    // through a window — so the assertion moves from 'is refused' to 'is not a
    // member', which is the property this file actually owns.
    for (const fn of ['ema', 'rma']) {
      expect(FINITE_WINDOW[fn], `${fn} must not be a finite-window member`).toBeUndefined()
      const b = buildRuntimeIr(`${head}var x = 0.0\nx := close\nplot(ta.${fn}(x, 5))\n`,
        { bars: BARS, inputs: {} })
      expect(b.ok, `${fn} should execute via CARRIED`).toBe(true)
      expect(b.ir.windows, `${fn} must not allocate a window`).toHaveLength(0)
      expect(b.ir.carried.map((c) => c.fn)).toEqual([fn])
    }
  })

  it('SCAN-BACKWARDS builtins are still refused', () => {
    expect(FINITE_WINDOW.barssince).toBeUndefined()
    expect(FINITE_WINDOW.valuewhen).toBeUndefined()
    expect(refusalOf(`${head}var x = 0.0\nx := close\nplot(ta.barssince(x > 100))\n`).guard)
      .toBe('runtime:call-windowed-state')
  })

  it('CUMULATIVE and undeclared builtins are still refused', () => {
    expect(FINITE_WINDOW.cum).toBeUndefined()
    expect(refusalOf(`${head}var x = 0.0\nx := close\nplot(ta.cum(x))\n`).guard)
      .toBe('runtime:call-undeclared-builtin-state')
  })

  it('⛔⛔ A PINE SPELLING THE TABLE HOLDS UNDER ANOTHER NAME IS NOT "UNDECLARED"', () => {
    // `PINE_CALL_SHAPES` maps eight Pine names onto a differently-spelled table
    // entry — `crossover`→`crossOver`, `log`→`ln`, `wpr`→`williams_r`, and the
    // four DMI legs. `builtinStateFamily` asked the table with the BARE PINE
    // NAME and missed every one, answering `call-undeclared-builtin-state`:
    // "the closed table does not have this builtin". It does. That refusal
    // sends the next engineer to ADD A BUILTIN THAT ALREADY EXISTS, and it is
    // the same misfiling `plot(...)` bound to a name caused in 2F-2.
    //
    // ⚠️ AND IT MOVED NO CORPUS NUMBER — `call-undeclared-builtin-state` is 2
    // scripts before and after, because no corpus script hits one of the eight
    // as its FIRST blocker. A diagnostic can be wrong without being visible.
    const r = refusalOf(`${head}var x = 0.0\nx := close\nplot(ta.crossover(x, 105) ? 1 : 0)\n`)
    expect(r.guard).not.toBe('runtime:call-undeclared-builtin-state')
    expect(r.guard).toBe('runtime:call-windowed-state')
    // ⭐ NON-VACUITY: a name the table genuinely does NOT declare must still
    // answer `undeclared`, or the fix has simply deleted the family.
    expect(refusalOf(`${head}var x = 0.0\nx := close\nplot(ta.cum(x))\n`).guard)
      .toBe('runtime:call-undeclared-builtin-state')
  })
  it('⛔ a window over an EXPRESSION needs its own series, and says so', () => {
    expect(refusalOf(`${head}var x = 0.0\nx := close\nplot(ta.sma(x + 1, 3))\n`).guard)
      .toBe('runtime:history-expression')
  })

  it('⛔ a non-value namespace cannot reach a window reducer', () => {
    // `str.` is not stripped, so nothing there can collide with a table entry.
    const r = refusalOf(`${head}var x = 0.0\nx := close\nplot(str.length(str.tostring(x)) + ta.sma(x, 2))\n`)
    expect(r.guard).toBe('runtime:call-text-state')
  })
})

describe('⛔⛔ THE NAMESPACED-REWRITE CLASSIFIER — exercised, not restated', () => {
  // ⭐ THE SHIPPED TABLE CANNOT FALSIFY THIS FUNCTION. `PINE_NAMESPACED_TREE`
  // holds four entries and the only two that reach a window are already the
  // right shape, so against it every guard but the `u-` test is dead code: strip
  // the arity check, the argument-identity check or the table-membership check
  // and all 35 cases above stay green. That is the `histPresent` situation this
  // wave already deleted one guard over — so rather than keep ceremony, the
  // `tree` parameter lets the rail hand in rewrites the real table cannot spell.
  const A = (t) => t[0]
  const B = (t) => t[1]
  const op = (name, args) => ({ type: 'op', name, args })
  const call = (name, args) => ({ type: 'call', name, args })
  const negated = (fn) => (t) => op('u-', [call(fn, [A(t), B(t)])])

  it('⭐ admits a bare negated window, and reports WHICH member', () => {
    expect(namespacedWindowShape('x.f', { 'x.f': negated('highest') }))
      .toEqual({ table: 'highest', negate: true })
  })

  it('⭐ a name the table does not rewrite is `undefined`, NOT a refusal', () => {
    // The caller must go on to the namespace-strip path; conflating "not
    // rewritten" with "rewritten into something unusable" would refuse `ta.sma`.
    expect(namespacedWindowShape('ta.sma', { 'x.f': negated('sma') })).toBeUndefined()
  })

  for (const [why, build] of [
    ['no negation at all', (t) => call('highest', [A(t), B(t)])],
    ['a different operator', (t) => op('u+', [call('highest', [A(t), B(t)])])],
    ['negating two things', (t) => op('u-', [call('highest', [A(t), B(t)]), A(t)])],
    ['not a call inside', (t) => op('u-', [A(t)])],
    ['a NON-member table entry', (t) => op('u-', [call('ema', [A(t), B(t)])])],
    ['a name the closed table never declares', (t) => op('u-', [call('nope', [A(t), B(t)])])],
    ['the wrong arity', (t) => op('u-', [call('highest', [A(t)])])],
    ['ARGUMENTS REORDERED', (t) => op('u-', [call('highest', [B(t), A(t)])])],
    ['a DEFAULTED source — negatedBars’ own 1-arg form', () => op('u-', [call('lowest', [{ type: 'series', name: 'low' }, { type: 'num', value: 5 }])])],
    ['an argument wrapped on the way through', (t) => op('u-', [call('highest', [op('u-', [A(t)]), B(t)])])],
    ['a builder that throws', () => { throw new Error('boom') }],
    ['a builder that answers null', () => null],
  ]) {
    it(`⛔ REFUSES (null) — ${why}`, () => {
      expect(namespacedWindowShape('x.f', { 'x.f': build })).toBeNull()
    })
  }

  it('⭐ and the SHIPPED table still answers what the fixtures above rely on', () => {
    // ⛔ The synthetic cases prove the guards CAN fire; this proves the real
    // table still reaches them — a rail on a mock alone would pass with the
    // production wiring cut.
    expect(namespacedWindowShape('ta.highestbars')).toEqual({ table: 'highestbars', negate: true })
    expect(namespacedWindowShape('ta.lowestbars')).toEqual({ table: 'lowestbars', negate: true })
    // ⛔ `ta.pivothigh` IS rewritten, into a confirmation-bar SHIFT this runtime
    // cannot serve — so it refuses rather than falling through to be admitted.
    expect(namespacedWindowShape('ta.pivothigh')).toBeNull()
    expect(namespacedWindowShape('ta.sma')).toBeUndefined()
  })
})
