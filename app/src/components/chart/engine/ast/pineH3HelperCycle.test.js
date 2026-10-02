// app/src/components/chart/engine/ast/pineH3HelperCycle.test.js
//
// ⭐⭐ H3 (2026-10-02) — A HELPER CALLED TWICE IS TWO CALLS, NOT A CYCLE.
//
// `heikin-ashi-true-strength-index-and-optimized-trend-tracker-erebor` defines
// `ma1(source, length, type) => switch type ...` and then
// `double_smooth(s, l, sh) => f = ma1(s, l, t)` / `ma1(f, sh, t)`. The member door
// refused it at `pine:cycle` — "`ma1` is defined in terms of itself" — about a
// script TradingView runs: the outer call's `switch` body was still on the ONE
// cycle stack the resolver kept across calls when its argument went through
// `ma1` again. An `if` with a value had the same wall; a ternary body never did
// (an `expr` body takes the direct path). Each call now resolves its body on its
// own stack (`Resolver.inlineUserFunction`).
//
// ⛔ THE CONTROL: a helper calling ITSELF is still `pine:cycle` (Pine forbids
// recursion; `MAX_CALL_DEPTH` refuses it), and a top-level name defined in terms
// of itself still is.
import { describe, it, expect } from 'vitest'
import { translatePine } from './pine'

const HEAD = '//@version=5\nindicator("h3")\nt = input.string("WMA", options = ["SMA", "WMA"])\n'
const SWITCH_MA = 'm(s, l, ty) =>\n    switch ty\n        "SMA" => ta.sma(s, l)\n        "WMA" => ta.wma(s, l)\n'
const IF_MA = 'm(s, l, ty) =>\n    if ty == "SMA"\n        ta.sma(s, l)\n    else\n        ta.wma(s, l)\n'
const TERNARY_MA = 'm(s, l, ty) => ty == "SMA" ? ta.sma(s, l) : ta.wma(s, l)\n'

const served = (src) => {
  const t = translatePine(src, { strict: true })
  return { ok: t.ok, formula: t.ok ? t.outputs[t.selected].formula : null, guard: (t.refusal || {}).guard || null, t }
}

describe('H3 — a helper whose body is a switch / if, called through itself', () => {
  // the ternary body is the reference: it always took the direct path
  const reference = served(HEAD + TERNARY_MA + 'plot(m(m(close, 10, t), 5, t))\n')

  it('the reference (a ternary body) nests', () => {
    expect(reference.ok).toBe(true)
    expect(reference.formula).toBe('wma(wma(close, 10), 5)')
  })

  for (const [label, body] of [['switch', SWITCH_MA], ['if', IF_MA]]) {
    it(`${label} body, nested directly: two calls, the reference's formula`, () => {
      const r = served(HEAD + body + 'plot(m(m(close, 10, t), 5, t))\n')
      expect(r.guard).toBe(null)
      expect(r.formula).toBe(reference.formula)
    })
    it(`${label} body, through a local of another helper (the erebor shape)`, () => {
      const r = served(HEAD + body + 'd(s) =>\n    f = m(s, 10, t)\n    m(f, 5, t)\nplot(d(close))\n')
      expect(r.guard).toBe(null)
      expect(r.formula).toBe(reference.formula)
    })
    it(`${label} body, through a top-level name`, () => {
      const r = served(HEAD + body + 'a = m(close, 10, t)\nplot(m(a, 5, t))\n')
      expect(r.formula).toBe(reference.formula)
    })
    it(`${label} body, a different arm per call: each call picks its own`, () => {
      const r = served(HEAD + body + 'plot(m(m(close, 10, "SMA"), 5, t))\n')
      expect(r.formula).toBe('wma(sma(close, 10), 5)')
    })
  }

  it('⛔ control: a helper that calls ITSELF is still pine:cycle', () => {
    const r = served(HEAD + 'm(s, l, ty) =>\n    switch ty\n        "SMA" => m(s, l, ty)\n        "WMA" => ta.wma(s, l)\nplot(m(close, 10, "SMA"))\n')
    expect(r.ok).toBe(false)
    expect(r.guard).toBe('pine:cycle')
  })

  it('⛔ control: a top-level name defined through itself is still refused', () => {
    const r = served('//@version=5\nindicator("h3")\na = b + 1\nb = a + 1\nplot(a)\n')
    expect(r.ok).toBe(false)
  })
})
