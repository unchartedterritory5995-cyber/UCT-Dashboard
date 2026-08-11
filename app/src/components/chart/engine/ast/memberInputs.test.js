// ⭐⭐ A MEMBER-DECLARED INPUT, END TO END — the proof that Phase 1.4 is a
// BUILDER task and not an engine one.
//
// `BuilderSheet.buildDefinition` writes `inputs: BUILDER_INPUTS.map(...)`, a
// frozen pair (`color`, `lineWidth`). That hardcoding is the ONLY thing standing
// between a member and a tunable indicator: `declaredInputs` reads any
// `{key}` array off a definition, `lintRepaint` and `sentenceFor` take that scope
// verbatim, and `interpret` takes the VALUES by the same names.
//
// ⛔ THIS FILE EXISTS SO THE NEXT PERSON DOES NOT RE-DERIVE THE ENGINE. It pins
// what already works, so when the input form is built the only new risk is the
// form itself — and if any of this regresses underneath it, the failure names the
// engine rather than looking like a broken UI.

import { describe, it, expect } from 'vitest'
import { evaluateFormula } from '../../builder/FormulaField.jsx'
import { declaredInputs } from './lint.js'
import { interpret } from './interpret.js'
import { BUILDER_INPUTS } from '../../builder/builderInputs.js'

const bars = Array.from({ length: 300 }, (_, i) => {
  const c = 100 + Math.sin(i / 9) * 8 + i * 0.06
  return { o: c - 0.3, h: c + 0.8, l: c - 0.8, c, v: 100000 }
})

/** Exactly the shape a definition carries, with a name the builder does not ship. */
const MEMBER_DEF = {
  inputs: [{ key: 'period', type: 'int', label: 'Period', default: 20, min: 4, max: 200 }],
}
const SCOPE = declaredInputs(MEMBER_DEF)

// A 2-pole Butterworth whose coefficients are DERIVED FROM THE INPUT rather than
// baked in as literals — which is the whole difference between a custom indicator
// and one frozen instance of one.
const ARG = '(1.414 * 3.14159265358979 / period)'
const A = `exp(-${ARG})`
const C2 = `(2 * ${A} * cos(${ARG}))`
const C3 = `(0 - ${A} * ${A})`
const C1 = `(1 - ${C2} - ${C3})`
const TUNABLE = `accum(close, ${C1} * (close + close[1]) / 2 + ${C2} * self + ${C3} * self[1], 60)`

const lastAt = (ast, period) => {
  const col = [...interpret(ast, bars, { period }, undefined, {})]
  return col.at(-1)
}

describe('a member-declared input is already wired through the whole engine', () => {
  it('the scope is DERIVED from the definition, not from the builder constant', () => {
    // ⛔ Non-vacuity: if `declaredInputs` ignored the definition, every assertion
    // below would be measuring the builder's own two names instead.
    expect(SCOPE).toHaveProperty('period')
    expect(SCOPE).not.toHaveProperty('lineWidth')
  })

  it('🔴 a filter whose coefficients come from the INPUT parses, lints and reads back', () => {
    const ev = evaluateFormula(TUNABLE, SCOPE)
    expect(ev.ok, ev.error).toBe(true)
    expect(ev.verdict.mode).toBe('non-repainting')
    expect(ev.readback).toContain('running value')
    expect(ev.measured.maxNodes).toBeLessThan(128)
  })

  it('⭐ …and it is GENUINELY TUNABLE — the input moves the number', () => {
    // The assertion that makes this a custom indicator rather than a fixed one.
    // An implementation that resolved `period` to a constant would pass every
    // test above and fail this one.
    const ev = evaluateFormula(TUNABLE, SCOPE)
    const at20 = lastAt(ev.ast, 20)
    const at50 = lastAt(ev.ast, 50)
    expect(Number.isFinite(at20)).toBe(true)
    expect(Number.isFinite(at50)).toBe(true)
    expect(Math.abs(at20 - at50)).toBeGreaterThan(1)
  })

  it('⛔ an UNDECLARED name still refuses — "inputs work" must not mean "anything resolves"', () => {
    const ev = evaluateFormula('close * nosuchinput', SCOPE)
    expect(ev.ok).toBe(false)
    expect(ev.guard).toBe('sentence:name')
  })

  it('⛔ and the builder is what limits this, so the limit is stated here', () => {
    // If this ever stops being true, the input form has shipped and this
    // assertion is the thing that should tell you — by name, not by absence.
    expect(BUILDER_INPUTS.map((s) => s.key).sort()).toEqual(['color', 'lineWidth'])
  })
})
