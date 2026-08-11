// ⭐⭐ `self[n]` — A RUNNING VALUE READING MORE THAN ONE BAR OF ITS OWN PAST.
//
// This is the keystone of member-authored indicators. A 2-pole filter is
// `c1*input + c2*prev + c3*prev_prev` BY DEFINITION — Butterworth, SuperSmoother,
// every Ehlers design, Gaussian, Kalman-ish smoothers — so a recurrence that
// could see exactly one bar back could not express the DSP family at all.
//
// ⚠️ It costs none of the safety properties. `value` is a non-negative literal ON
// the offset node (parse.js gives it no slot for an expression), so `self[k]`
// reads history and can never reach forward.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { evaluateFormula, canSaveFormula } from '../../builder/FormulaField.jsx'
import { BUILDER_INPUT_SCOPE } from '../../builder/builderInputs.js'
import { interpret, MAX_SELF_LAG } from './interpret.js'
import { astHash } from './parse.js'

/** ⛔ THE FIXTURE IS THE ONE AUTHORITY. The Python rail reads this same file, so
 *  a lane that drifts fails against the OTHER LANE'S OWN OUTPUT rather than
 *  against a number somebody retyped here. */
const PARITY = JSON.parse(readFileSync('../tests/fixtures/ast/self_lag_parity.json', 'utf8'))

const bars = Array.from({ length: 300 }, (_, i) => {
  const c = 100 + Math.sin(i / 9) * 8 + i * 0.06
  return { o: c - 0.3, h: c + 0.8, l: c - 0.8, c, v: 100000 }
})
const col = (src) => {
  const ev = evaluateFormula(src, BUILDER_INPUT_SCOPE)
  expect(ev.ok, ev.error || src).toBe(true)
  return [...interpret(ev.ast, bars, {})]
}
const refusalOf = (src) => {
  const ev = evaluateFormula(src, BUILDER_INPUT_SCOPE)
  if (!ev.ok) return { guard: ev.guard, message: ev.error }
  try {
    ;[...interpret(ev.ast, bars, {})]
  } catch (err) { return { guard: err.guard || null, message: String(err.message) } }
  return null
}

describe('a member can author a 2-pole filter in the formula box', () => {
  it('🔴 THE BUTTERWORTH, BAR FOR BAR, AGAINST THE OTHER LANE', () => {
    const ev = evaluateFormula(PARITY._formula, BUILDER_INPUT_SCOPE)
    expect(ev.ok, ev.error).toBe(true)
    // The tree is the fixture's too — a lane could otherwise agree on numbers
    // produced from a DIFFERENT formula and call it parity.
    expect(astHash(ev.ast)).toBe(astHash(PARITY.ast))
    const got = [...interpret(ev.ast, bars, {})].map((x) => (x === null || Number.isNaN(x) ? null : x))
    expect(got).toHaveLength(PARITY.expected.length)
    for (let i = 0; i < got.length; i++) {
      if (PARITY.expected[i] === null) { expect(got[i], `bar ${i}`).toBeNull(); continue }
      expect(Math.abs(got[i] - PARITY.expected[i]), `bar ${i}`).toBeLessThan(1e-9)
    }
  })

  it('…and the fixture is not mostly holes', () => {
    // ⛔ NON-VACUITY. Every assertion above passes on an all-null column.
    expect(PARITY.expected.filter((v) => v !== null).length).toBeGreaterThan(200)
  })

  it('the one-lag form is UNCHANGED — a hand-written EMA still equals the declared one', () => {
    // ⛔ The compatibility half. Every recurrence a member has already saved uses
    // the one-lag shape, and the history rewrite must not have moved any of them.
    const hand = col('accum(close, self + 0.1 * (close - self), 250)')
    const declared = col('ema(close, 19)')
    expect(Math.abs(hand.at(-1) - declared.at(-1))).toBeLessThan(1e-9)
  })

  it('a second lag actually CHANGES the answer — it is not being ignored', () => {
    // ⛔ Without this, an implementation that silently dropped `self[1]` would
    // pass every other test here by computing a plain one-lag filter.
    const twoPole = col(PARITY._formula)
    const dropped = col(PARITY._formula.replace(' - 0.64125 * self[1]', ''))
    expect(Math.abs(twoPole.at(-1) - dropped.at(-1))).toBeGreaterThan(0.01)
  })
})

describe('what `self[n]` still refuses, and why', () => {
  it('⛔ an offset over an EXPRESSION containing the running value', () => {
    // `(self + close)[1]` asks for a past value of a formula the step loop never
    // computed. Refusing it is what keeps `self[k]` meaning exactly "the running
    // value k bars ago" instead of something a reader has to derive.
    const r = refusalOf('accum(close, (self + close)[1], 250)')
    expect(r && r.guard).toBe('interpret:recurrence')
    expect(r.message).toContain('never computed')
  })

  it('⛔ a lag past the ceiling, named with its number', () => {
    const r = refusalOf(`accum(close, self[${MAX_SELF_LAG + 1}] + 0, 250)`)
    expect(r && r.guard).toBe('interpret:recurrence')
    expect(r.message).toContain(String(MAX_SELF_LAG))
  })

  it('…and the ceiling is REACHABLE, so it is a guard rather than a latch', () => {
    // `lesson_gate_that_cannot_fail`: a cap nothing can trip is not a cap.
    expect(refusalOf(`accum(close, self[${MAX_SELF_LAG}] + 0, 250)`)).toBeNull()
  })
})

// ─── THE SAVE GATE RUNS THE TREE ────────────────────────────────────────────
//
// 🔴 Parsing, the budget, the repaint linter and the read-back all INSPECT a
// tree without evaluating it — so a formula whose refusal fires only at
// interpret time passed all four and reached the save button. Measured
// 2026-08-11: `accum(close, sma(self, 3), 5)` returned ok, saveable and
// `non-repainting`, and threw when the chart drew it.
describe('nothing saveable may throw when it runs', () => {
  const gate = (src) => {
    const ev = evaluateFormula(src, BUILDER_INPUT_SCOPE)
    return { ok: ev.ok, guard: ev.guard, saveable: ev.ok ? canSaveFormula(ev, false) : false }
  }

  it('🔴 a tree that throws at interpret is REFUSED, not offered', () => {
    for (const src of [
      'accum(close, sma(self, 3), 5)',                       // self inside a window
      'accum(close, accum(close, self + 1, 2) + self, 5)',   // a nested running value
      'accum(close, (self + close)[1], 5)',                  // offset over an expression
    ]) {
      const g = gate(src)
      expect(g.ok, src).toBe(false)
      expect(g.saveable, src).toBe(false)
      expect(g.guard, src).toBe('interpret:recurrence')
    }
  })

  it('⛔ …and it invents NO refusal for work that is fine', () => {
    // A gate that refuses valid work is worse than the hole it closes. Scalars
    // resolve to 0 under an empty probe scope rather than raising, and a declared
    // input gets a numeric stand-in — `color` is a STRING in the real scope, and
    // handing that to the interpreter refused `close * lineWidth` on the first
    // attempt at this gate.
    for (const src of [
      'accum(close, 0.27513 * (close + close[1]) / 2 + 1.36612 * self - 0.64125 * self[1], 60)',
      'accum(close, self + 0.1 * (close - self), 250)',
      'market_cap / 1000000 > 250',
      'close > sma(close, 20) && volume > 500000',
      'close * lineWidth',
    ]) {
      const g = gate(src)
      expect(g.ok, `${src} — ${g.guard}`).toBe(true)
    }
  })
})
