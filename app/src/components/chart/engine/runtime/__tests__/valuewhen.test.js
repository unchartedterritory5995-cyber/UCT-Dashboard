// app/src/components/chart/engine/runtime/__tests__/valuewhen.test.js
//
// ─── ⭐⭐ `ta.valuewhen` — OCCURRENCES, NOT A BAR WINDOW ─────────────────────
//
// ⛔⛔ THIS ENGINE ALREADY HAS A FUNCTION CALLED `valuewhen`, AND IT IS A
// DIFFERENT FUNCTION. `interpret.js::valueWhen(cond, src, n)` counts BARS — it
// answers `held` only while `since < n`, so it means "the value when the
// condition was last true, if that was within the last n bars". Pine's third
// argument is an OCCURRENCE INDEX: 0 is the most recent firing, 1 the one
// before it, and two firings may be a thousand bars apart. The two line up
// positionally and answer different numbers, which is why
// `docs/pine/computation-crossref.md` records refusing `ta.valuewhen` as a
// DELIBERATE RULING rather than as a gap.
//
// ⭐⭐ SO THIS IS A TWIN, NOT A REPLACEMENT. The host/columnar lane keeps its
// bar-window `valuewhen` untouched — it is a screener function with a frozen
// column contract — and the runtime lane gets Pine's. Same shape as the ATR
// question: when a vendor function and a house function share a name, give the
// vendor one its own implementation rather than moving numbers the scanner
// trades on.
//
// ⭐⭐⭐ EVERY RULE BELOW IS MEASURED OFF TRADINGVIEW, NOT REASONED ABOUT.
// `tests/fixtures/vendor/r11-valuewhen-spy-2026-09-11.json`, AMEX:SPY 1D, 610
// bars, probe `tools/visual_conformance/probes/r11-valuewhen.pine`:
//
//   Q4  occurrence 0 is INCLUSIVE — the most recent firing COUNTING THIS BAR.
//       122 discriminating bars, 122 matched inclusive, 0 matched exclusive.
//   Q2/Q3  occurrence N is the Nth most recent FIRING. The probe's condition
//       fires every 5th bar, and 5 is the ONLY value either delta takes across
//       610 bars — not 1, which is what counting BARS would give.
//   Q1  never fired is `na`, not 0, on all 610 bars. 0 is the dangerous answer:
//       `valuewhen(cond, x, 0) > 0` would read "never happened" as a real zero.
//
// ⭐ THE ORACLE TECHNIQUE IS THE PROBE'S, AND IT IS WHAT MAKES THIS TESTABLE.
// With `cond = bar_index % 5 == 0` the right answer is computable from
// `bar_index` alone, so the inclusive and exclusive readings can BOTH be
// written down and the bars where they DIFFER marked. Only those bars are
// evidence; on every other bar the two agree, and a comparison across all bars
// would look like agreement with both.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const N = 40
const BARS = Array.from({ length: N }, (_, i) => (
  { t: 1700000000 + i * 86400, o: 100 + (i % 3), h: 105, l: 95, c: 100 + (i % 7), v: 10 + i }))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const head = '//@version=6\nindicator("t")\n'

function run(src) {
  const built = buildRuntimeIr(head + src, { bars: BARS, inputs: {} })
  if (!built.ok) throw new Error(`refused: ${built.refusal.guard} — ${built.refusal.message}`)
  const program = lowerIrProgram(built.ir)
  const res = execute(program, {
    bars: N, series: SERIES, columns: program.columns, confirmed: true,
    barTimes: BARS.map((b) => b.t),
  })
  return res.outputs.map((o) => Array.from(o))
}

const refusalOf = (src) => {
  const built = buildRuntimeIr(head + src, { bars: BARS, inputs: {} })
  expect(built.ok, 'expected a refusal, got a program').toBe(false)
  return built.refusal
}

const REPO = path.resolve(process.cwd(), '..')
const FIXTURE = path.join(REPO, 'tests/fixtures/vendor/r11-valuewhen-spy-2026-09-11.json')

describe('⭐⭐ `ta.valuewhen` counts OCCURRENCES — measured on the vendor', () => {
  it('⛔⛔ CONTROL — the vendor capture still says what this file implements', () => {
    // ⭐ THE RULES ARE READ FROM THE CAPTURE, NOT RETYPED. A test that restates
    // a vendor verdict in its own words is a second authority over it, and it
    // stays green when the capture is replaced by one that says otherwise.
    const fx = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))
    const q4 = fx.Q4_occurrence_zero_includes_the_current_bar
    expect(q4.verdict).toMatch(/^INCLUSIVE/)
    expect(q4.occ0_matched_EXCLUSIVE).toBe(0)
    expect(q4.occ0_matched_INCLUSIVE).toBe(q4.discriminatingBars)
    expect(fx.Q2_Q3_occurrences_count_FIRINGS.occ0_minus_occ1_distinctValues).toEqual([5])
    expect(fx.Q1_never_fired.verdict).toBe('na')
  })

  it('⭐⭐ Q4 — occurrence 0 is INCLUSIVE on the discriminating bars', () => {
    // On a FIRING bar the inclusive answer is this bar and the exclusive answer
    // is five bars back. Those are the only bars that can settle it.
    const [v0, incl, excl, d] = run(
      'cond = bar_index % 5 == 0\n'
      + 'exp_incl = bar_index - (bar_index % 5)\n'
      + 'exp_excl = cond ? exp_incl - 5 : exp_incl\n'
      + 'plot(ta.valuewhen(cond, bar_index, 0))\n'
      + 'plot(exp_incl)\nplot(exp_excl)\nplot(exp_incl != exp_excl ? 1 : 0)\n')

    const marks = []
    for (let i = 5; i < N; i += 1) if (d[i] === 1) marks.push(i)
    expect(marks.length, 'no discriminating bar — the oracle is not discriminating')
      .toBeGreaterThan(3)
    for (const i of marks) {
      expect(v0[i], `bar ${i} did not match the INCLUSIVE oracle`).toBe(incl[i])
      expect(v0[i], `bar ${i} matched the EXCLUSIVE oracle`).not.toBe(excl[i])
    }
  })

  it('⭐⭐ Q2/Q3 — consecutive occurrences are one FIRING apart, not one bar', () => {
    const [d01, d12] = run(
      'cond = bar_index % 5 == 0\n'
      + 'v0 = ta.valuewhen(cond, bar_index, 0)\n'
      + 'v1 = ta.valuewhen(cond, bar_index, 1)\n'
      + 'v2 = ta.valuewhen(cond, bar_index, 2)\n'
      + 'plot(v0 - v1)\nplot(v1 - v2)\n')
    const seen01 = new Set()
    const seen12 = new Set()
    for (let i = 15; i < N; i += 1) { seen01.add(d01[i]); seen12.add(d12[i]) }
    // ⛔ EXACTLY 5, AND NOTHING ELSE. 1 would mean occurrence counts BARS.
    expect([...seen01]).toEqual([5])
    expect([...seen12]).toEqual([5])
  })

  it('⭐⭐ Q1 — a condition that never fires is `na`, never 0', () => {
    // ⛔ `bar_index < 0` is ARITHMETIC, not the literal `false`, so it cannot be
    // folded away before it is ever evaluated — the probe's own reasoning.
    const [never] = run('plot(ta.valuewhen(bar_index < 0, close, 0))\nplot(close)')
    expect(never.every((v) => Number.isNaN(v)), 'a never-fired valuewhen was not na').toBe(true)
  })

  it('⭐ before the Nth firing has happened it is `na`, then becomes real', () => {
    // occurrence 2 needs THREE firings. With the condition firing on bars
    // 0, 5, 10 the third exists from bar 10, and not before.
    const [v2] = run('cond = bar_index % 5 == 0\nplot(ta.valuewhen(cond, bar_index, 2))\n')
    expect(Number.isNaN(v2[9]), 'answered before the third firing had happened').toBe(true)
    expect(v2[10]).toBe(0)
    expect(v2[14]).toBe(0)
    expect(v2[15]).toBe(5)
  })

  it('⭐ the bare v1-v3 spelling is the same function', () => {
    const [a] = run('cond = bar_index % 5 == 0\nplot(valuewhen(cond, bar_index, 1))\n')
    const [b] = run('cond = bar_index % 5 == 0\nplot(ta.valuewhen(cond, bar_index, 1))\n')
    expect(a).toEqual(b)
  })

  it('⛔⛔ CONTROL — it is NOT the host bar-window function', () => {
    // ⭐⭐ THE ONE TEST THAT WOULD CATCH WIRING THIS TO `interpret.js::valueWhen`.
    // The condition fires on bars 0 and 10 only. At bar 12, asking for the
    // SECOND most recent firing must answer bar 0's value. The bar-window
    // reading — "fired within the last 1 bar" — answers `na`, and a suite
    // without this case cannot tell the two apart.
    const [v] = run('cond = bar_index == 0 or bar_index == 10\n'
      + 'plot(ta.valuewhen(cond, bar_index, 1))\n')
    expect(Number.isNaN(v[12]), 'answered na — this is the BAR-WINDOW function').toBe(false)
    expect(v[12], 'the second most recent firing at bar 12 is bar 0').toBe(0)
  })

  it('⛔ a SERIES occurrence is refused by name, not silently rounded', () => {
    // Pine requires a simple int. A series occurrence would need state sized at
    // run time, and answering anything for it would be inventing a semantics.
    const r = refusalOf('cond = close > open\nplot(ta.valuewhen(cond, close, bar_index % 3))\n')
    expect(r.message).toMatch(/occurrence/i)
  })

  it('⛔ a NEGATIVE occurrence is refused', () => {
    expect(refusalOf('cond = close > open\nplot(ta.valuewhen(cond, close, -1))\n').guard)
      .toBeTruthy()
  })
})
